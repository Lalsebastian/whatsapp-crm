function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

module.exports = Object.freeze({
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
