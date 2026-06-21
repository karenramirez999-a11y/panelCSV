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
    const resultado = await buscarPropiedadesFlexible(filtros);

    if (resultado.propiedades.length > 0) {
      const html = generarTarjetasHTML(resultado.propiedades, WHATSAPP_NUMERO_GENERAL);
      return res.status(200).json({
        ok: true,
        encontrado: true,
        nivel: resultado.nivel, // 'flexible' | 'sin_ciudad' | 'sin_tipo' | 'general'
        total: resultado.propiedades.length,
        html
      });
    }

    // Sin resultados ni flexibilizando: el front muestra su botón de WhatsApp
    return res.status(200).json({ ok: true, encontrado: false });
  } catch (err) {
    console.error('[api/chat]', err);
    return res.status(500).json({ ok: false, encontrado: false, error: 'Error buscando propiedades' });
  }
};
