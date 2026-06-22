const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://panel-csv-k5.vercel.app/api/google-auth'
  );

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: 'Falta code'
    });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    return res.status(200).json({
      ok: true,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};
