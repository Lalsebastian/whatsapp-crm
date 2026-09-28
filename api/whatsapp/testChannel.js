// Lets /api/chat/test exercise the exact same flow handlers/router as the real
// webhook, without whatsapp/client.js actually calling the Meta Graph API.
// Uses AsyncLocalStorage (Node built-in, no new dependency) to detect "we're
// inside a test request" from deep within flow handlers that have no idea
// they're being tested.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

async function withCapture(fn) {
  const messages = [];
  const result = await storage.run({ messages }, fn);
  return { result, messages };
}

// Returns true if running inside withCapture (caller should skip the real
// WhatsApp send + outbound DB log and just record the message instead).
function capture(entry) {
  const store = storage.getStore();
  if (!store) return false;
  store.messages.push(entry);
  return true;
}

function isCapturing() {
  return !!storage.getStore();
}

module.exports = { withCapture, capture, isCapturing };
