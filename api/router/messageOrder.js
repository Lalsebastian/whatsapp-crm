const newestTimestampByPhone = new Map();

function isClearlyStale(phone, timestamp) {
  const parsed = Number(timestamp);
  if (!phone || !Number.isFinite(parsed) || parsed <= 0) return false;
  const newest = newestTimestampByPhone.get(phone);
  if (newest !== undefined && parsed < newest) return true;
  if (newest === undefined || parsed > newest) newestTimestampByPhone.set(phone, parsed);
  return false;
}

function clearForTests() {
  newestTimestampByPhone.clear();
}

module.exports = { isClearlyStale, clearForTests };
