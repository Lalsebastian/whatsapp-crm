// Local development endpoint to exercise the exact same conversationRouter
// pipeline the real WhatsApp webhook uses, without needing Meta/a phone.
// Outbound sends are captured (see whatsapp/testChannel.js) instead of
// actually hitting the WhatsApp Graph API.
const express = require('express');
const logger = require('../utils/logger');
const { handleInboundMessage } = require('../router/conversationRouter');
const testChannel = require('../whatsapp/testChannel');

const router = express.Router();

router.post('/', async (req, res) => {
  const { phone, message, buttonId } = req.body || {};
  if (!phone || (!message && !buttonId)) {
    return res.status(400).json({ error: 'Request body must include "phone" and either "message" or "buttonId".' });
  }

  try {
    const inbound = buttonId
      ? { from: phone, type: 'interactive', buttonId }
      : { from: phone, type: 'text', text: String(message) };

    const { result, messages } = await testChannel.withCapture(() => handleInboundMessage(inbound));

    res.json({
      reply: messages.map((m) => m.body).join('\n---\n') || null,
      options: messages.flatMap((m) => m.options || []).map((o) => ({ id: o.id, title: o.title })),
      intent: result.intent || null,
      flow: result.flow || null,
      step: result.step || null,
      humanTakeover: !!result.humanTakeover,
    });
  } catch (err) {
    logger.error('CHAT_TEST', 'handleInboundMessage failed:', err.message, err.stack);
    res.status(500).json({ error: 'Internal error while processing test message', detail: err.message });
  }
});

module.exports = router;
