function positiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function enabled(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

const maxFileSizeMb = positiveNumber('VOICE_MAX_FILE_SIZE_MB', 10);

module.exports = Object.freeze({
  VOICE_TRANSCRIPTION_ENABLED: enabled('VOICE_TRANSCRIPTION_ENABLED', true),
  VOICE_MAX_FILE_SIZE_MB: maxFileSizeMb,
  VOICE_MAX_FILE_SIZE_BYTES: Math.floor(maxFileSizeMb * 1024 * 1024),
  VOICE_TRANSCRIPTION_TIMEOUT_MS: positiveNumber('VOICE_TRANSCRIPTION_TIMEOUT_MS', 20000),
  VOICE_MIN_CONFIDENCE: Math.min(1, positiveNumber('VOICE_MIN_CONFIDENCE', 0.55)),
});
