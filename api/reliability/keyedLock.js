const queues = new Map();

async function withKeyLock(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(key, current);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
}

function clearForTests() {
  queues.clear();
}

module.exports = { withKeyLock, clearForTests };
