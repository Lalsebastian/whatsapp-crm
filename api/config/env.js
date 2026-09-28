require('dotenv').config();

function firstDefined(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

const env = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // WHATSAPP_TOKEN/VERIFY_TOKEN are the pre-refactor names; kept as fallbacks so
  // existing Render secrets keep working until they're renamed in the dashboard.
  WHATSAPP_ACCESS_TOKEN: firstDefined(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TOKEN']),
  WHATSAPP_VERIFY_TOKEN: firstDefined(['WHATSAPP_VERIFY_TOKEN', 'VERIFY_TOKEN']),
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  CLIENT_API_BASE_URL: process.env.CLIENT_API_BASE_URL,
  CLIENT_API_KEY: process.env.CLIENT_API_KEY,
  CRM_PROVIDER: process.env.CRM_PROVIDER || 'supabase',
};

module.exports = env;
