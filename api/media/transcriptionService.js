const voiceConfig = require('../config/voice');
const { callGeminiAudio } = require('../ai/providers/geminiProvider');
const messageBudget = require('../analytics/messageBudget');
const { getRequestContext } = require('../reliability/requestContext');

const MIME_ALIASES = Object.freeze({
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/m4a',
  'audio/mp4': 'audio/m4a',
});

const SUPPORTED_MIME_TYPES = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/mpeg',
  'audio/m4a',
  'audio/l16',
  'audio/opus',
  'audio/alaw',
  'audio/mulaw',
  'audio/webm',
]);

class VoiceTranscriptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VoiceTranscriptionError';
    this.code = code;
  }
}

function normalizeAudioMimeType(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[base] || base;
}

function parseJson(raw) {
  try {
    const cleaned = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (error) {
    return null;
  }
}

async function transcribeAudio({ buffer, mimeType, languageHint } = {}) {
  if (!voiceConfig.VOICE_TRANSCRIPTION_ENABLED) {
    throw new VoiceTranscriptionError('VOICE_DISABLED', 'Voice transcription is disabled');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new VoiceTranscriptionError('VOICE_EMPTY_AUDIO', 'Audio data is empty');
  }
  if (buffer.length > voiceConfig.VOICE_MAX_FILE_SIZE_BYTES) {
    throw new VoiceTranscriptionError('VOICE_FILE_TOO_LARGE', 'Audio exceeds the configured size limit');
  }

  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  if (!SUPPORTED_MIME_TYPES.has(normalizedMimeType)) {
    throw new VoiceTranscriptionError('VOICE_UNSUPPORTED_MIME', `Unsupported audio type: ${normalizedMimeType || 'unknown'}`);
  }

  const languageInstruction = languageHint
    ? `The customer's preferred language hint is ${languageHint}, but preserve mixed-language and code-switched speech exactly as spoken.`
    : 'Detect the spoken language, including mixed-language or code-switched speech.';
  const prompt = `Transcribe this customer voice note accurately. ${languageInstruction}
Return JSON only with this exact shape:
{"text":"verbatim transcript","detectedLanguage":"BCP-47 code or short language label","confidence":0.0}
Confidence must represent speech intelligibility and transcription certainty from 0 to 1. Do not translate, summarize, answer, or add commentary.`;

  messageBudget.aiCall(getRequestContext().phone);
  const raw = await callGeminiAudio({ buffer, mimeType: normalizedMimeType, prompt });
  const parsed = parseJson(raw);
  const text = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) {
    throw new VoiceTranscriptionError('VOICE_EMPTY_TRANSCRIPT', 'Transcription returned no usable speech');
  }

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : null;
  return {
    text,
    detectedLanguage: parsed.detectedLanguage || null,
    confidence,
    provider: 'gemini',
    mimeType: normalizedMimeType,
  };
}

module.exports = {
  transcribeAudio,
  normalizeAudioMimeType,
  SUPPORTED_MIME_TYPES,
  VoiceTranscriptionError,
};
