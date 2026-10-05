function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// "postgres" coordinates every instance through Supabase tables/functions
// (see supabase/migrations/*_chatbot_reliability_lifecycle.sql); "memory" is
// single-process only. Production defaults to postgres so scaling out never
// silently weakens duplicate protection.
function coordinationBackend() {
  const configured = String(process.env.COORDINATION_BACKEND || '').trim().toLowerCase();
  if (['postgres', 'memory'].includes(configured)) return configured;
  return process.env.NODE_ENV === 'production' ? 'postgres' : 'memory';
}

module.exports = Object.freeze({
  COORDINATION_BACKEND: coordinationBackend(),
  // Lease length for the per-customer conversation lock. The holder renews it
  // while processing, so this only bounds recovery after a crashed instance.
  CONVERSATION_LOCK_TTL_MS: positiveInteger('CONVERSATION_LOCK_TTL_MS', 30000),
  // How long a message waits for another instance to finish the same
  // customer's previous message before it is processed anyway.
  CONVERSATION_LOCK_WAIT_MS: positiveInteger('CONVERSATION_LOCK_WAIT_MS', 20000),
  CONVERSATION_LOCK_POLL_MS: positiveInteger('CONVERSATION_LOCK_POLL_MS', 150),
  // A claimed action still "pending" after this long belonged to an instance
  // that died mid-write; its outcome is treated as uncertain, never retried.
  ACTION_PENDING_STALE_MS: positiveInteger('ACTION_PENDING_STALE_MS', 120000),
  ACTION_PENDING_WAIT_MS: positiveInteger('ACTION_PENDING_WAIT_MS', 15000),
  CRM_REQUEST_TIMEOUT_MS: positiveInteger('CRM_REQUEST_TIMEOUT_MS', 10000),
  AI_REQUEST_TIMEOUT_MS: positiveInteger('AI_REQUEST_TIMEOUT_MS', 10000),
  WHATSAPP_REQUEST_TIMEOUT_MS: positiveInteger('WHATSAPP_REQUEST_TIMEOUT_MS', 10000),
  SESSION_TTL_MINUTES: positiveInteger('SESSION_TTL_MINUTES', 60),
  MAX_READ_RETRIES: nonNegativeInteger('MAX_READ_RETRIES', 2),
  WHATSAPP_MAX_RETRIES: nonNegativeInteger('WHATSAPP_MAX_RETRIES', 2),
  RETRY_BASE_DELAY_MS: positiveInteger('RETRY_BASE_DELAY_MS', 250),
  PROVIDER_FAILURE_THRESHOLD: positiveInteger('PROVIDER_FAILURE_THRESHOLD', 5),
  PROVIDER_COOLDOWN_MS: positiveInteger('PROVIDER_COOLDOWN_MS', 30000),
  ACTION_IDEMPOTENCY_TTL_MS: positiveInteger('ACTION_IDEMPOTENCY_TTL_MS', 24 * 60 * 60 * 1000),
});
