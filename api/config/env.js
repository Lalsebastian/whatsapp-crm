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
  // Meta App Secret (App Dashboard > Settings > Basic). Used to verify the
  // X-Hub-Signature-256 header on every webhook POST. Required in production:
  // without it the webhook rejects all deliveries rather than trusting them.
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  // Server-side only. Preferred for all bot DB access so that enabling RLS
  // later can't lock the webhook out of its own tables. Falls back to the anon
  // key until the service-role secret is added to Render.
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_CONFIGURED: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  CLIENT_API_BASE_URL: process.env.CLIENT_API_BASE_URL,
  CLIENT_API_KEY: process.env.CLIENT_API_KEY,
  CRM_PROVIDER: process.env.CRM_PROVIDER || 'supabase',
  // Optional JSON object overriding individual HTTP CRM endpoint paths, e.g.
  // {"createBookings":"/v2/bookings/bulk"}. See crm/HTTP_CRM_CONTRACT.md.
  CLIENT_API_ENDPOINTS: process.env.CLIENT_API_ENDPOINTS || '',
  // Header carrying CLIENT_API_KEY. "Authorization" sends "Bearer <key>";
  // any other name (e.g. "x-api-key") sends the raw key.
  CLIENT_API_AUTH_HEADER: process.env.CLIENT_API_AUTH_HEADER || 'Authorization',

  // IANA timezone the business operates in. Relative dates ("today"),
  // past-slot filtering and slot timestamps are computed in this zone.
  BUSINESS_TIMEZONE: process.env.BUSINESS_TIMEZONE || 'Asia/Dubai',
  // How many days ahead the booking flow offers dates with real availability.
  BOOKING_DATE_WINDOW_DAYS: Math.min(30, Math.max(1, Number(process.env.BOOKING_DATE_WINDOW_DAYS) || 7)),

  // Developer-only browser console. Both values are required, including in
  // production, so enabling the flag without a secret fails closed.
  ENABLE_TEST_CHAT: booleanValue(process.env.ENABLE_TEST_CHAT),
  TEST_CHAT_SECRET: process.env.TEST_CHAT_SECRET || '',

  // Shared secret for POST /api/crm/events (booking lifecycle events from the
  // CRM). Requests must carry X-CRM-Signature: sha256=HMAC(secret, raw body)
  // or "Authorization: Bearer <secret>". Unset = endpoint disabled (404).
  CRM_WEBHOOK_SECRET: process.env.CRM_WEBHOOK_SECRET || '',

  // Approved WhatsApp message templates for business-initiated messages.
  // Outside the 24-hour customer-service window WhatsApp only delivers
  // templates; when a name is unset the bot skips that notification instead
  // of sending a free-form message that would be silently dropped.
  WHATSAPP_TEMPLATE_LANGUAGE: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
  WHATSAPP_TEMPLATE_BOOKING_ASSIGNED: process.env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED || '',
  WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY: process.env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY || '',
  WHATSAPP_TEMPLATE_FEEDBACK_REQUEST: process.env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST || '',
  // A feedback request stays answerable this long (normal flows expire after
  // SESSION_TTL_MINUTES of inactivity).
  FEEDBACK_REQUEST_TTL_HOURS: Math.min(14 * 24, Math.max(1, Number(process.env.FEEDBACK_REQUEST_TTL_HOURS) || 72)),

  REVIEWS_ENABLED: booleanValue(process.env.REVIEWS_ENABLED),
  PUBLIC_REVIEW_URL: process.env.PUBLIC_REVIEW_URL || '',
  REVIEW_MIN_RATING: Math.min(5, Math.max(1, Number(process.env.REVIEW_MIN_RATING) || 4)),

  // Dedicated HMAC salt for pseudonymous analytics identifiers. Keep this
  // server-side and stable across deployments so phone hashes remain useful.
  ANALYTICS_HASH_SALT: process.env.ANALYTICS_HASH_SALT || '',

  // Management analytics is intentionally separate from the public CRM
  // frontend until real dashboard authentication is available. Both values
  // are required so the server fails closed by default.
  ENABLE_CHATBOT_ANALYTICS_DASHBOARD: booleanValue(process.env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD),
  CHATBOT_ANALYTICS_SECRET: process.env.CHATBOT_ANALYTICS_SECRET || '',
};

module.exports = env;
