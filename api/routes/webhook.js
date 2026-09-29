const express = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const { normalizeInboundMessage } = require('../whatsapp/parseInbound');
const { handleInboundMessage } = require('../router/conversationRouter');
const whatsapp = require('../whatsapp/client');

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  logger.log('WEBHOOK', `Verification request — mode=${mode} token_match=${token === env.WHATSAPP_VERIFY_TOKEN}`);
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).end();
});

router.post('/', (req, res) => {
  // Meta requires a fast 200 ack; the actual work happens after responding.
  res.status(200).end();
  (async () => {
    let inbound;
    try {
      inbound = normalizeInboundMessage(req.body);
      if (!inbound) return; // status update, no message — ignore
      await handleInboundMessage(inbound);
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
  })();
});

module.exports = router;
