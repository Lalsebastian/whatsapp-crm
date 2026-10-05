// Cross-instance coordination primitives backed by Postgres (via PostgREST
// RPC). Used by keyedLock (per-customer conversation lease), messageOrder
// (newest-timestamp tracking) and actionGuard (durable idempotency claims).
//
// Why lease rows instead of pg_advisory_lock: this backend talks to Supabase
// over PostgREST, where every HTTP call is its own transaction on a pooled
// connection. A session advisory lock would be released (or leaked onto a
// pooled connection) as soon as the request returned, so it cannot be held
// across the several CRM/AI calls one message needs. A row with an owner and
// an expiry gives the same mutual exclusion and survives across requests.
//
// Every primitive degrades to process-local behaviour when the functions are
// missing (migration not applied) or the database is unreachable, logging a
// warning, because the conversation must keep working either way.
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const db = require('../db/supabaseClient');
const reliability = require('../config/reliability');
const logger = require('../utils/logger');

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

let backendOverride = null;
const warned = new Set();

function backend() {
  return backendOverride || reliability.COORDINATION_BACKEND;
}

function isDistributed() {
  return backend() === 'postgres';
}

function warnOnce(key, ...args) {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn('COORDINATION', ...args);
}

function degraded(operation, error) {
  const reason = db.isMissingFunction(error)
    ? 'database function missing — apply the chatbot reliability migration'
    : (error && error.message) || 'unknown error';
  warnOnce(`${operation}:${db.isMissingFunction(error) ? 'missing' : 'error'}`,
    `${operation} unavailable; using process-local protection:`, reason);
  logger.audit('COORDINATION_DEGRADED', { operation, result: 'degraded', reason: db.isMissingFunction(error) ? 'missing_function' : 'error' });
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function tryAcquireLease(key, owner, ttlMs) {
  const result = await db.rpc('chatbot_try_lock', { p_key: key, p_owner: owner, p_ttl_ms: ttlMs });
  return result === true || (firstRow(result) && firstRow(result).chatbot_try_lock === true);
}

async function releaseLease(key, owner) {
  await db.rpc('chatbot_release_lock', { p_key: key, p_owner: owner });
}

/** @returns {Promise<boolean>} true when the message is older than the newest one already seen */
async function recordMessageTimestamp(phone, timestamp) {
  const result = await db.rpc('chatbot_record_message_timestamp', { p_phone: phone, p_timestamp: timestamp });
  return result === true || (firstRow(result) && firstRow(result).chatbot_record_message_timestamp === true);
}

/**
 * @returns {Promise<{claimed: boolean, state: string, result: any}>}
 */
async function claimAction(key, owner, staleAfterMs) {
  const data = await db.rpc('chatbot_claim_action', { p_key: key, p_owner: owner, p_stale_after_ms: staleAfterMs });
  const row = firstRow(data) || {};
  return { claimed: !!row.claimed, state: row.state || null, result: row.result ?? null };
}

async function completeAction(key, owner, state, result) {
  await db.rpc('chatbot_complete_action', { p_key: key, p_owner: owner, p_state: state, p_result: result ?? null });
}

async function releaseAction(key, owner) {
  await db.rpc('chatbot_release_action', { p_key: key, p_owner: owner });
}

async function readAction(key) {
  const rows = await db.get('chatbot_action_claims', `action_key=eq.${encodeURIComponent(key)}&select=state,result`);
  const row = rows && rows[0];
  return row ? { state: row.state, result: row.result ?? null } : null;
}

function setBackendForTests(value) {
  backendOverride = value;
  warned.clear();
}

module.exports = {
  INSTANCE_ID,
  isDistributed,
  degraded,
  tryAcquireLease,
  releaseLease,
  recordMessageTimestamp,
  claimAction,
  completeAction,
  releaseAction,
  readAction,
  setBackendForTests,
};
