/* lib/adminHelpers.js — validación/normalización para la carga masiva */

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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `propiedad-${Date.now()}`;
}

module.exports = { limpiarTexto, parsePrecioServidor, generarCodigo };
