// WhatsApp media IDs resolve to a short-lived, auth-required URL — this does
// the two-step download (resolve URL, then fetch bytes) used by the voice-note
// pipeline. Images/videos for complaints don't need this: we only ever store
// their wa_media_id reference (see crm/supabaseCrmAdapter.js's media_attachments
// insert), not the bytes, unless durable storage is added later.
const axios = require('axios');
const env = require('../config/env');
const reliability = require('../config/reliability');
const voiceConfig = require('../config/voice');
const logger = require('../utils/logger');
const { retry, isTransientError } = require('../reliability/asyncPolicy');

class MediaDownloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaDownloadError';
    this.code = code;
  }
}

function validateDownloadUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('non-HTTPS media URL');
    return url.toString();
  } catch (error) {
    throw new MediaDownloadError('MEDIA_INVALID_URL', 'Meta returned an invalid media download URL');
  }
}

async function getWithRetry(label, url, config) {
  return retry(() => axios.get(url, config), {
    retries: reliability.MAX_READ_RETRIES,
    baseDelayMs: reliability.RETRY_BASE_DELAY_MS,
    shouldRetry: isTransientError,
    onRetry: ({ error, attempt, delayMs }) => logger.warn('MEDIA_DOWNLOAD_RETRY', {
      stage: label,
      attempt,
      delayMs,
      reason: error.code || (error.response && error.response.status) || error.message,
    }),
  });
}

const KINDS = {
  audio: { prefix: 'audio/', label: 'Voice note', notAllowed: 'MEDIA_NOT_AUDIO' },
  image: { prefix: 'image/', label: 'Image', notAllowed: 'MEDIA_NOT_IMAGE' },
};

function matchesKind(contentType, kind) {
  return String(contentType || '').toLowerCase().startsWith(KINDS[kind].prefix);
}

/**
 * Downloads WhatsApp media of the expected kind ("audio" for voice notes,
 * "image" for complaint photos). The declared type and size are checked
 * before any bytes are fetched.
 */
async function downloadWhatsAppMedia(mediaId, { maxBytes = voiceConfig.VOICE_MAX_FILE_SIZE_BYTES, kind = 'audio' } = {}) {
  const expected = KINDS[kind] || KINDS.audio;
  if (!mediaId || typeof mediaId !== 'string') {
    throw new MediaDownloadError('MEDIA_ID_REQUIRED', 'A WhatsApp media ID is required');
  }
  const metaRes = await getWithRetry('metadata', `https://graph.facebook.com/v19.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    timeout: reliability.WHATSAPP_REQUEST_TIMEOUT_MS,
  });
  const mediaUrl = metaRes.data && metaRes.data.url;
  if (!mediaUrl) throw new MediaDownloadError('MEDIA_URL_MISSING', 'Meta returned no media download URL');
  const declaredSize = Number(metaRes.data && metaRes.data.file_size);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new MediaDownloadError('MEDIA_TOO_LARGE', `${expected.label} exceeds the configured size limit`);
  }
  const mimeType = metaRes.data && metaRes.data.mime_type;
  if (!mimeType || !matchesKind(mimeType, kind)) {
    throw new MediaDownloadError(expected.notAllowed, `WhatsApp media is not a supported ${kind} file`);
  }

  const fileRes = await getWithRetry('content', validateDownloadUrl(mediaUrl), {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
    timeout: reliability.WHATSAPP_REQUEST_TIMEOUT_MS,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
  });
  const buffer = Buffer.from(fileRes.data || []);
  if (buffer.length === 0) throw new MediaDownloadError('MEDIA_EMPTY', 'Downloaded media was empty');
  if (buffer.length > maxBytes) throw new MediaDownloadError('MEDIA_TOO_LARGE', `${expected.label} exceeds the configured size limit`);

  const responseType = fileRes.headers && fileRes.headers['content-type'];
  if (responseType && !matchesKind(responseType, kind) && !String(responseType).toLowerCase().startsWith('application/octet-stream')) {
    throw new MediaDownloadError('MEDIA_CONTENT_TYPE_MISMATCH', `Downloaded media content type was not ${kind}`);
  }
  return { buffer, mimeType, fileSize: buffer.length };
}

module.exports = { downloadWhatsAppMedia, MediaDownloadError, validateDownloadUrl };
