/* lib/supabaseClients.js
   Vive FUERA de /api a propósito: si estuviera dentro de /api, Vercel
   intentaría convertirlo en su propio endpoint. Aquí es solo un módulo
   que las funciones de /api importan.
*/
const { createClient } = require('@supabase/supabase-js');

/* SERVICE_ROLE: salta RLS. Solo se usa en la ruta de admin.
   NUNCA debe llegar al navegador ni a un archivo público. */
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ANON: mismo nivel de acceso que ya usaba el chat. Respeta RLS. */
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabaseAdmin, supabasePublic };
