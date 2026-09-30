// Local development endpoint to exercise the exact same conversationRouter
// pipeline the real WhatsApp webhook uses, without needing Meta/a phone.
// Outbound sends are captured (see whatsapp/testChannel.js) instead of
// actually hitting the WhatsApp Graph API.
const express = require('express');
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');
const { handleInboundMessage } = require('../router/conversationRouter');
const testChannel = require('../whatsapp/testChannel');
const sessionStore = require('../session/sessionStore');
const unknownStreak = require('../router/unknownStreak');
const feedback = require('../flows/feedback');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();

const router = express.Router();

function isTestChatEnabled() {
  return env.ENABLE_TEST_CHAT === true && Boolean(env.TEST_CHAT_SECRET);
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(String(expected));
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireTestChatAccess(req, res, next) {
  if (!isTestChatEnabled()) {
    return res.status(404).json({
      error: 'Test chat is disabled on this deployment.',
      code: 'TEST_CHAT_DISABLED',
    });
  }

  if (!secretsMatch(req.get('x-test-chat-secret'), env.TEST_CHAT_SECRET)) {
    return res.status(401).json({
      error: 'A valid developer secret is required.',
      code: 'TEST_CHAT_UNAUTHORIZED',
    });
  }

  return next();
}

router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: isTestChatEnabled(), requiresSecret: true });
});

router.post('/reset', requireTestChatAccess, async (req, res) => {
  const phone = String((req.body && req.body.phone) || '').trim();
  if (!phone) return res.status(400).json({ error: 'Request body must include "phone".' });

  try {
    await sessionStore.resetSession(phone);
    unknownStreak.reset(phone);
    return res.json({ success: true, message: 'Test session reset.' });
  } catch (err) {
    logger.error('CHAT_TEST', 'resetSession failed:', err.message);
    return res.status(500).json({ error: 'Unable to reset the test session.' });
  }
});

function responsePayload(result, messages) {
  return {
    reply: messages.map((m) => m.body).join('\n---\n') || null,
    options: messages.flatMap((m) => m.options || []).map((o) => ({ id: o.id, title: o.title })),
    intent: result.intent || null,
    confidence: result.confidence ?? null,
    aiMatch: result.aiMatch || null,
    service: result.service || null,
    matchSource: result.matchSource || null,
    serviceConfidence: result.serviceConfidence ?? null,
    changedField: result.changedField || null,
    previousValue: result.previousValue ?? null,
    newValue: result.newValue ?? null,
    flow: result.flow || null,
    step: result.step || null,
    rating: result.rating ?? null,
    followUpRequired: !!result.followUpRequired,
    complaintLinked: !!result.complaintLinked,
    humanTakeover: !!result.humanTakeover,
    handoff: !!result.handoff,
    priority: result.priority || null,
    handoffReason: result.handoffReason || null,
    debugReason: result.debugReason || null,
  };
}

router.post('/start-feedback', requireTestChatAccess, async (req, res) => {
  const phone = String((req.body && req.body.phone) || '').trim();
  const bookingId = String((req.body && req.body.bookingId) || '').trim();
  if (!phone || !bookingId) return res.status(400).json({ error: 'Request body must include "phone" and "bookingId".' });

  try {
    const session = await sessionStore.getOrCreateSession(phone);
    const customer = await crm.findCustomerByPhone(phone);
    const { result, messages } = await testChannel.withCapture(async () => {
      const outcome = await feedback.startFeedbackForBooking({
        session,
        customer,
        bookingId,
        allowUnverifiedCompletion: true,
      });
      const freshSession = await sessionStore.getOrCreateSession(phone);
      return {
        ...outcome,
        intent: 'FEEDBACK',
        flow: freshSession.currentFlow,
        step: freshSession.currentStep,
        rating: freshSession.context && freshSession.context.rating,
        followUpRequired: freshSession.context && freshSession.context.followUpRequired,
        complaintLinked: freshSession.context && freshSession.context.complaintLinked,
      };
    });
    return res.json(responsePayload(result, messages));
  } catch (err) {
    logger.error('CHAT_TEST', 'startFeedbackForBooking failed:', err.message);
    return res.status(500).json({ error: 'Unable to start the feedback test flow.', detail: err.message });
  }
});

router.post('/', requireTestChatAccess, async (req, res) => {
  const { phone, message, buttonId, voiceTranscript, voiceLanguage } = req.body || {};
  if (!phone || (!message && !buttonId && !voiceTranscript)) {
    return res.status(400).json({ error: 'Request body must include "phone" and a "message", "buttonId", or simulated "voiceTranscript".' });
  }

  try {
    let inbound;
    if (buttonId) {
      inbound = { from: phone, type: 'interactive', buttonId };
    } else if (voiceTranscript) {
      const transcript = String(voiceTranscript).trim();
      inbound = {
        from: phone,
        type: 'text',
        text: transcript,
        source: 'voice',
        voice: {
          source: 'voice',
          transcript,
          detectedLanguage: voiceLanguage || null,
          confidence: 1,
          provider: 'simulated',
          mediaId: 'test-voice-media',
          mimeType: 'audio/ogg',
        },
      };
    } else {
      inbound = { from: phone, type: 'text', text: String(message) };
    }

    const { result, messages } = await testChannel.withCapture(() => handleInboundMessage(inbound));

    res.json(responsePayload(result, messages));
  } catch (err) {
    // err.response is present for failed axios calls (e.g. Supabase/PostgREST) —
    // surface its real body here so this dev-only endpoint doesn't require
    // digging through Render logs to see *why* something failed.
    const detail = err.response
      ? `Supabase ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    logger.error('CHAT_TEST', 'handleInboundMessage failed:', detail, err.stack);
    res.status(500).json({ error: 'Internal error while processing test message', detail });
  }
});

module.exports = router;
module.exports.isTestChatEnabled = isTestChatEnabled;
module.exports.requireTestChatAccess = requireTestChatAccess;
