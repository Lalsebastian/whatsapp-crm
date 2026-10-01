// Isolates the concrete Gemini API call so api/ai/intentService.js never
// imports a vendor SDK directly — swapping to "or other AI api" later means
// adding a sibling provider file and changing one require() in intentService.js.
const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const reliability = require('../../config/reliability');
const voiceConfig = require('../../config/voice');
const { retry, isTransientError } = require('../../reliability/asyncPolicy');
const { CircuitBreaker } = require('../../reliability/circuitBreaker');

// gemini-2.0-flash was retired by Google; gemini-3.8-flash is its
// replacement (per the deprecation error's own guidance).
const GEMINI_MODEL = 'gemini-3.8-flash';
const breaker = new CircuitBreaker('Gemini', {
  failureThreshold: reliability.PROVIDER_FAILURE_THRESHOLD,
  cooldownMs: reliability.PROVIDER_COOLDOWN_MS,
});

function geminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
}

function responseText(response) {
  const candidate = response.data && response.data.candidates && response.data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error('Gemini returned no usable content');
  return text;
}

// Google's "high demand" 503s are common and usually clear within a second —
// worth one quick retry rather than immediately giving up and showing the
// customer a generic "didn't understand" fallback.
async function requestOnce(prompt) {
  const res = await axios.post(
    geminiUrl(),
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
    // Without a timeout, a slow/hanging Gemini response hangs the whole
    // customer-facing request indefinitely instead of degrading to UNKNOWN
    // (which detectIntent already handles safely) within a reasonable time.
    { headers: { 'Content-Type': 'application/json' }, timeout: reliability.AI_REQUEST_TIMEOUT_MS }
  );

  return responseText(res);
}

async function requestAudioOnce({ buffer, mimeType, prompt }) {
  const res = await axios.post(
    geminiUrl(),
    {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: voiceConfig.VOICE_TRANSCRIPTION_TIMEOUT_MS,
      maxBodyLength: voiceConfig.VOICE_MAX_FILE_SIZE_BYTES * 2,
    }
  );
  return responseText(res);
}

async function callGemini(prompt) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  breaker.assertAvailable();
  try {
    const result = await retry(() => requestOnce(prompt), {
      retries: reliability.MAX_READ_RETRIES,
      baseDelayMs: reliability.RETRY_BASE_DELAY_MS,
      shouldRetry: isTransientError,
      onRetry: ({ error, attempt, delayMs }) => logger.warn('AI_RETRY', {
        attempt,
        delayMs,
        reason: error.code || (error.response && error.response.status) || error.message,
      }),
    });
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

async function callGeminiAudio(input) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  breaker.assertAvailable();
  try {
    const result = await retry(() => requestAudioOnce(input), {
      retries: reliability.MAX_READ_RETRIES,
      baseDelayMs: reliability.RETRY_BASE_DELAY_MS,
      shouldRetry: isTransientError,
      onRetry: ({ error, attempt, delayMs }) => logger.warn('VOICE_TRANSCRIPTION_RETRY', {
        attempt,
        delayMs,
        reason: error.code || (error.response && error.response.status) || error.message,
      }),
    });
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

module.exports = { callGemini, callGeminiAudio, GEMINI_MODEL };
