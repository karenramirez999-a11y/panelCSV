/* lib/notificaciones.js — avisos automáticos al administrador cuando se agenda una visita.
   Correo vía Resend, WhatsApp vía Twilio (Sandbox o número de producción).
   Ambos son "best effort": si fallan, NUNCA deben tumbar el agendamiento de
   la visita en sí — por eso usan Promise.allSettled y solo dejan un
   console.error, nunca lanzan el error hacia arriba. */

async function enviarCorreoNuevaVisita(cita) {
  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.NOTIF_EMAIL_DESTINO;

  if (!apiKey || !destino) {
    console.warn('[notificaciones] Falta RESEND_API_KEY o NOTIF_EMAIL_DESTINO — correo no enviado');
    return;
  }

  const asunto = `📅 Nueva visita agendada${cita.propiedad_titulo ? ' — ' + cita.propiedad_titulo : ''}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;color:#1E1A16">
      <h2 style="color:#B38E46;margin-bottom:4px">Nueva visita agendada</h2>
      <p><strong>Cliente:</strong> ${escHtml(cita.nombre)}</p>
      <p><strong>Teléfono:</strong> ${escHtml(cita.telefono)}</p>
      ${cita.propiedad_titulo ? `<p><strong>Propiedad:</strong> ${escHtml(cita.propiedad_titulo)}</p>` : ''}
      <p><strong>Fecha:</strong> ${escHtml(cita.fecha)}</p>
      <p><strong>Hora:</strong> ${escHtml(cita.hora)}</p>
      <p><strong>Modalidad:</strong> ${escHtml(cita.modalidad)}</p>
      <p style="margin-top:16px;color:#888;font-size:12px">Sueños Inmobiliarios · Notificación automática</p>
    </div>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.NOTIF_EMAIL_FROM || 'onboarding@resend.dev',
        to: destino,
        subject: asunto,
        html
      })
    });
    if (!resp.ok) {
      console.error('[notificaciones] Resend respondió con error:', resp.status, await resp.text());
    }
  } catch (err) {
    console.error('[notificaciones] error inesperado enviando correo:', err);
  }
}

async function enviarWhatsAppNuevaVisita(cita) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // ej: whatsapp:+14155238886 (sandbox)
  const to = process.env.TWILIO_WHATSAPP_TO;     // ej: whatsapp:+573206922370

  if (!sid || !token || !from || !to) {
    console.warn('[notificaciones] Faltan variables de Twilio — WhatsApp no enviado');
    return;
  }

  const mensaje = `📅 *Nueva visita agendada*\n`
    + `Cliente: ${cita.nombre}\n`
    + `Tel: ${cita.telefono}\n`
    + (cita.propiedad_titulo ? `Propiedad: ${cita.propiedad_titulo}\n` : '')
    + `Fecha: ${cita.fecha} · Hora: ${cita.hora}\n`
    + `Modalidad: ${cita.modalidad}`;

  try {
    const params = new URLSearchParams({ From: from, To: to, Body: mensaje });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    if (!resp.ok) {
      console.error('[notificaciones] Twilio respondió con error:', resp.status, await resp.text());
    }
  } catch (err) {
    console.error('[notificaciones] error inesperado enviando WhatsApp:', err);
  }
}

function escHtml(v) {
  return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Punto de entrada único: dispara ambos canales en paralelo, sin que uno
   bloquee al otro ni que ninguno bloquee la respuesta al cliente. */
async function notificarNuevaVisita(cita) {
  await Promise.allSettled([
    enviarCorreoNuevaVisita(cita),
    enviarWhatsAppNuevaVisita(cita)
  ]);
}

module.exports = { notificarNuevaVisita, enviarCorreoNuevaVisita, enviarWhatsAppNuevaVisita };
