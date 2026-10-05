// Business-initiated customer messages (booking lifecycle updates, feedback
// requests). Chooses between a free-form message and an approved template
// based on WhatsApp's 24-hour customer-service window.
const whatsapp = require('../whatsapp/client');
const logger = require('../utils/logger');
const { isWithinServiceWindow } = require('../whatsapp/serviceWindow');

function skipped(phone, kind, reason) {
  logger.audit('CUSTOMER_NOTIFICATION_SKIPPED', { phone, notification: kind, reason, result: 'skipped' });
  return { delivered: false, channel: null, reason };
}

/**
 * @param {object} args
 * @param {string} args.phone
 * @param {string} args.kind      analytics label, e.g. "booking_assigned"
 * @param {() => Promise<any>} args.sendSession  free-form send (text/buttons)
 * @param {object|null} args.template  { name, bodyParams, quickReplyPayloads, summary } or null
 */
async function deliver({ phone, kind, sendSession, template }) {
  const inWindow = await isWithinServiceWindow(phone);
  if (inWindow === false) {
    if (!template || !template.name) return skipped(phone, kind, 'outside_service_window_no_template');
    await whatsapp.sendTemplate(phone, template);
    logger.audit('CUSTOMER_NOTIFICATION_SENT', { phone, notification: kind, channel: 'template', result: 'sent' });
    return { delivered: true, channel: 'template' };
  }
  // In the window, or unknown (database unavailable): a session message is
  // the best attempt; WhatsApp reports a window failure asynchronously.
  await sendSession();
  logger.audit('CUSTOMER_NOTIFICATION_SENT', { phone, notification: kind, channel: 'session', result: 'sent' });
  return { delivered: true, channel: 'session' };
}

module.exports = { deliver };
