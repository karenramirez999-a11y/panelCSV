/* lib/citasHelpers.js — validaciones compartidas para el sistema real de agendamiento
   IMPORTANTE: TIMES_LIST debe coincidir exactamente con TIMES_LIST en index.html
   (la lista de horarios que ve el cliente en el modal de Agendar Visita). */

const TIMES_LIST = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];

function limpiarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

/* Fecha en formato YYYY-MM-DD. Sin domingos (igual que el calendario del
   sitio, que deshabilita los domingos) y sin fechas pasadas. */
function esFechaValida(fechaStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr || '')) return false;
  const partes = fechaStr.split('-').map(Number);
  const fecha = new Date(partes[0], partes[1] - 1, partes[2]);
  if (isNaN(fecha.getTime())) return false;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (fecha < hoy) return false;
  if (fecha.getDay() === 0) return false; // domingo

  return true;
}

function esHoraValida(horaStr) {
  return TIMES_LIST.includes(horaStr);
}

module.exports = { TIMES_LIST, limpiarTexto, esFechaValida, esHoraValida };
