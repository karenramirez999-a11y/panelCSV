/* lib/chatHelpers.js — búsqueda flexible + tarjetas HTML para el chat de Sofía */
const { supabasePublic } = require('./supabaseClients');

/* Margen de presupuesto: tope 300M → busca entre 65% y 110% (~195M–330M).
   Ajusta estos dos números si quieres un margen más o menos amplio. */
const MARGEN_INFERIOR = 0.35;
const MARGEN_SUPERIOR = 0.10;

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

async function ejecutarBusqueda({ tipo, ciudad, rango, conTipo, conCiudad }) {
  let query = supabasePublic
    .from('propiedades')
    .select('*')
    .eq('activo', true)
    .or('vendido.is.null,vendido.eq.false') // no excluye "vendido" en NULL
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

async function buscarPropiedadesFlexible(filtros) {
  const rango = calcularRangoPresupuesto(filtros.presupuesto);

  let props = await ejecutarBusqueda({ ...filtros, rango, conTipo: true, conCiudad: true });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'flexible' };

  props = await ejecutarBusqueda({ ...filtros, rango, conTipo: true, conCiudad: false });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'sin_ciudad' };

  props = await ejecutarBusqueda({ ...filtros, rango, conTipo: false, conCiudad: true });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'sin_tipo' };

  const rangoAmplio = filtros.presupuesto
    ? { inferior: Math.round(filtros.presupuesto * 0.5), superior: Math.round(filtros.presupuesto * 1.25) }
    : null;
  props = await ejecutarBusqueda({ ...filtros, rango: rangoAmplio, conTipo: false, conCiudad: false });
  if (props.length) return { propiedades: rankear(props, filtros).slice(0, 6), nivel: 'general' };

  return { propiedades: [], nivel: 'ninguno' };
}

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

module.exports = {
  normalizarFiltros,
  buscarPropiedadesFlexible,
  generarTarjetasHTML
};
