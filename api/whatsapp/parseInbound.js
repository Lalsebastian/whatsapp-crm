// Normalizes a raw WhatsApp Cloud API webhook POST body into a flat shape the
// rest of the app works with, so nothing downstream touches req.body directly.
function normalizeInboundMessage(rawBody) {
  const value = rawBody && rawBody.entry && rawBody.entry[0] && rawBody.entry[0].changes &&
    rawBody.entry[0].changes[0] && rawBody.entry[0].changes[0].value;

  if (!value || !value.messages || !value.messages[0]) {
    return null; // status update / no message — caller should ignore
  }

  const msg = value.messages[0];
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

  return base; // unsupported type (location, contacts, etc.) — carried through, router decides
}

module.exports = { normalizeInboundMessage };
