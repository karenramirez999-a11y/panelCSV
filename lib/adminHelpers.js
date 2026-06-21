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

/* La galería puede venir en una celda de Excel como varias URLs separadas
   por comas o "|". Se guarda como JSON.stringify(array) para que tanto el
   chat como el carrusel principal del sitio (que ya espera ese formato en
   la columna "imagenes") la puedan leer igual. */
function parseGaleriaServidor(v) {
  if (v == null || v === '') return null;
  const urls = String(v)
    .split(/[,|]/)
    .map(s => s.trim())
    .filter(u => /^https?:\/\//i.test(u));
  return urls.length ? JSON.stringify(urls) : null;
}

module.exports = { limpiarTexto, parsePrecioServidor, generarCodigo, parseGaleriaServidor };
