// Session/state persistence, extending the pre-existing `sessions` table
// (phone PK, legacy state/data columns) with the fields the conversation
// router actually reads back: current_flow/current_step/context. This is what
// makes multi-step flows (booking, complaints) survive across messages —
// the legacy webhook.js wrote `state`/`data` but never read them back on
// free-text replies, so flows never completed. sessionStore fixes that.
const db = require('../db/supabaseClient');
const reliability = require('../config/reliability');

function mapSession(row) {
  return {
    phone: row.phone,
    customerId: row.customer_id || null,
    currentFlow: row.current_flow || null,
    currentStep: row.current_step || null,
    context: row.context || {},
    preferredLanguage: row.preferred_language || null,
    humanTakeover: !!row.human_takeover,
    lastActivityAt: row.last_activity_at,
  };
}

async function getOrCreateSession(phone) {
  const rows = await db.get('sessions', `phone=eq.${encodeURIComponent(phone)}&select=*`);
  if (rows && rows.length > 0) return mapSession(rows[0]);

  const created = await db.upsert(
    'sessions',
    {
      phone,
      state: 'IDLE',
      data: {},
      context: {},
      human_takeover: false,
      last_activity_at: new Date().toISOString(),
    },
    { onConflict: 'phone' }
  );
  return mapSession(Array.isArray(created) ? created[0] : created);
}

async function updateSession(phone, patch) {
  const payload = { last_activity_at: new Date().toISOString() };
  if (patch.customerId !== undefined) payload.customer_id = patch.customerId;
  if (patch.currentFlow !== undefined) payload.current_flow = patch.currentFlow;
  if (patch.currentStep !== undefined) payload.current_step = patch.currentStep;
  if (patch.context !== undefined) payload.context = patch.context;
  if (patch.preferredLanguage !== undefined) payload.preferred_language = patch.preferredLanguage;
  if (patch.humanTakeover !== undefined) payload.human_takeover = patch.humanTakeover;

  const updated = await db.patch('sessions', `phone=eq.${encodeURIComponent(phone)}`, payload);
  return mapSession(Array.isArray(updated) ? updated[0] : updated);
}

async function setFlow(phone, flow, step, context = {}) {
  return updateSession(phone, { currentFlow: flow, currentStep: step, context });
}

async function clearFlow(phone) {
  return updateSession(phone, { currentFlow: null, currentStep: null, context: {} });
}

// Developer test-console reset: clear conversational state for exactly one
// phone identity without deleting its customer, properties, bookings, or
// complaints. Also releases human takeover so the next greeting is fresh.
async function resetSession(phone) {
  const payload = {
    state: 'IDLE',
    data: {},
    current_flow: null,
    current_step: null,
    context: {},
    human_takeover: false,
    last_activity_at: new Date().toISOString(),
  };
  const updated = await db.patch('sessions', `phone=eq.${encodeURIComponent(phone)}`, payload);
  return updated && updated.length > 0 ? mapSession(updated[0]) : null;
}

async function setHumanTakeover(phone, value) {
  return updateSession(phone, { humanTakeover: value });
}

async function touchActivity(phone) {
  return db.patch('sessions', `phone=eq.${encodeURIComponent(phone)}`, {
    last_activity_at: new Date().toISOString(),
  });
}

function isExpired(session, now = Date.now()) {
  if (!session || session.humanTakeover || !session.currentFlow || !session.currentStep) return false;
  const lastActivity = Date.parse(session.lastActivityAt);
  if (!Number.isFinite(lastActivity)) return false;
  return now - lastActivity > reliability.SESSION_TTL_MINUTES * 60 * 1000;
}

module.exports = { getOrCreateSession, updateSession, setFlow, clearFlow, resetSession, setHumanTakeover, touchActivity, isExpired };
