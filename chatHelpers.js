/* lib/chatHelpers.js — búsqueda flexible + tarjetas HTML para el chat de Sofía
   ────────────────────────────────────────────────────────────────────────
   Estrategia: UNA sola consulta a Supabase trae todo lo activo/no-vendido.
   Todo el filtrado por tipo, ciudad y precio se hace en memoria, en niveles
   cada vez más flexibles, con logs en cada paso para poder diagnosticar
   por qué una propiedad entra o se descarta.
   ──────────────────────────────────────────────────────────────────────── */
const { supabasePublic } = require('./supabaseClients');

function limpiarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function formatearPrecio(n) {
  if (!n) return 'Consultar';
  if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)} mil mill.`;
  if (n >= 1000000) return `$${Math.round(n / 1000000)} mill.`;
  return `$${n.toLocaleString('es-CO')}`;
}

/* ── Comparaciones insensibles a mayúsculas Y a tildes ──
   "Apartamento", "apartamento", "APARTAMENTO", "Apártamento" → todas iguales */
function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function coincideTexto(valorDb, filtro) {
  if (!filtro) return true; // sin filtro = no descarta nada
  const a = normalizarTexto(valorDb);
  const b = normalizarTexto(filtro);
  if (!a) return false;
  return a.includes(b) || b.includes(a);
}

function precioEnRango(precio, rango) {
  if (!rango) return true; // sin banda de precio = no descarta nada
  if (precio == null) return false;
  return precio >= rango.inferior && precio <= rango.superior;
}

function normalizarFiltros(body) {
  return {
    tipo: limpiarTexto(body.tipo) || null,
    ciudad: limpiarTexto(body.ciudad) || null,
    presupuesto: parseInt(body.presupuesto, 10) || null,
    presupuestoMin: parseInt(body.presupuestoMin, 10) || null,
    presupuestoMax: parseInt(body.presupuestoMax, 10) || null,
    habitaciones: parseInt(body.habitaciones, 10) || 0
  };
}

/* ── Bandas de presupuesto ──
   "Hasta 300M" (solo presupuesto/presupuestoMax) → banda exacta = 0 a 300M.
   "Entre 300M y 400M" (presupuestoMin + presupuestoMax) → banda exacta = ese rango.
   Si no hay resultados ahí, se relaja ±10% y luego ±20% sobre los mismos límites. */
function calcularBandas(filtros) {
  const max = filtros.presupuestoMax || filtros.presupuesto || null;
  const min = filtros.presupuestoMin || 0;

  if (!max) return { exacta: null, banda10: null, banda20: null };

  return {
    exacta:  { inferior: min, superior: max },
    banda10: { inferior: Math.round(min ? min * 0.9 : max * 0.9), superior: Math.round(max * 1.10) },
    banda20: { inferior: Math.round(min ? min * 0.8 : max * 0.8), superior: Math.round(max * 1.20) }
  };
}

/* Ordena priorizando habitaciones (nunca descarta si viene null/vacío) */
function rankear(props, filtros) {
  const habsDeseadas = filtros.habitaciones || 0;
  const precioRef = filtros.presupuestoMax || filtros.presupuesto || 0;

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

/* LOG de diagnóstico: por cada propiedad activa que NO calza con el filtro
   exacto del usuario, explica cuál(es) condición(es) falló. Las que sí
   calzan no se imprimen (para no ensuciar el log). */
function logDiagnostico(candidatos, filtros, bandaExacta) {
  console.log(`[chat] ── revisando ${candidatos.length} propiedad(es) activa(s) contra el filtro exacto ──`);
  candidatos.forEach(p => {
    const tipoOk = coincideTexto(p.tipo, filtros.tipo);
    const ciudadOk = coincideTexto(p.ciudad, filtros.ciudad);
    const precioOk = precioEnRango(p.precio, bandaExacta);
    if (tipoOk && ciudadOk && precioOk) return;

    const motivos = [];
    if (!tipoOk) motivos.push(`tipo no coincide (db="${p.tipo}" vs filtro="${filtros.tipo}")`);
    if (!ciudadOk) motivos.push(`ciudad no coincide (db="${p.ciudad}" vs filtro="${filtros.ciudad}")`);
    if (!precioOk) motivos.push(`precio fuera de rango (db=${p.precio} vs rango=${bandaExacta ? bandaExacta.inferior + '-' + bandaExacta.superior : 'sin límite'})`);
    console.log(`[chat] descartada del nivel exacto → "${p.titulo}": ${motivos.join('; ')}`);
  });
}

/* ── Búsqueda principal ──
   1) Trae TODO lo activo/no-vendido en una sola consulta.
   2) Filtra en memoria en niveles cada vez más flexibles.
   3) Solo devuelve [] si de verdad no hay UNA SOLA propiedad activa en toda
      la tabla (requisito 4: preferir "cercanas" sobre "no encontrado"). */
async function buscarPropiedadesFlexible(filtros) {
  console.log('[chat] filtros recibidos:', JSON.stringify(filtros));

  const { data, error } = await supabasePublic
    .from('propiedades')
    .select('*')
    .eq('activo', true)
    .or('vendido.is.null,vendido.eq.false')
    .limit(200);
    // ⚠️ Sin .order(): "creado_en" no existe en esta tabla. Si más adelante
    // quieres ordenar la consulta base, usa una columna que sí exista
    // (ej. .order('id', { ascending: false })) — por ahora el orden no
    // afecta el resultado porque rankear() reordena todo de todas formas.

  console.log('[chat] consulta ejecutada: from(propiedades).eq(activo,true).or(vendido.is.null,vendido.eq.false).limit(200)');

  if (error) {
    console.error('[chat] ERROR en la consulta base a Supabase:', error.message, '| code:', error.code);
    return { propiedades: [], nivel: 'error_consulta', error: error.message, codigoError: error.code };
  }

  const candidatos = data || [];
  console.log(`[chat] propiedades activas/no-vendidas en la base: ${candidatos.length}`);

  if (candidatos.length === 0) {
    console.log('[chat] no hay NINGUNA propiedad activa en toda la tabla "propiedades". Revisa la columna "activo" o si la carga del Excel se guardó bien.');
    return { propiedades: [], nivel: 'sin_inventario' };
  }

  const bandas = calcularBandas(filtros);
  logDiagnostico(candidatos, filtros, bandas.exacta);

  const niveles = [
    { nombre: 'exacto',           conTipo: true,  conCiudad: true,  banda: bandas.exacta  },
    { nombre: 'flexible_10',      conTipo: true,  conCiudad: true,  banda: bandas.banda10 },
    { nombre: 'flexible_20',      conTipo: true,  conCiudad: true,  banda: bandas.banda20 },
    { nombre: 'sin_ciudad',       conTipo: true,  conCiudad: false, banda: bandas.banda20 },
    { nombre: 'sin_tipo',         conTipo: false, conCiudad: true,  banda: bandas.banda20 },
    { nombre: 'general',          conTipo: false, conCiudad: false, banda: bandas.banda20 },
    { nombre: 'cualquier_precio', conTipo: false, conCiudad: false, banda: null            }
  ];

  for (const nivel of niveles) {
    const coincidencias = candidatos.filter(p =>
      (!nivel.conTipo   || coincideTexto(p.tipo, filtros.tipo)) &&
      (!nivel.conCiudad || coincideTexto(p.ciudad, filtros.ciudad)) &&
      precioEnRango(p.precio, nivel.banda)
    );
    console.log(`[chat] nivel "${nivel.nombre}" → ${coincidencias.length} coincidencia(s)`);

    if (coincidencias.length > 0) {
      const propiedades = rankear(coincidencias, filtros).slice(0, 6);
      console.log(`[chat] devolviendo ${propiedades.length} propiedad(es) en nivel "${nivel.nombre}":`, propiedades.map(p => p.titulo));
      return { propiedades, nivel: nivel.nombre };
    }
  }

  // No debería llegar aquí casi nunca: el último nivel no filtra nada,
  // así que si hay candidatos > 0 siempre debería haber devuelto algo antes.
  console.log('[chat] ningún nivel encontró coincidencias pese a haber candidatos activos — revisar lógica.');
  return { propiedades: [], nivel: 'ninguno' };
}

/* Evita que un título/descripción con caracteres como < > " & rompa el HTML */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* La galería puede llegar de varias formas según cómo se haya guardado:
   - un array real (columna jsonb)
   - un string con JSON.stringify(array) (columna text)
   - un string plano separado por comas o "|" (carga manual)
   Esta función la normaliza siempre a un array de URLs válidas. */
function parseGaleria(valor) {
  if (Array.isArray(valor)) {
    return valor.filter(u => u && /^https?:\/\//i.test(u));
  }
  if (typeof valor === 'string' && valor.trim()) {
    try {
      const arr = JSON.parse(valor);
      if (Array.isArray(arr)) return arr.filter(u => u && /^https?:\/\//i.test(u));
    } catch (e) { /* no era JSON, se intenta como lista separada por comas/pipes */ }
    return valor.split(/[,|]/).map(s => s.trim()).filter(u => /^https?:\/\//i.test(u));
  }
  return [];
}

/* Link de WhatsApp para el botón "Me interesa" de la tarjeta resumida:
   usa el link_whatsapp propio de la propiedad si existe, si no el general. */
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

/* Los dos botones de la ficha completa SIEMPRE van al número general
   (573206922370 por defecto), tal cual se pidió, sin importar si la
   propiedad tiene un link_whatsapp propio. */
function linkWhatsAppGeneral(mensaje, numeroGeneral) {
  return `https://wa.me/${numeroGeneral}?text=${encodeURIComponent(mensaje)}`;
}

