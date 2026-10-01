// Outbound WhatsApp Cloud API calls. Fixes the two live bugs found in the old
// api/webhook.js: it posted to graph.instagram.com (typo) instead of
// graph.facebook.com, and hardcoded PHONE_NUMBER_ID as a literal instead of
// reading it from env.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const db = require('../db/supabaseClient');
const testChannel = require('./testChannel');
const reliability = require('../config/reliability');
const { retry, isTransientError } = require('../reliability/asyncPolicy');
const { CircuitBreaker } = require('../reliability/circuitBreaker');
const messageBudget = require('../analytics/messageBudget');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const breaker = new CircuitBreaker('WhatsApp', {
  failureThreshold: reliability.PROVIDER_FAILURE_THRESHOLD,
  cooldownMs: reliability.PROVIDER_COOLDOWN_MS,
});

function messagesUrl() {
  return `${GRAPH_BASE}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function authHeaders() {
  return { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
}

// Same reasoning as db/supabaseClient.js's run(): axios's own error.message
// ("Request failed with status code 401") doesn't say WHY — an expired
// token, a wrong phone number ID, and a malformed payload all look
// identical without this. Meta's actual error body says which one it is.
async function post(payload) {
  const startedAt = Date.now();
  try {
    breaker.assertAvailable();
    const response = await retry(
      () => axios.post(messagesUrl(), payload, {
        headers: authHeaders(),
        timeout: reliability.WHATSAPP_REQUEST_TIMEOUT_MS,
      }),
      {
        retries: reliability.WHATSAPP_MAX_RETRIES,
        baseDelayMs: reliability.RETRY_BASE_DELAY_MS,
        shouldRetry: isTransientError,
        onRetry: ({ error, attempt, delayMs }) => logger.warn('WHATSAPP_RETRY', {
          attempt,
          delayMs,
          reason: error.code || (error.response && error.response.status) || error.message,
        }),
      }
    );
    const messageId = response && response.data && response.data.messages && response.data.messages[0] && response.data.messages[0].id;
    if (!messageId) {
      const malformed = new Error('WhatsApp API returned a malformed success response');
      malformed.code = 'WHATSAPP_MALFORMED_RESPONSE';
      throw malformed;
    }
    breaker.recordSuccess();
    logger.audit('WHATSAPP_SEND_COMPLETED', {
      phone: payload.to,
      source: payload.type,
      latencyMs: Date.now() - startedAt,
      result: 'success',
    });
    return response;
  } catch (err) {
    breaker.recordFailure();
    logger.error(
      'WHATSAPP',
      'Send failed:',
      `status=${err.response ? err.response.status : 'no response'}`,
      'body=', err.response ? JSON.stringify(err.response.data) : err.message
    );
    logger.audit('WHATSAPP_SEND_ERROR', {
      phone: payload.to,
      source: payload.type,
      latencyMs: Date.now() - startedAt,
      errorCategory: err.code || 'WHATSAPP_PROVIDER_ERROR',
      statusCode: err.response && err.response.status,
      result: 'failed',
    });
    throw err;
  }
}

// Every outbound send funnels through here, so this is also the single place
// that logs outbound messages to `messages` (inbound is logged by the router).
async function logOutbound(to, type, content) {
  try {
    await db.insert('messages', { phone: to, type, content, direction: 'outbound' }, { returnRepresentation: false });
  } catch (err) {
    logger.error('WHATSAPP', 'Failed to log outbound message (non-fatal):', err.message);
  }
}

function recordBotMessage(to, messageType) {
  logger.audit('BOT_MESSAGE_SENT', { phone: to, messageType, result: 'sent' });
  messageBudget.botMessage(to);
}

async function sendText(to, body) {
  if (testChannel.capture({ type: 'text', to, body })) {
    recordBotMessage(to, 'text');
    return null; // /api/chat/test — never hits Meta
  }

  logger.log('SEND TEXT', `to=${to}`, body.slice(0, 80));
  const res = await post({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
  await logOutbound(to, 'text', body);
  recordBotMessage(to, 'text');
  return res;
}

// buttons: [{ id, title }] — WhatsApp allows a max of 3 reply buttons.
async function sendButtons(to, bodyText, buttons) {
  if (testChannel.capture({ type: 'buttons', to, body: bodyText, options: buttons })) {
    recordBotMessage(to, 'buttons');
    return null;
  }

  logger.log('SEND BUTTONS', `to=${to}`, buttons.map((b) => b.id).join(', '));
  const res = await post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })),
      },
    },
  });
  await logOutbound(to, 'button', bodyText);
  recordBotMessage(to, 'buttons');
  return res;
}

// sections: [{ title, rows: [{ id, title, description }] }]
// Ported from the pre-refactor root index.js, which was the only place that
// implemented list messages correctly, including WhatsApp's row/character
// limits (max 10 rows total, 24-char row title, 72-char description).
async function sendListMessage(to, bodyText, buttonText, sections) {
  const options = sections.flatMap((s) => s.rows);
  if (testChannel.capture({ type: 'list', to, body: bodyText, options })) {
    recordBotMessage(to, 'list');
    return null;
  }

  logger.log('SEND LIST', `to=${to}`, `sections=${sections.length}`);
  const res = await post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: sections.map((s) => ({
          title: s.title.slice(0, 24),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            description: (r.description || '').slice(0, 72),
          })),
        })),
      },
    },
  });
  await logOutbound(to, 'list', bodyText);
  recordBotMessage(to, 'list');
  return res;
}

module.exports = { sendText, sendButtons, sendListMessage, post };
