// Tracks consecutive UNKNOWN-intent messages per phone, in-memory (same
// known limitation as dedup.js — resets on restart, single-instance only).
// Feeds escalationService's "intent undeterminable after reasonable attempts"
// trigger without needing a schema change for something this ephemeral.
const streaks = new Map();

function increment(phone) {
  const next = (streaks.get(phone) || 0) + 1;
  streaks.set(phone, next);
  return next;
}

function reset(phone) {
  streaks.delete(phone);
}

module.exports = { increment, reset };
