/* api/health.js → GET /api/health */
const { aplicarCORS } = require('../lib/cors');

module.exports = async function handler(req, res) {
  aplicarCORS(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  return res.status(200).json({
    ok: true,
    servidor: 'arriba',
    hora: new Date().toISOString(),
    supabaseUrlConfigurada: !!process.env.SUPABASE_URL,
    anonKeyConfigurada: !!process.env.SUPABASE_ANON_KEY,
    serviceRoleConfigurada: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    adminTokenConfigurado: !!process.env.ADMIN_TOKEN
  });
};
