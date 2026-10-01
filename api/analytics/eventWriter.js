const { createHash, createHmac, randomUUID } = require('node:crypto');
const db = require('../db/supabaseClient');
const env = require('../config/env');
const { getRequestContext } = require('../reliability/requestContext');
const testChannel = require('../whatsapp/testChannel');

const TABLE = 'chatbot_analytics_events';
const WRITE_TIMEOUT_MS = 1500;
const MAX_TEST_CONVERSATIONS = 100;
const MAX_TEST_EVENTS = 30;
const testEvents = new Map();

const PRIVATE_KEYS = /(?:phone|address|transcript|prompt|description|comment|summary|customerMessage|originalCustomerMessage|content|body|audio)/i;
const TOP_LEVEL_FIELDS = new Set([
  'result', 'phone', 'correlationId', 'messageId', 'sessionId', 'customerId',
  'flow', 'step', 'serviceId', 'bookingId', 'complaintId', 'feedbackId',
  'language', 'source', 'occurredAt', 'dedupeKey',
]);

function phoneHash(phone) {
  if (!phone) return null;
  const value = String(phone).trim();
  const secret = env.ANALYTICS_HASH_SALT || env.SUPABASE_SERVICE_ROLE_KEY;
  return secret
    ? createHmac('sha256', secret).update(value).digest('hex')
    : createHash('sha256').update(value).digest('hex');
}

function sessionHash(sessionId, phone) {
  const value = sessionId || phone;
  if (!value) return null;
  return phoneHash(`session:${String(value).trim()}`);
}

function sanitize(value, depth = 0) {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.slice(0, 300);
    return value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const safeMessageCount = key === 'customerMessages' && typeof item === 'number';
    if (PRIVATE_KEYS.test(key) && !safeMessageCount) continue;
    const safe = sanitize(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function normalizeEvent(eventType, context = {}, metadata = {}) {
  const request = getRequestContext();
  const merged = { ...context, ...metadata };
  const correlationId = context.correlationId || request.correlationId || null;
  const messageId = context.messageId || request.messageId || null;
  const phone = context.phone || request.phone || null;
  const eventMetadata = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!TOP_LEVEL_FIELDS.has(key) && value !== undefined) eventMetadata[key] = value;
  }
  if (context.result !== undefined) eventMetadata.result = context.result;
  const rawDedupe = context.dedupeKey || [
    correlationId,
    eventType,
    context.bookingId,
    context.complaintId,
    context.feedbackId,
    context.serviceId,
  ].filter(Boolean).join(':') || randomUUID();
  return {
    event_type: String(eventType).slice(0, 100),
    occurred_at: context.occurredAt || new Date().toISOString(),
    correlation_id: correlationId,
    message_id: messageId,
    dedupe_key: createHash('sha256').update(rawDedupe).digest('hex'),
    // Session keys are currently phone-based in the chatbot. Persist only a
    // stable pseudonymous derivative so the analytics table never receives the
    // raw WhatsApp identifier through this field.
    session_id: sessionHash(context.sessionId, phone),
    customer_id: context.customerId || null,
    phone_hash: phoneHash(phone),
    flow: context.flow || null,
    step: context.step || null,
    service_id: context.serviceId || null,
    booking_id: context.bookingId || null,
    complaint_id: context.complaintId || null,
    feedback_id: context.feedbackId || null,
    language: context.language || null,
    source: context.source || null,
    metadata: sanitize(eventMetadata),
  };
}

function recordTestEvent(phone, row) {
  const key = String(phone || 'unknown');
  const events = testEvents.get(key) || [];
  events.push({
    eventType: row.event_type,
    flow: row.flow,
    step: row.step,
    source: row.source,
    metadata: row.metadata,
  });
  testEvents.delete(key);
  testEvents.set(key, events.slice(-MAX_TEST_EVENTS));
  while (testEvents.size > MAX_TEST_CONVERSATIONS) testEvents.delete(testEvents.keys().next().value);
}

async function trackEvent(eventType, context = {}, metadata = {}) {
  let timer;
  try {
    const row = normalizeEvent(eventType, context, metadata);
    if (env.NODE_ENV === 'test' || testChannel.isCapturing()) {
      recordTestEvent(context.phone || getRequestContext().phone, row);
      return { stored: false, test: true, event: row };
    }
    await Promise.race([
      db.upsert(TABLE, row, { onConflict: 'dedupe_key' }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Analytics write timed out');
          error.code = 'ANALYTICS_TIMEOUT';
          reject(error);
        }, WRITE_TIMEOUT_MS);
      }),
    ]);
    return { stored: true, event: row };
  } catch (error) {
    console.error('[ANALYTICS_WRITE_FAILED]', error.code || error.message);
    return { stored: false, error: error.code || error.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getTestEvents(phone) {
  return [...(testEvents.get(String(phone || 'unknown')) || [])];
}

function clearTestEvents(phone) {
  if (phone) testEvents.delete(String(phone));
  else testEvents.clear();
}

module.exports = {
  trackEvent,
  normalizeEvent,
  getTestEvents,
  clearTestEvents,
  TABLE,
};
