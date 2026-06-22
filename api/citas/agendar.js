/* api/citas/agendar.js → POST /api/citas/agendar
   Pública (sin token): la usa el modal "Agendar Visita" de index.html
   (tanto desde el carrusel principal como desde el botón de Sofía). */
const { aplicarCORS } = require('../../lib/cors');
const { supabaseAdmin } = require('../../lib/supabaseClients');
const { limpiarTexto, esFechaValida, esHoraValida } = require('../../lib/citasHelpers');
const { notificarNuevaVisita } = require('../../lib/notificaciones');
const { crearEventoCita } = require('../../lib/googleCalendar');

module.exports = async function handler(req, res) {
  aplicarCORS(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const nombre = limpiarTexto(body.nombre);
    const telefono = limpiarTexto(body.telefono);
    const fecha = limpiarTexto(body.fecha);
    const hora = limpiarTexto(body.hora);
    const modalidad = limpiarTexto(body.modalidad) || 'Presencial en la propiedad';
    const propiedadId = (body.propiedad_id != null && body.propiedad_id !== '') ? Number(body.propiedad_id) : null;
    const propiedadTitulo = limpiarTexto(body.propiedad_titulo) || null;

    if (!nombre || !telefono) {
      return res.status(400).json({ ok: false, error: 'Nombre y WhatsApp son obligatorios' });
    }
    if (!esFechaValida(fecha)) {
      return res.status(400).json({ ok: false, error: 'Selecciona una fecha válida (no domingos, no fechas pasadas)' });
    }
    if (!esHoraValida(hora)) {
      return res.status(400).json({ ok: false, error: 'Selecciona un horario válido' });
    }

    /* Revalida disponibilidad justo antes de insertar. Esto reduce, pero no
       elimina del todo, la posibilidad de que dos personas reserven el mismo
       instante exacto — por eso el respaldo definitivo es el índice único
       parcial en la base de datos (ver SQL), que rechaza el insert si ya
       existe una cita activa en esa fecha+hora, sin importar la condición
       de carrera. */
    const { data: ocupado, error: errorCheck } = await supabaseAdmin
      .from('citas')
      .select('id')
      .eq('fecha', fecha)
      .eq('hora', hora)
      .neq('estado', 'cancelada')
      .maybeSingle();

    if (errorCheck) {
      console.error('[citas/agendar] error verificando disponibilidad:', errorCheck.message);
      return res.status(500).json({ ok: false, error: 'Error verificando disponibilidad' });
    }
    if (ocupado) {
      return res.status(409).json({ ok: false, error: 'ocupado', mensaje: 'Ese horario ya fue tomado por otra persona. Elige otro horario.' });
    }

    const { data, error } = await supabaseAdmin
      .from('citas')
      .insert([{
        nombre,
        telefono,
        fecha,
        hora,
        modalidad,
        propiedad_id: propiedadId,
        propiedad_titulo: propiedadTitulo,
        estado: 'pendiente',
        leida: false
      }])
      .select('id')
      .single();

    if (error) {
      // 23505 = choque contra el índice único (alguien más reservó en el mismo instante)
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, error: 'ocupado', mensaje: 'Ese horario ya fue tomado por otra persona. Elige otro horario.' });
      }
      console.error('[citas/agendar] error insertando:', error.message, '| code:', error.code);
      return res.status(500).json({ ok: false, error: 'No se pudo agendar la visita' });
    }

    /* ── Crear (o reutilizar) un Lead automáticamente a partir de esta visita ──
       Esto es "best effort": si falla, NUNCA debe tumbar la reserva de la
       visita en sí — la cita ya quedó guardada arriba. */
    let leadId = null;
    try {
      const { data: leadExistente } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('telefono', telefono)
        .limit(1)
        .maybeSingle();

      if (leadExistente) {
        leadId = leadExistente.id; // ya existe un lead con este teléfono: lo reutilizamos
      } else {
        const interes = propiedadTitulo
          ? `Visita agendada: ${propiedadTitulo}`
          : 'Visita agendada desde el sitio';

        const { data: nuevoLead, error: errorLead } = await supabaseAdmin
          .from('leads')
          .insert([{
            nombre,
            telefono,
            interes,
            origen: 'landing',
            // Sin "estado": dejamos que la columna use su valor por
            // defecto en Supabase — así no chocamos con leads_estado_check
            // sin tener que adivinar la palabra exacta que acepta.
            notas: `Agendó visita el ${fecha} a las ${hora} (${modalidad}).`
          }])
          .select('id')
          .single();

        if (errorLead) {
          console.error('[citas/agendar] no se pudo crear el lead automático:', errorLead.message);
        } else {
          leadId = nuevoLead.id;
        }
      }

      if (leadId) {
        await supabaseAdmin.from('citas').update({ lead_id: leadId }).eq('id', data.id);
      }
    } catch (errLead) {
      console.error('[citas/agendar] error inesperado creando lead automático:', errLead);
    }

    /* ── Avisos automáticos al administrador (correo + WhatsApp) ──
       También "best effort": si Resend o Twilio fallan o no están
       configurados, la visita ya quedó guardada arriba de todas formas. */
    try {
  await notificarNuevaVisita({
    nombre,
    telefono,
    fecha,
    hora,
    modalidad,
    propiedad_titulo: propiedadTitulo
  });
} catch (errNotif) {
  console.error('[citas/agendar] error inesperado en notificaciones automáticas:', errNotif);
}

try {
  await crearEventoCita({
    nombre,
    telefono,
    fecha,
    hora,
    propiedad_titulo: propiedadTitulo
  });
} catch (errCalendar) {
  console.error(
    '[citas/agendar] error creando evento en Google Calendar:',
    errCalendar
  );
}

    return res.status(200).json({ ok: true, id: data.id, lead_id: leadId });
  } catch (err) {
    console.error('[citas/agendar]', err);
    return res.status(500).json({ ok: false, error: 'Error inesperado agendando la visita' });
  }
};
