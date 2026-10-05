function booleanValue(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function boundedInteger(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name], 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// Plain object (like config/env.js) so tests can toggle individual settings.
module.exports = {
  // When false, the message log keeps "[voice note]" instead of the
  // transcript. The transcript is still used in memory to answer the customer.
  STORE_VOICE_TRANSCRIPTS: booleanValue('STORE_VOICE_TRANSCRIPTS', true),
  // Masks payment card numbers, Emirates ID numbers and IBANs in voice
  // transcripts before they are stored, logged or passed to staff.
  REDACT_SENSITIVE_DATA: booleanValue('REDACT_SENSITIVE_DATA', true),
  // Stored transcripts are replaced with a placeholder after this many days.
  VOICE_TRANSCRIPT_RETENTION_DAYS: boundedInteger('VOICE_TRANSCRIPT_RETENTION_DAYS', 90, 1, 3650),
  // Voice-note media references (WhatsApp media ids) are deleted after this
  // many days. Meta itself expires media after 30 days.
  VOICE_MEDIA_RETENTION_DAYS: boundedInteger('VOICE_MEDIA_RETENTION_DAYS', 30, 1, 3650),
  // Operational bookkeeping (dedupe claims, ordering, idempotency, CRM event
  // ids) is kept this long, then purged.
  CHATBOT_STATE_RETENTION_DAYS: boundedInteger('CHATBOT_STATE_RETENTION_DAYS', 30, 2, 3650),
  RETENTION_JOB_ENABLED: booleanValue('RETENTION_JOB_ENABLED', process.env.NODE_ENV === 'production'),
  RETENTION_JOB_INTERVAL_HOURS: boundedInteger('RETENTION_JOB_INTERVAL_HOURS', 24, 1, 24 * 7),
};
