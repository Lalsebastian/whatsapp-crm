const reliability = require('../config/reliability');

const MAX_ENTRIES = 1000;
const conversations = new Map();

function ttlMs() {
  return reliability.SESSION_TTL_MINUTES * 60 * 1000;
}

function noteActivity(session, now = Date.now()) {
  const phone = session && session.phone;
  if (!phone) return null;
  const previous = conversations.get(phone);
  const activeSession = !!(session.currentFlow && session.currentStep);
  let eventType = null;
  if (!previous || now - previous.lastSeen > ttlMs()) {
    eventType = activeSession ? 'CONVERSATION_RESUMED' : 'CONVERSATION_STARTED';
  }
  conversations.delete(phone);
  conversations.set(phone, { lastSeen: now });
  while (conversations.size > MAX_ENTRIES) conversations.delete(conversations.keys().next().value);
  return eventType;
}

function expire(phone) {
  if (phone) conversations.delete(phone);
}

function clearForTests() {
  conversations.clear();
}

module.exports = { noteActivity, expire, clearForTests };
