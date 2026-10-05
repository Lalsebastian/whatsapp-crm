// Exactly-once guard for customer-visible writes (bookings, complaints,
// feedback). A key is claimed before the write runs; a repeat of the same key
// returns the first result instead of writing again.
//
// The in-process map handles concurrent duplicates inside one instance. With
// the postgres coordination backend the claim is also recorded durably in
// chatbot_action_claims, so a retry that lands on another instance, or after
// a restart, sees the same outcome.
//
// States: pending -> succeeded | uncertain. A failure that definitely did not
// write (validation, 4xx) releases the claim so the customer can try again.
// An uncertain outcome (timeout, 5xx on a write) is never retried
// automatically; staff verify it in the CRM.
const config = require('../config/reliability');
const logger = require('../utils/logger');
const { sleep } = require('./asyncPolicy');
const coordination = require('./coordinationStore');

const actions = new Map();

function prune(now = Date.now()) {
  for (const [key, entry] of actions) {
    if (now - entry.createdAt > config.ACTION_IDEMPOTENCY_TTL_MS) actions.delete(key);
  }
}

function duplicateUncertainError(key, cause) {
  const error = cause instanceof Error ? cause : new Error(`Action ${key} has an uncertain outcome`);
  error.uncertain = true;
  error.duplicateBlocked = true;
  return error;
}

function serializable(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

// Resolves a claim held by someone else. Returns {value} or throws.
async function awaitExistingClaim(key, claim) {
  let current = claim;
  const deadline = Date.now() + config.ACTION_PENDING_WAIT_MS;
  while (current && current.state === 'pending' && Date.now() < deadline) {
    await sleep(250);
    current = await coordination.readAction(key);
  }
  if (current && current.state === 'succeeded') return { value: current.result, duplicate: true };
  // Still pending after the wait, or recorded as uncertain: never write again.
  throw duplicateUncertainError(key);
}

async function executeDurably(key, operation, owner) {
  let claim;
  try {
    claim = await coordination.claimAction(key, owner, config.ACTION_PENDING_STALE_MS);
  } catch (error) {
    coordination.degraded('action_claim', error);
    return null; // caller falls back to in-process protection only
  }

  if (!claim.claimed) {
    logger.audit('ACTION_DUPLICATE_DETECTED', { result: claim.state || 'unknown', source: 'durable_claim' });
    return { existing: await awaitExistingClaim(key, claim) };
  }

  try {
    const value = await operation();
    try {
      await coordination.completeAction(key, owner, 'succeeded', serializable(value));
    } catch (error) {
      // The write succeeded; only the bookkeeping failed. The in-process
      // entry still protects this instance, and the pending row turns
      // "uncertain" after the stale window, which blocks blind retries.
      logger.warn('ACTION_GUARD', 'Failed to record action success:', error.message);
    }
    return { value };
  } catch (error) {
    try {
      if (error && error.uncertain) await coordination.completeAction(key, owner, 'uncertain', null);
      else await coordination.releaseAction(key, owner);
    } catch (bookkeepingError) {
      logger.warn('ACTION_GUARD', 'Failed to record action failure:', bookkeepingError.message);
    }
    throw error;
  }
}

async function executeOnce(key, operation) {
  prune();
  const existing = actions.get(key);
  if (existing) {
    if (existing.state === 'succeeded') return { value: existing.value, duplicate: true };
    if (existing.state === 'uncertain') {
      existing.error.duplicateBlocked = true;
      throw existing.error;
    }
    const value = await existing.promise;
    return { value, duplicate: true };
  }

  const entry = { state: 'pending', createdAt: Date.now(), promise: null };
  let durableDuplicate = null;
  entry.promise = (async () => {
    if (coordination.isDistributed()) {
      const outcome = await executeDurably(key, operation, coordination.INSTANCE_ID);
      if (outcome && outcome.existing) {
        durableDuplicate = outcome.existing;
        return outcome.existing.value;
      }
      if (outcome) return outcome.value;
    }
    return operation();
  })();
  actions.set(key, entry);
  try {
    const value = await entry.promise;
    entry.state = 'succeeded';
    entry.value = value;
    return { value, duplicate: !!durableDuplicate };
  } catch (error) {
    if (error && error.uncertain) {
      entry.state = 'uncertain';
      entry.error = error;
    } else {
      actions.delete(key);
    }
    throw error;
  }
}

function clearForTests() {
  actions.clear();
}

module.exports = { executeOnce, clearForTests };
