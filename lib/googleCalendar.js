const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

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
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  const fin = new Date(inicio.getTime() + 60 * 60 * 1000);

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
