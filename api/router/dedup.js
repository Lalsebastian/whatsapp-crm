const db = require('../db/supabaseClient');
const logger = require('../utils/logger');

const MEMORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const claimedMessages = new Map();

function prune(now = Date.now()) {
  for (const [id, timestamp] of claimedMessages) {
    if (now - timestamp > MEMORY_WINDOW_MS) claimedMessages.delete(id);
  }
}

function isUniqueViolation(error) {
  const status = error && error.response && error.response.status;
  const code = error && error.response && error.response.data && error.response.data.code;
  return status === 409 || code === '23505';
}

async function claimMessage({ messageId, phone, messageTimestamp, correlationId }) {
  if (!messageId) return { duplicate: false, persistent: false };
  prune();
  if (claimedMessages.has(messageId)) return { duplicate: true, persistent: false };

  // Claim in memory before awaiting the database so concurrent deliveries in
  // this process cannot both pass while the persistent insert is in flight.
  claimedMessages.set(messageId, Date.now());
  try {
    await db.insert('processed_webhook_events', {
      message_id: messageId,
      phone: phone || null,
      message_timestamp: messageTimestamp ? Number(messageTimestamp) : null,
      correlation_id: correlationId || messageId,
    }, { returnRepresentation: false });
    return { duplicate: false, persistent: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true, persistent: true };
    logger.warn(
      'DEDUP',
      'Persistent message claim unavailable; using process-local protection:',
      error.message
    );
    return { duplicate: false, persistent: false };
  }
}

function clearForTests() {
  claimedMessages.clear();
}

module.exports = { claimMessage, clearForTests };
