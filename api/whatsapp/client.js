// Outbound WhatsApp Cloud API calls. Fixes the two live bugs found in the old
// api/webhook.js: it posted to graph.instagram.com (typo) instead of
// graph.facebook.com, and hardcoded PHONE_NUMBER_ID as a literal instead of
// reading it from env.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const db = require('../db/supabaseClient');
const testChannel = require('./testChannel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

function messagesUrl() {
  return `${GRAPH_BASE}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function authHeaders() {
  return { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
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

async function sendText(to, body) {
  if (testChannel.capture({ type: 'text', to, body })) return null; // /api/chat/test — never hits Meta

  logger.log('SEND TEXT', `to=${to}`, body.slice(0, 80));
  const res = await axios.post(
    messagesUrl(),
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    { headers: authHeaders() }
  );
  await logOutbound(to, 'text', body);
  return res;
}

// buttons: [{ id, title }] — WhatsApp allows a max of 3 reply buttons.
async function sendButtons(to, bodyText, buttons) {
  if (testChannel.capture({ type: 'buttons', to, body: bodyText, options: buttons })) return null;

  logger.log('SEND BUTTONS', `to=${to}`, buttons.map((b) => b.id).join(', '));
  const res = await axios.post(
    messagesUrl(),
    {
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
    },
    { headers: authHeaders() }
  );
  await logOutbound(to, 'button', bodyText);
  return res;
}

// sections: [{ title, rows: [{ id, title, description }] }]
// Ported from the pre-refactor root index.js, which was the only place that
// implemented list messages correctly, including WhatsApp's row/character
// limits (max 10 rows total, 24-char row title, 72-char description).
async function sendListMessage(to, bodyText, buttonText, sections) {
  const options = sections.flatMap((s) => s.rows);
  if (testChannel.capture({ type: 'list', to, body: bodyText, options })) return null;

  logger.log('SEND LIST', `to=${to}`, `sections=${sections.length}`);
  const res = await axios.post(
    messagesUrl(),
    {
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
    },
    { headers: authHeaders() }
  );
  await logOutbound(to, 'list', bodyText);
  return res;
}

module.exports = { sendText, sendButtons, sendListMessage };
