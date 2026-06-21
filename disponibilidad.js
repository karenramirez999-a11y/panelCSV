/* api/citas/disponibilidad.js → GET /api/citas/disponibilidad?fecha=YYYY-MM-DD
   Pública (sin token): el cliente la usa para ver qué horarios ya están
   ocupados antes de elegir uno, en el modal de Agendar Visita. */
const { aplicarCORS } = require('../../lib/cors');
const { supabaseAdmin } = require('../../lib/supabaseClients');
const { TIMES_LIST, esFechaValida } = require('../../lib/citasHelpers');

module.exports = async function handler(req, res) {
  aplicarCORS(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const fecha = (req.query && req.query.fecha) || '';
  if (!esFechaValida(fecha)) {
    return res.status(400).json({ ok: false, error: 'Fecha inválida (formato YYYY-MM-DD, no domingos, no fechas pasadas)' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('citas')
      .select('hora')
      .eq('fecha', fecha)
      .neq('estado', 'cancelada');

    if (error) {
      console.error('[citas/disponibilidad]', error.message);
      return res.status(500).json({ ok: false, error: 'Error consultando disponibilidad' });
    }

    const ocupadas = (data || []).map(r => r.hora);
    return res.status(200).json({
      ok: true,
      fecha,
      horasOcupadas: ocupadas,
      horasDisponibles: TIMES_LIST.filter(h => !ocupadas.includes(h))
    });
  } catch (err) {
    console.error('[citas/disponibilidad]', err);
    return res.status(500).json({ ok: false, error: 'Error inesperado' });
  }
};
