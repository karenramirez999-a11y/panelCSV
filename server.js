/* ════════════════════════════════════════════════════════════════
   SERVER.JS — Backend de Sueños Inmobiliarios
   Rutas:
     POST /api/admin/cargar-propiedades   → carga masiva desde Excel (admin)
     POST /api/chat                       → búsqueda flexible para Sofía
   ════════════════════════════════════════════════════════════════ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // los Excel grandes generan JSON grande

/* ── CONFIG ── */
const PORT = process.env.PORT || 3000;
const WHATSAPP_NUMERO_GENERAL = process.env.WHATSAPP_NUMERO_GENERAL || '573206922370';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // requerido para usar el panel admin

/* ── CLIENTES SUPABASE ──
   - supabaseAdmin: usa la SERVICE_ROLE key. Solo se usa server-side
     para escribir (saltando RLS). NUNCA exponer esta key al navegador.
   - supabasePublic: usa la ANON key. Se usa para leer (mismo nivel de
     acceso que ya tiene el chat hoy), respetando RLS.
*/
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* ════════════════════════════════════════════════════════════════
   HELPERS COMPARTIDOS
   ════════════════════════════════════════════════════════════════ */

function limpiarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

/* Acepta "280000000", "$280.000.000", "280,000,000", etc. */
function parsePrecioServidor(v) {
  if (v == null || v === '') return null;
  const soloDigitos = String(v).replace(/[^\d]/g, '');
  if (!soloDigitos) return null;
  const n = parseInt(soloDigitos, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function generarCodigo(titulo, ciudad) {
  const base = `${titulo}-${ciudad}`
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `propiedad-${Date.now()}`;
}

function formatearPrecio(n) {
  if (!n) return 'Consultar';
  if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)} mil mill.`;
  if (n >= 1000000) return `$${Math.round(n / 1000000)} mill.`;
  return `$${n.toLocaleString('es-CO')}`;
}

/* ════════════════════════════════════════════════════════════════
   1) RUTA ADMIN: CARGA MASIVA DESDE EXCEL
   ════════════════════════════════════════════════════════════════ */

function verificarTokenAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ ok: false, error: 'ADMIN_TOKEN no está configurado en el servidor (.env)' });
  }
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Token de administrador inválido o ausente' });
  }
  next();
}

app.post('/api/admin/cargar-propiedades', verificarTokenAdmin, async (req, res) => {
  try {
    const { propiedades, modo } = req.body || {};

    if (!Array.isArray(propiedades) || propiedades.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se recibieron propiedades para cargar' });
    }
    if (propiedades.length > 2000) {
      return res.status(400).json({ ok: false, error: 'Máximo 2000 propiedades por carga. Divide el archivo.' });
    }

    const filasLimpias = [];
    const erroresFila = [];

    propiedades.forEach((row, i) => {
      const titulo = limpiarTexto(row.titulo);
      const tipo = limpiarTexto(row.tipo);
      const ciudad = limpiarTexto(row.ciudad);
      const precio = parsePrecioServidor(row.precio);
      const habitaciones = parseInt(row.habitaciones, 10);
      const banos = parseInt(row.banos, 10);

      if (!titulo || !tipo || !ciudad || !precio) {
        erroresFila.push({
          fila: i + 1,
          titulo: titulo || '(sin título)',
          motivo: 'Faltan datos obligatorios: título, tipo, ciudad o precio válido'
        });
        return;
      }

      filasLimpias.push({
        codigo: limpiarTexto(row.codigo) || generarCodigo(titulo, ciudad),
        titulo,
        tipo,
        ciudad,
        precio,
        habitaciones: Number.isFinite(habitaciones) ? habitaciones : null,
        banos: Number.isFinite(banos) ? banos : null,
        imagen: limpiarTexto(row.url_imagen) || null,
        link_whatsapp: limpiarTexto(row.link_whatsapp) || null,
        activo: true,
        vendido: false,
        actualizado_en: new Date().toISOString()
      });
    });

    if (filasLimpias.length === 0) {
      return res.status(400).json({ ok: false, error: 'Ninguna fila tenía datos válidos', erroresFila });
    }

    /* Modo "reemplazar": desactiva todo el inventario anterior antes de
       insertar el nuevo lote. No borra filas (por seguridad e historial),
       solo las marca activo=false para que dejen de salir en el chat. */
    if (modo === 'reemplazar') {
      const { error: errorDesactivar } = await supabaseAdmin
        .from('propiedades')
        .update({ activo: false })
        .not('id', 'is', null);
      if (errorDesactivar) {
        console.warn('[admin] no se pudo desactivar el inventario previo:', errorDesactivar.message);
      }
    }

    /* upsert: inserta nuevas o actualiza existentes usando "codigo" como
       llave única (ver nota SQL al final de este archivo). */
    const { data, error } = await supabaseAdmin
      .from('propiedades')
      .upsert(filasLimpias, { onConflict: 'codigo' })
      .select('id, titulo');

    if (error) {
      console.error('[admin] error de upsert:', error);
      return res.status(500).json({ ok: false, error: 'Error guardando en Supabase: ' + error.message });
    }

    return res.json({
      ok: true,
      insertadosOActualizados: data ? data.length : filasLimpias.length,
      erroresFila,
      modo: modo === 'reemplazar' ? 'reemplazar' : 'agregar'
    });
  } catch (err) {
    console.error('[api/admin/cargar-propiedades]', err);
    return res.status(500).json({ ok: false, error: 'Error inesperado en el servidor' });
  }
});

/* ════════════════════════════════════════════════════════════════
   2) RUTA DE CHAT: BÚSQUEDA FLEXIBLE
   ════════════════════════════════════════════════════════════════ */

/* Margen de presupuesto: si el tope es 300M, busca entre 65% y 110%
   de ese valor (≈195M–330M). Ajusta estos dos números si quieres
   un margen más o menos amplio. */
const MARGEN_INFERIOR = 0.35;
const MARGEN_SUPERIOR = 0.10;

function calcularRangoPresupuesto(precioMax) {
  if (!precioMax || precioMax <= 0) return null;
  return {
    inferior: Math.round(precioMax * (1 - MARGEN_INFERIOR)),
    superior: Math.round(precioMax * (1 + MARGEN_SUPERIOR))
  };
}

function normalizarFiltros(body) {
  return {
    tipo: limpiarTexto(body.tipo) || null,
    ciudad: limpiarTexto(body.ciudad) || null,
    presupuesto: parseInt(body.presupuesto, 10) || null,
    habitaciones: parseInt(body.habitaciones, 10) || 0
  };
}

/* Ejecuta una consulta a Supabase. conTipo/conCiudad permiten ir
   "soltando" filtros en niveles sucesivos si no hay resultados. */
async function ejecutarBusqueda({ tipo, ciudad, rango, conTipo, conCiudad }) {
  let query = supabasePublic
    .from('propiedades')
    .select('*')
    .eq('activo', true)
    .or('vendido.is.null,vendido.eq.false') // ← el fix: no excluye "vendido" en NULL
    .limit(40);

  if (conTipo && tipo) query = query.ilike('tipo', `%${tipo}%`);
  if (conCiudad && ciudad) query = query.ilike('ciudad', `%${ciudad}%`);
  if (rango) query = query.gte('precio', rango.inferior).lte('precio', rango.superior);

  const { data, error } = await query.order('creado_en', { ascending: false });
  if (error) {
    console.error('[chat] error de consulta:', error.message);
    return [];
  }
  return data || [];
}

/* Ordena resultados priorizando habitaciones, luego cercanía de precio */
function rankear(props, filtros) {
  const habsDeseadas = filtros.habitaciones || 0;
  const precioRef = filtros.presupuesto || 0;

  return [...props].sort((a, b) => {
    const ha = a.habitaciones ?? 0;
    const hb = b.habitaciones ?? 0;

    if (habsDeseadas) {
      const cumpleA = ha >= habsDeseadas ? 0 : 1;
      const cumpleB = hb >= habsDeseadas ? 0 : 1;
      if (cumpleA !== cumpleB) return cumpleA - cumpleB;
    }

    const diffHabA = Math.abs(ha - habsDeseadas);
    const diffHabB = Math.abs(hb - habsDeseadas);
    if (diffHabA !== diffHabB) return diffHabA - diffHabB;

    const diffPrecioA = Math.abs((a.precio || 0) - precioRef);
    const diffPrecioB = Math.abs((b.precio || 0) - precioRef);
    return diffPrecioA - diffPrecioB;
  });
}

/* Va relajando los filtros en niveles hasta encontrar algo */
async function buscarPropiedadesFlexible(filtros) {
  const rango = calcularRangoPresupuesto(filtros.presupuesto);

  // Nivel 1: tipo + ciudad + presupuesto flexible
  let props = await ejecutarBusqueda({ ...filtros, rango, conTipo: true, conCiudad: true });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'flexible' };

  // Nivel 2: mismo tipo, cualquier ciudad (puede haber algo similar al lado)
  props = await ejecutarBusqueda({ ...filtros, rango, conTipo: true, conCiudad: false });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'sin_ciudad' };

  // Nivel 3: misma ciudad, cualquier tipo de inmueble
  props = await ejecutarBusqueda({ ...filtros, rango, conTipo: false, conCiudad: true });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'sin_tipo' };

  // Nivel 4: último recurso, rango de precio bien amplio, sin tipo ni ciudad
  const rangoAmplio = filtros.presupuesto
    ? { inferior: Math.round(filtros.presupuesto * 0.5), superior: Math.round(filtros.presupuesto * 1.25) }
    : null;
  props = await ejecutarBusqueda({ ...filtros, rango: rangoAmplio, conTipo: false, conCiudad: false });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'general' };

  return { propiedades: [], nivel: 'ninguno' };
}

/* ── Tarjetas HTML + botón "Me interesa" hacia WhatsApp ── */

function generarLinkWhatsApp(p, numeroGeneral) {
  const mensaje = encodeURIComponent(
    `Hola, me interesa la ${(p.tipo || 'propiedad').toLowerCase()} "${p.titulo}" que vi en el chat. ¿Sigue disponible?`
  );

  if (p.link_whatsapp) {
    if (/^https?:\/\//i.test(p.link_whatsapp)) {
      return p.link_whatsapp.includes('text=')
        ? p.link_whatsapp
        : `${p.link_whatsapp}${p.link_whatsapp.includes('?') ? '&' : '?'}text=${mensaje}`;
    }
    const numero = p.link_whatsapp.replace(/\D/g, '');
    if (numero) return `https://wa.me/${numero}?text=${mensaje}`;
  }
  return `https://wa.me/${numeroGeneral}?text=${mensaje}`;
}

