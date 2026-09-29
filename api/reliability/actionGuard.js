const config = require('../config/reliability');

const actions = new Map();

function prune(now = Date.now()) {
  for (const [key, entry] of actions) {
    if (now - entry.createdAt > config.ACTION_IDEMPOTENCY_TTL_MS) actions.delete(key);
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
  entry.promise = Promise.resolve().then(operation);
  actions.set(key, entry);
  try {
    const value = await entry.promise;
    entry.state = 'succeeded';
    entry.value = value;
    return { value, duplicate: false };
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
