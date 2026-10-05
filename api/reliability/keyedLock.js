// Serializes work per key (a customer's phone number).
//
// Two layers:
//   1. An in-process FIFO queue, so messages for one customer that reach this
//      instance run strictly in arrival order without touching the database.
//   2. When the coordination backend is "postgres", a renewable lease row in
//      chatbot_locks, so two instances never process the same customer's
//      messages at the same time.
const reliability = require('../config/reliability');
const logger = require('../utils/logger');
const { sleep } = require('./asyncPolicy');
const coordination = require('./coordinationStore');

const queues = new Map();
let leaseSequence = 0;

async function acquireDistributedLease(key) {
  const leaseKey = `conversation:${key}`;
  const owner = `${coordination.INSTANCE_ID}:${(leaseSequence += 1)}`;
  const ttlMs = reliability.CONVERSATION_LOCK_TTL_MS;
  const deadline = Date.now() + reliability.CONVERSATION_LOCK_WAIT_MS;
  let waited = false;

  while (true) {
    let acquired;
    try {
      acquired = await coordination.tryAcquireLease(leaseKey, owner, ttlMs);
    } catch (error) {
      coordination.degraded('conversation_lock', error);
      return null;
    }
    if (acquired) {
      if (waited) logger.audit('CONVERSATION_LOCK_WAITED', { result: 'acquired' });
      break;
    }
    if (Date.now() >= deadline) {
      // Another instance is still holding this customer after the wait
      // budget. Processing late beats dropping the message; the lease TTL
      // already bounds how long a crashed holder can block.
      logger.warn('LOCK', 'Conversation lease wait exceeded; processing without the lease');
      logger.audit('CONVERSATION_LOCK_TIMEOUT', { result: 'proceeded' });
      return null;
    }
    waited = true;
    await sleep(reliability.CONVERSATION_LOCK_POLL_MS);
  }

  // Renew well before expiry so a long message (AI + several CRM calls) keeps
  // exclusive ownership for as long as it is actually running.
  const heartbeat = setInterval(() => {
    coordination.tryAcquireLease(leaseKey, owner, ttlMs).catch((error) => {
      logger.warn('LOCK', 'Conversation lease renewal failed:', error.message);
    });
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  return async () => {
    clearInterval(heartbeat);
    try {
      await coordination.releaseLease(leaseKey, owner);
    } catch (error) {
      // The lease expires on its own; a failed release only delays the next
      // message for this customer by at most the TTL.
      logger.warn('LOCK', 'Conversation lease release failed:', error.message);
    }
  };
}

async function withKeyLock(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(key, current);

  await previous.catch(() => {});
  let releaseLease = null;
  try {
    if (coordination.isDistributed()) releaseLease = await acquireDistributedLease(key);
    return await operation();
  } finally {
    if (releaseLease) await releaseLease();
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
}

function clearForTests() {
  queues.clear();
}

module.exports = { withKeyLock, clearForTests };