/* ── Ficha completa de una propiedad: todos los campos disponibles ── */
function generarFichaHTML(p, numeroGeneral) {
  const titulo = esc((p.titulo || 'Propiedad').toString().slice(0, 90));
  const precio = formatearPrecio(p.precio);
  const galeria = parseGaleria(p.imagenes);
  const imagenes = galeria.length > 0 ? galeria : (p.imagen ? [p.imagen] : []);

  const galeriaHtml = imagenes.length > 0
    ? `<div style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;">${
        imagenes.map(url => `<img src="${esc(url)}" alt="${titulo}" style="width:240px;height:160px;object-fit:cover;flex-shrink:0;scroll-snap-align:start;" onerror="this.style.display='none'">`).join('')
      }</div>`
    : `<div style="width:100%;height:140px;background:rgba(223,181,80,.08);display:flex;align-items:center;justify-content:center;font-size:2.4rem;">🏠</div>`;

  const filas = [];
  filas.push(`<div>📍 <strong>Ciudad:</strong> ${esc(p.ciudad) || '—'}</div>`);
  if (p.barrio) filas.push(`<div>🧭 <strong>Barrio:</strong> ${esc(p.barrio)}</div>`);
  filas.push(`<div>🏷️ <strong>Tipo:</strong> ${esc(p.tipo) || '—'}</div>`);
  if (p.area) filas.push(`<div>📐 <strong>Área:</strong> ${p.area} m²</div>`);
  filas.push(`<div>🛏 <strong>Hab.:</strong> ${p.habitaciones != null ? p.habitaciones : '—'}</div>`);
  filas.push(`<div>🚿 <strong>Baños:</strong> ${p.banos != null ? p.banos : '—'}</div>`);
  if (p.parqueadero) filas.push(`<div>🚗 <strong>Parqueadero:</strong> ${esc(p.parqueadero)}</div>`);

  const descripcionHtml = p.descripcion
    ? `<div style="font-size:.76rem;color:rgba(255,255,255,.6);line-height:1.5;margin:.6rem 0;border-top:1px solid rgba(255,255,255,.08);padding-top:.55rem;">${esc(p.descripcion)}</div>`
    : '';

  const mensajeAgendar = `Hola, quiero agendar una visita para conocer la propiedad "${p.titulo}" que vi en el chat de Sofía. ¿Cuándo podríamos coordinarla?`;
  const mensajeWhatsApp = `Hola, tengo una pregunta sobre la propiedad "${p.titulo}" que vi en el chat de Sofía.`;

  /* "Agendar visita" intenta abrir el MISMO modal de Datos→Fecha→Hora→
     Confirmar que ya existe para las propiedades del carrusel principal
     (openModal(id) en index.html). Si por algún motivo esa propiedad no
     está cargada en PROPS (carrusel principal), sfAgendarDesdeChat cae
     de vuelta a este link de WhatsApp como respaldo — por eso igual se
     genera y se pasa, aunque el flujo normal no lo necesite.
     El apóstrofe se reemplaza por %27 porque el link va dentro de un
     atributo onclick="...('...')" con comillas simples. */
  const idPropiedad = Number.isFinite(Number(p.id)) ? Number(p.id) : 'null';
  const linkAgendarRespaldo = linkWhatsAppGeneral(mensajeAgendar, numeroGeneral).replace(/'/g, '%27');

  return `<div style="max-width:260px;background:rgba(255,255,255,.06);border:1px solid rgba(223,181,80,.3);border-radius:14px;overflow:hidden;margin-top:.4rem;">
    ${galeriaHtml}
    <div style="padding:.8rem .85rem;">
      <div style="font-size:.92rem;font-weight:700;color:#fff;margin-bottom:.2rem;line-height:1.3;">${titulo}</div>
      <div style="font-size:1.05rem;font-weight:800;color:#DFB550;margin-bottom:.5rem;">${precio}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem .5rem;font-size:.72rem;color:rgba(255,255,255,.78);">${filas.join('')}</div>
      ${descripcionHtml}
      <button onclick="sfAgendarDesdeChat(${idPropiedad}, '${linkAgendarRespaldo}')" style="display:block;width:100%;text-align:center;background:#DFB550;color:#0d1628;font-weight:800;font-size:.76rem;padding:.55rem;border-radius:9px;border:none;cursor:pointer;margin-top:.65rem;">📅 Agendar visita</button>
      <a href="${linkWhatsAppGeneral(mensajeWhatsApp, numeroGeneral)}" target="_blank" style="display:block;text-align:center;background:#25D366;color:#fff;font-weight:700;font-size:.76rem;padding:.55rem;border-radius:9px;text-decoration:none;margin-top:.4rem;">💬 Hablar por WhatsApp</a>
    </div>
  </div>`;
}

function generarTarjetasHTML(props, numeroGeneral) {
  const carruselId = 'sf-car-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  const tarjetas = props.map(p => {
    const precio = formatearPrecio(p.precio);
    const habs = p.habitaciones != null ? `${p.habitaciones} hab.` : '';
    const banos = p.banos != null ? `${p.banos} baños` : '';
    const linkInteres = generarLinkWhatsApp(p, numeroGeneral);
    const titulo = esc((p.titulo || 'Propiedad').toString().slice(0, 60));
    const imagenHtml = p.imagen
      ? `<img src="${esc(p.imagen)}" alt="${titulo}" style="width:100%;height:120px;object-fit:cover;" onerror="this.style.display='none'">`
      : `<div style="width:100%;height:80px;background:rgba(223,181,80,.08);display:flex;align-items:center;justify-content:center;font-size:2rem;">🏠</div>`;

    /* La ficha completa va embebida en base64 dentro del botón "Ver
       detalles" — así el navegador la puede mostrar sin pedirle nada
       al backend de nuevo. Solo caracteres base64, así que es seguro
       meterlo directo en un atributo HTML sin escapar más. */
    const fichaB64 = Buffer.from(generarFichaHTML(p, numeroGeneral), 'utf8').toString('base64');

    return `<div style="min-width:200px;max-width:220px;background:rgba(255,255,255,.07);border-radius:12px;overflow:hidden;flex-shrink:0;scroll-snap-align:start;border:1px solid rgba(223,181,80,.18);">
      ${imagenHtml}
      <div style="padding:.6rem .7rem">
        <div style="font-size:.78rem;font-weight:700;color:#fff;margin-bottom:.3rem;line-height:1.3;">${titulo}</div>
        <div style="font-size:.9rem;font-weight:800;color:#DFB550;margin-bottom:.25rem;">${precio}</div>
        <div style="font-size:.7rem;color:rgba(255,255,255,.55);margin-bottom:.35rem;">📍 ${esc(p.ciudad) || ''} &nbsp; 🏷️ ${esc(p.tipo) || ''}</div>
        ${(habs || banos) ? `<div style="font-size:.7rem;color:rgba(255,255,255,.5);margin-bottom:.5rem;">🛏 ${habs} &nbsp; 🚿 ${banos}</div>` : ''}
        <div style="display:flex;gap:.35rem;">
          <button data-ficha="${fichaB64}" onclick="sfVerFicha(this)" style="flex:1;background:rgba(223,181,80,.15);border:1px solid rgba(223,181,80,.4);color:#DFB550;font-weight:700;font-size:.68rem;padding:.42rem .3rem;border-radius:8px;cursor:pointer;">📋 Detalles</button>
          <a href="${linkInteres}" target="_blank" style="flex:1;text-align:center;background:#25D366;color:#fff;font-weight:700;font-size:.68rem;padding:.42rem .3rem;border-radius:8px;text-decoration:none;">💬 Interesa</a>
        </div>
      </div>
    </div>`;
  }).join('');

  /* Flechas superpuestas + indicador de posición. Toda la lógica de
     mostrar/ocultar flechas y actualizar el contador vive en el frontend
     (window.sfCarruselMover / sfCarruselActualizar en index.html); aquí
     solo se genera el marcado con un id único por si hay varios
     carruseles en la misma conversación. */
  return `<div class="sf-carrusel" id="${carruselId}" style="position:relative;">
    <div class="sf-carrusel-track" id="${carruselId}-track" onscroll="sfCarruselActualizar('${carruselId}')" style="display:flex;gap:.6rem;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;padding-bottom:.4rem;scroll-snap-type:x mandatory;">${tarjetas}</div>
    <button id="${carruselId}-izq" onclick="sfCarruselMover('${carruselId}',-1)" aria-label="Propiedades anteriores" style="display:none;position:absolute;left:2px;top:42%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;background:rgba(13,22,40,.85);border:1px solid rgba(223,181,80,.4);color:#DFB550;font-size:1rem;line-height:1;cursor:pointer;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.35);">‹</button>
    <button id="${carruselId}-der" onclick="sfCarruselMover('${carruselId}',1)" aria-label="Más propiedades" style="display:none;position:absolute;right:2px;top:42%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;background:rgba(13,22,40,.85);border:1px solid rgba(223,181,80,.4);color:#DFB550;font-size:1rem;line-height:1;cursor:pointer;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.35);">›</button>
    <div id="${carruselId}-ind" style="text-align:center;font-size:.68rem;color:rgba(255,255,255,.45);margin-top:.15rem;">${props.length} propiedad${props.length > 1 ? 'es' : ''}</div>
  </div>`;
}

module.exports = {
  normalizarFiltros,
  buscarPropiedadesFlexible,
  generarTarjetasHTML
};
