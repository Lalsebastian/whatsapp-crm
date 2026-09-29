require('dotenv').config();

function firstDefined(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

function booleanValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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
  // Server-side only. Preferred for all bot DB access so that enabling RLS
  // later can't lock the webhook out of its own tables. Falls back to the anon
  // key until the service-role secret is added to Render.
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  CLIENT_API_BASE_URL: process.env.CLIENT_API_BASE_URL,
  CLIENT_API_KEY: process.env.CLIENT_API_KEY,
  CRM_PROVIDER: process.env.CRM_PROVIDER || 'supabase',

  // Developer-only browser console. Both values are required, including in
  // production, so enabling the flag without a secret fails closed.
  ENABLE_TEST_CHAT: booleanValue(process.env.ENABLE_TEST_CHAT),
  TEST_CHAT_SECRET: process.env.TEST_CHAT_SECRET || '',
};

module.exports = env;
