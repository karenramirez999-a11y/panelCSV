const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  const { code } = req.query;

  if (code) {
    return res.status(200).json({
      ok: true,
      code
    });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://panel-csv-k5.vercel.app/api/google-auth'
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar']
  });

  return res.redirect(url);
};
