/* api/chat.js → POST /api/chat */
const { aplicarCORS } = require('../lib/cors');
const { normalizarFiltros, buscarPropiedadesFlexible, generarTarjetasHTML } = require('../lib/chatHelpers');

const WHATSAPP_NUMERO_GENERAL = process.env.WHATSAPP_NUMERO_GENERAL || '573206922370';

module.exports = async function handler(req, res) {
  aplicarCORS(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const filtros = normalizarFiltros(body);

    console.log('[api/chat] ════════════════════════════════════════');
    console.log('[api/chat] body recibido:', JSON.stringify(body));

    const resultado = await buscarPropiedadesFlexible(filtros);

    console.log(`[api/chat] resultado final → nivel="${resultado.nivel}", total=${resultado.propiedades.length}`);
    console.log('[api/chat] ════════════════════════════════════════');

    /* ── Error real de consulta (columna inexistente, tabla mal escrita,
       credenciales sin permiso, etc.) ──
       TEMPORAL PARA DEPURAR: se expone el mensaje real de Postgres/Supabase
       en la respuesta. Quita este bloque (o protégelo detrás de una
       bandera de entorno) antes de pasar a producción definitiva, para no
       filtrar detalles del esquema de tu base de datos a quien inspeccione
       la red del navegador. */
    if (resultado.nivel === 'error_consulta') {
      return res.status(500).json({
        ok: false,
        encontrado: false,
        nivel: resultado.nivel,
        error: resultado.error,
        codigoError: resultado.codigoError || null
      });
    }

    if (resultado.propiedades.length > 0) {
      const html = generarTarjetasHTML(resultado.propiedades, WHATSAPP_NUMERO_GENERAL);
      return res.status(200).json({
        ok: true,
        encontrado: true,
        nivel: resultado.nivel, // 'exacto' | 'flexible_10' | 'flexible_20' | 'sin_ciudad' | 'sin_tipo' | 'general' | 'cualquier_precio'
        total: resultado.propiedades.length,
        html
      });
    }

    // Solo llega aquí si NO hay ninguna propiedad activa/no-vendida en
    // toda la tabla (nivel 'sin_inventario') — esto sí es "no encontrado" real.
    return res.status(200).json({ ok: true, encontrado: false, nivel: resultado.nivel });
  } catch (err) {
    console.error('[api/chat] ERROR inesperado:', err);
    return res.status(500).json({ ok: false, encontrado: false, error: err.message || 'Error buscando propiedades' });
  }
};
