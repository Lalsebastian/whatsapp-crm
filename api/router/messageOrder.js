// Drops a message that is clearly older than one already processed for the
// same customer (WhatsApp can redeliver or reorder). With the postgres
// coordination backend the newest timestamp is shared by every instance;
// otherwise, or if the database function is unavailable, it is tracked in
// this process only.
const coordination = require('../reliability/coordinationStore');

const newestTimestampByPhone = new Map();

function isStaleLocally(phone, parsed) {
  const newest = newestTimestampByPhone.get(phone);
  if (newest !== undefined && parsed < newest) return true;
  if (newest === undefined || parsed > newest) newestTimestampByPhone.set(phone, parsed);
  return false;
}

async function isClearlyStale(phone, timestamp) {
  const parsed = Number(timestamp);
  if (!phone || !Number.isFinite(parsed) || parsed <= 0) return false;
  if (coordination.isDistributed()) {
    try {
      const stale = await coordination.recordMessageTimestamp(phone, parsed);
      // Keep the local view current too, so a later database outage still
      // has the latest known ordering for this process.
      isStaleLocally(phone, parsed);
      return stale;
    } catch (error) {
      coordination.degraded('message_order', error);
    }
  }
  return isStaleLocally(phone, parsed);
}

function clearForTests() {
  newestTimestampByPhone.clear();
}

module.exports = { isClearlyStale, clearForTests };