function generarTarjetasHTML(props, numeroGeneral) {
  const tarjetas = props.map(p => {
    const precio = formatearPrecio(p.precio);
    const habs = p.habitaciones != null ? `${p.habitaciones} hab.` : '';
    const banos = p.banos != null ? `${p.banos} baños` : '';
    const link = generarLinkWhatsApp(p, numeroGeneral);
    const titulo = (p.titulo || 'Propiedad').toString().slice(0, 60);
    const imagenHtml = p.imagen
      ? `<img src="${p.imagen}" alt="${titulo}" style="width:100%;height:120px;object-fit:cover;" onerror="this.style.display='none'">`
      : `<div style="width:100%;height:80px;background:rgba(223,181,80,.08);display:flex;align-items:center;justify-content:center;font-size:2rem;">🏠</div>`;

    return `<div style="min-width:200px;max-width:220px;background:rgba(255,255,255,.07);border-radius:12px;overflow:hidden;flex-shrink:0;scroll-snap-align:start;border:1px solid rgba(223,181,80,.18);">
      ${imagenHtml}
      <div style="padding:.6rem .7rem">
        <div style="font-size:.78rem;font-weight:700;color:#fff;margin-bottom:.3rem;line-height:1.3;">${titulo}</div>
        <div style="font-size:.9rem;font-weight:800;color:#DFB550;margin-bottom:.25rem;">${precio}</div>
        <div style="font-size:.7rem;color:rgba(255,255,255,.55);margin-bottom:.35rem;">📍 ${p.ciudad || ''} &nbsp; 🏷️ ${p.tipo || ''}</div>
        ${(habs || banos) ? `<div style="font-size:.7rem;color:rgba(255,255,255,.5);margin-bottom:.5rem;">🛏 ${habs} &nbsp; 🚿 ${banos}</div>` : ''}
        <a href="${link}" target="_blank" style="display:block;text-align:center;background:#25D366;color:#fff;font-weight:700;font-size:.72rem;padding:.45rem .5rem;border-radius:8px;text-decoration:none;">💬 Me interesa</a>
      </div>
    </div>`;
  }).join('');

  return `<div style="display:flex;gap:.6rem;overflow-x:auto;padding-bottom:.4rem;scroll-snap-type:x mandatory;">${tarjetas}</div>`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const filtros = normalizarFiltros(req.body || {});
    const resultado = await buscarPropiedadesFlexible(filtros);

    if (resultado.propiedades.length > 0) {
      const html = generarTarjetasHTML(resultado.propiedades, WHATSAPP_NUMERO_GENERAL);
      return res.json({
        ok: true,
        encontrado: true,
        nivel: resultado.nivel, // 'flexible' | 'sin_ciudad' | 'sin_tipo' | 'general'
        total: resultado.propiedades.length,
        html
      });
    }

    // Sin resultados ni siquiera flexibilizando: el front muestra su botón
    // actual de "Hablar por WhatsApp" (sfNoEncontrado en index.html).
    return res.json({ ok: true, encontrado: false });
  } catch (err) {
    console.error('[api/chat]', err);
    return res.status(500).json({ ok: false, encontrado: false, error: 'Error buscando propiedades' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});

/* ════════════════════════════════════════════════════════════════
   NOTAS DE INSTALACIÓN (no es código, solo referencia rápida)

   npm install express cors dotenv @supabase/supabase-js

   .env (NUNCA subir este archivo a git):
     SUPABASE_URL=https://trbamfvvpdmmdxpjiiqx.supabase.co
     SUPABASE_ANON_KEY=tu_anon_key_publica
     SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key   ← la secreta, solo aquí
     ADMIN_TOKEN=elige-una-clave-larga-y-rara
     WHATSAPP_NUMERO_GENERAL=573206922370
     PORT=3000

   SQL en Supabase (una sola vez), para que el upsert funcione:
     alter table propiedades add column if not exists codigo text;
     create unique index if not exists propiedades_codigo_unique
       on propiedades (codigo);
     alter table propiedades add column if not exists link_whatsapp text;
   ════════════════════════════════════════════════════════════════ */
