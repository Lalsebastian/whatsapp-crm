// Ported from the pre-refactor api/webhook.js. Known limitation carried over
// deliberately: this is in-memory only, so it resets on restart and doesn't
// coordinate across multiple instances. Fine for a single Render web service;
// would need a shared store (Redis/Supabase) to be correct at scale.
const DEDUP_WINDOW_MS = 60 * 1000;
const processedMessages = new Map();

function isDuplicate(messageId) {
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_WINDOW_MS) processedMessages.delete(id);
  }
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

module.exports = { isDuplicate };
