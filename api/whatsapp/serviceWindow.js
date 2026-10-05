// WhatsApp's customer-service window: free-form (session) messages are only
// delivered within 24 hours of the customer's last inbound message. Outside
// it, the Cloud API still answers 200 but the message later fails with
// error 131047, so the decision has to be made before sending.
//
// The last inbound time comes from the message log the router writes.
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const testChannel = require('./testChannel');

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Margin so a message composed just before the window closes is not sent
// moments after it has.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<boolean|null>} true/false, or null when it cannot be determined
 */
async function isWithinServiceWindow(phone, now = Date.now()) {
  if (testChannel.isCapturing()) return true; // developer console: always "in session"
  try {
    const rows = await db.get(
      'messages',
      `phone=eq.${encodeURIComponent(phone)}&direction=eq.inbound&select=created_at&order=created_at.desc&limit=1`
    );
    const last = rows && rows[0] && Date.parse(rows[0].created_at);
    if (!Number.isFinite(last)) return false; // never messaged us: business-initiated only
    return now - last < WINDOW_MS - SAFETY_MARGIN_MS;
  } catch (error) {
    logger.warn('SERVICE_WINDOW', 'Could not determine the customer-service window:', error.message);
    return null;
  }
}

module.exports = { isWithinServiceWindow, WINDOW_MS };
