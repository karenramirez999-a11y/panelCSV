/* api/admin/cargar-propiedades.js → POST /api/admin/cargar-propiedades */
const { aplicarCORS } = require('../../lib/cors');
const { supabaseAdmin } = require('../../lib/supabaseClients');
const { limpiarTexto, parsePrecioServidor, generarCodigo, parseGaleriaServidor } = require('../../lib/adminHelpers');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

module.exports = async function handler(req, res) {
  aplicarCORS(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  if (!ADMIN_TOKEN) {
    return res.status(500).json({ ok: false, error: 'ADMIN_TOKEN no está configurado en Vercel' });
  }
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Token de administrador inválido o ausente' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { propiedades, modo } = body;

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
      const area = parseInt(row.area, 10);

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
        area: Number.isFinite(area) ? area : null,
        barrio: limpiarTexto(row.barrio) || null,
        descripcion: limpiarTexto(row.descripcion) || null,
        parqueadero: limpiarTexto(row.parqueadero) || null,
        imagen: limpiarTexto(row.url_imagen) || null,
        imagenes: parseGaleriaServidor(row.galeria),
        link_whatsapp: limpiarTexto(row.link_whatsapp) || null,
        activo: true,
        vendido: false,
        actualizado_en: new Date().toISOString()
      });
    });

    if (filasLimpias.length === 0) {
      return res.status(400).json({ ok: false, error: 'Ninguna fila tenía datos válidos', erroresFila });
    }

    if (modo === 'reemplazar') {
      const { error: errorDesactivar } = await supabaseAdmin
        .from('propiedades')
        .update({ activo: false })
        .not('id', 'is', null);
      if (errorDesactivar) {
        console.warn('[admin] no se pudo desactivar el inventario previo:', errorDesactivar.message);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('propiedades')
      .upsert(filasLimpias, { onConflict: 'codigo' })
      .select('id, titulo');

    if (error) {
      console.error('[admin] error de upsert:', error);
      return res.status(500).json({ ok: false, error: 'Error guardando en Supabase: ' + error.message });
    }

    return res.status(200).json({
      ok: true,
      insertadosOActualizados: data ? data.length : filasLimpias.length,
      erroresFila,
      modo: modo === 'reemplazar' ? 'reemplazar' : 'agregar'
    });
  } catch (err) {
    console.error('[api/admin/cargar-propiedades]', err);
    return res.status(500).json({ ok: false, error: 'Error inesperado en el servidor' });
  }
};
