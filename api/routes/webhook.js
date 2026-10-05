const express = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const { isValidSignature } = require('../utils/signature');
const { parseWebhookBody } = require('../whatsapp/parseInbound');
const conversationRouter = require('../router/conversationRouter');
const whatsapp = require('../whatsapp/client');

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const tokenMatches = Boolean(env.WHATSAPP_VERIFY_TOKEN) && token === env.WHATSAPP_VERIFY_TOKEN;
  logger.log('WEBHOOK', `Verification request — mode=${mode} token_match=${tokenMatches}`);
  if (mode === 'subscribe' && tokenMatches) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.status(403).end();
});

// Meta signs every POST with HMAC-SHA256 of the raw body using the App
// Secret. Anything unsigned or mis-signed is rejected before parsing so a
// forged request can never create bookings, complaints or AI usage.
function verifyMetaSignature(req, res, next) {
  if (!env.WHATSAPP_APP_SECRET) {
    if (env.NODE_ENV === 'production') {
      // Fail closed. Meta retries non-2xx deliveries, so messages received
      // while the secret is missing are redelivered once it is configured.
      logger.error('WEBHOOK', 'WHATSAPP_APP_SECRET is not configured — rejecting webhook delivery');
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    logger.warn('WEBHOOK', 'WHATSAPP_APP_SECRET not set — skipping signature check (non-production only)');
    return next();
  }
  const valid = isValidSignature({
    secret: env.WHATSAPP_APP_SECRET,
    rawBody: req.rawBody,
    header: req.get('x-hub-signature-256'),
  });
  if (!valid) {
    logger.warn('WEBHOOK', 'Rejected webhook with missing or invalid X-Hub-Signature-256');
    logger.audit('WEBHOOK_SIGNATURE_REJECTED', { result: 'rejected' });
    return res.status(401).json({ error: 'Invalid signature' });
  }
  return next();
}

async function processMessage(inbound) {
  try {
    await conversationRouter.handleInboundMessage(inbound);
  } catch (err) {
    logger.error('WEBHOOK', 'Unhandled error processing inbound message:', err.message, err.stack);
    if (inbound && inbound.from) {
      try {
        await whatsapp.sendText(
          inbound.from,
          'I\'m sorry, I can\'t complete that request right now. Please try again in a moment, or type "support" to speak with our team.'
        );
      } catch (sendError) {
        logger.error('WEBHOOK', 'Failed to send safe error response:', sendError.message);
      }
    }
  }
}

// Dispatches every message in the delivery. Calls are started in order
// without awaiting each one: the router's per-customer lock queues them in
// call order, so one customer's messages stay sequential while different
// customers are processed concurrently.
function dispatchMessages(messages) {
  return Promise.all(messages.map((inbound) => processMessage(inbound)));
}

router.post('/', verifyMetaSignature, (req, res) => {
  let parsed;
  try {
    parsed = parseWebhookBody(req.body, { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID });
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to parse webhook body:', err.message);
    parsed = { messages: [], ignored: [] };
  }
  // Meta requires a fast 200 ack; the actual work happens after responding.
  res.status(200).end();
  for (const skipped of parsed.ignored) {
    logger.warn('WEBHOOK', 'Ignored webhook change', skipped);
  }
  if (parsed.messages.length === 0) return undefined; // status-only callback
  if (parsed.messages.length > 1) {
    logger.log('WEBHOOK', `Delivery contains ${parsed.messages.length} messages`);
  }
  void dispatchMessages(parsed.messages);
  return undefined;
});

module.exports = router;
module.exports.verifyMetaSignature = verifyMetaSignature;
module.exports.dispatchMessages = dispatchMessages;
