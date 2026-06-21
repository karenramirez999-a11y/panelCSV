/* lib/cors.js — encabezados CORS compartidos por las funciones de /api */
function aplicarCORS(res, metodos) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', metodos || 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
}

module.exports = { aplicarCORS };
