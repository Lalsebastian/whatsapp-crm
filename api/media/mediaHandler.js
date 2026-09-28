// WhatsApp media IDs resolve to a short-lived, auth-required URL — this does
// the two-step download (resolve URL, then fetch bytes) used by the voice-note
// pipeline. Images/videos for complaints don't need this: we only ever store
// their wa_media_id reference (see crm/supabaseCrmAdapter.js's media_attachments
// insert), not the bytes, unless durable storage is added later.
const axios = require('axios');
const env = require('../config/env');

async function downloadWhatsAppMedia(mediaId) {
  const metaRes = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const mediaUrl = metaRes.data && metaRes.data.url;
  if (!mediaUrl) throw new Error(`No download URL returned for media ${mediaId}`);

  const fileRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(fileRes.data), mimeType: metaRes.data.mime_type };
}

module.exports = { downloadWhatsAppMedia };
