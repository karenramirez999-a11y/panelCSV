const { google } = require('googleapis');

console.log('[calendar] env client id=', process.env.GOOGLE_CLIENT_ID);
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

console.log(
  '[calendar] client id starts with:',
  process.env.GOOGLE_CLIENT_ID?.substring(0, 20)
);

const calendar = google.calendar({
  version: 'v3',
  auth: oauth2Client
});

async function crearEventoCita({
  nombre,
  telefono,
  fecha,
  hora,
  propiedad_titulo
}) {

  console.log('[calendar] fecha=', fecha);
console.log('[calendar] hora=', hora);

let hora24 = hora;

if (hora.includes('PM') && !hora.startsWith('12')) {
  const [h, m] = hora.replace(' PM', '').split(':');
  hora24 = `${String(Number(h) + 12).padStart(2, '0')}:${m}`;
} else if (hora.includes('AM')) {
  const [h, m] = hora.replace(' AM', '').split(':');

  if (h === '12') {
    hora24 = `00:${m}`;
  } else {
    hora24 = `${h.padStart(2, '0')}:${m}`;
  }
}

console.log('[calendar] hora24=', hora24);
  if (!fecha || !hora) {
  throw new Error(`Fecha u hora inválida. fecha=${fecha}, hora=${hora}`);
}

const inicio = new Date(`${fecha}T${hora24}:00`);
const fin = new Date(inicio.getTime() + 60 * 60 * 1000);

console.log('[calendar] inicio=', inicio);

  const evento = {
    summary: `Visita inmueble - ${nombre}`,
    description:
      `Cliente: ${nombre}\n` +
      `Teléfono: ${telefono}\n` +
      `Propiedad: ${propiedad_titulo || 'Sin especificar'}`,
    start: {
      dateTime: inicio.toISOString()
    },
    end: {
      dateTime: fin.toISOString()
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 60 }
      ]
    }
  };

  return calendar.events.insert({
    calendarId: 'primary',
    resource: evento
  });
}

module.exports = {
  crearEventoCita
};
