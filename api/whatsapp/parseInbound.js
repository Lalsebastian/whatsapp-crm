// Normalizes a raw WhatsApp Cloud API webhook POST body into a flat shape the
// rest of the app works with, so nothing downstream touches req.body directly.
//
// One webhook delivery can batch several entries, several changes per entry
// and several messages per change. normalizeInboundMessages returns every
// customer message in the delivery; status-only callbacks (sent/delivered/
// read) yield an empty array.

function normalizeMessage(msg) {
  if (!msg || !msg.from) return null;
  const base = {
    from: msg.from,
    waMessageId: msg.id,
    timestamp: msg.timestamp,
    type: msg.type,
  };

  if (msg.type === 'text') {
    return { ...base, text: (msg.text && msg.text.body || '').trim() };
  }

  if (msg.type === 'interactive') {
    const buttonId = msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id;
    const listId = msg.interactive && msg.interactive.list_reply && msg.interactive.list_reply.id;
    return { ...base, buttonId: buttonId || listId || null, source: buttonId ? 'button' : 'list' };
  }

  // Quick-reply buttons on an approved *template* message arrive as type
  // "button" (not "interactive"). The payload is the id we set when sending
  // the template, so it routes exactly like an interactive button tap.
  if (msg.type === 'button') {
    return {
      ...base,
      type: 'interactive',
      buttonId: (msg.button && msg.button.payload) || null,
      text: msg.button && msg.button.text,
      source: 'template_button',
    };
  }

  if (['image', 'video', 'audio', 'document'].includes(msg.type)) {
    const media = msg[msg.type];
    return {
      ...base,
      mediaId: media && media.id,
      mediaMimeType: media && media.mime_type,
      caption: media && media.caption,
    };
  }

  if (msg.type === 'location' && msg.location) {
    return {
      ...base,
      location: {
        latitude: Number(msg.location.latitude),
        longitude: Number(msg.location.longitude),
        label: msg.location.name || null,
        address: msg.location.address || null,
        source: 'whatsapp_location',
      },
    };
  }

  return base; // unsupported type (contacts, stickers, etc.) — carried through, router decides
}

/**
 * @param {object} rawBody webhook body
 * @param {{ phoneNumberId?: string }} [options] when set, changes addressed to
 *   a different business phone number (same Meta app, other number) are
 *   skipped so this bot never replies on another number's conversations.
 * @returns {{ messages: object[], ignored: Array<{reason: string, phoneNumberId?: string}> }}
 */
function parseWebhookBody(rawBody, { phoneNumberId } = {}) {
  const messages = [];
  const ignored = [];
  const entries = rawBody && Array.isArray(rawBody.entry) ? rawBody.entry : [];
  for (const entry of entries) {
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change && change.value;
      if (!value) continue;
      if (change.field && change.field !== 'messages') {
        ignored.push({ reason: 'unsupported_field' });
        continue;
      }
      const target = value.metadata && value.metadata.phone_number_id;
      if (phoneNumberId && target && String(target) !== String(phoneNumberId)) {
        ignored.push({ reason: 'other_phone_number', phoneNumberId: String(target) });
        continue;
      }
      // The sender's WhatsApp profile name arrives beside the messages.
      const profileNames = new Map((Array.isArray(value.contacts) ? value.contacts : [])
        .filter((contact) => contact && contact.wa_id && contact.profile && contact.profile.name)
        .map((contact) => [String(contact.wa_id), String(contact.profile.name).trim().slice(0, 100)]));
      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        const normalized = normalizeMessage(msg);
        if (!normalized) continue;
        const profileName = profileNames.get(String(normalized.from));
        messages.push(profileName ? { ...normalized, profileName } : normalized);
      }
    }
  }
  // Meta normally delivers in order, but a batch is not guaranteed to be
  // sorted. Stable-sort by the sender's timestamp so a customer's messages
  // are queued for processing in the order they were sent.
  const indexed = messages.map((message, index) => ({ message, index }));
  indexed.sort((left, right) => {
    const a = Number(left.message.timestamp);
    const b = Number(right.message.timestamp);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
    return left.index - right.index;
  });
  return { messages: indexed.map((item) => item.message), ignored };
}

function normalizeInboundMessages(rawBody, options) {
  return parseWebhookBody(rawBody, options).messages;
}

// Backward-compatible single-message form (first message or null).
function normalizeInboundMessage(rawBody) {
  const [first] = normalizeInboundMessages(rawBody);
  return first || null;
}

module.exports = { normalizeInboundMessage, normalizeInboundMessages, parseWebhookBody, normalizeMessage };
