// Isolates the concrete Gemini API call so api/ai/intentService.js never
// imports a vendor SDK directly — swapping to "or other AI api" later means
// adding a sibling provider file and changing one require() in intentService.js.
const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');

// gemini-2.0-flash was retired by Google; gemini-3.8-flash is its
// replacement (per the deprecation error's own guidance).
const GEMINI_MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Google's "high demand" 503s are common and usually clear within a second —
// worth one quick retry rather than immediately giving up and showing the
// customer a generic "didn't understand" fallback.
function isRetryable(err) {
  if (err.code === 'ECONNABORTED') return true; // our own timeout
  return err.response && err.response.status === 503;
}

async function requestOnce(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
    // Without a timeout, a slow/hanging Gemini response hangs the whole
    // customer-facing request indefinitely instead of degrading to UNKNOWN
    // (which detectIntent already handles safely) within a reasonable time.
    { headers: { 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
  );

  const candidate = res.data && res.data.candidates && res.data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error('Gemini returned no usable content');
  return text;
}

async function callGemini(prompt) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  try {
    return await requestOnce(prompt);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    logger.warn('AI', 'Gemini request failed, retrying once:', err.message);
    await sleep(RETRY_DELAY_MS);
    return requestOnce(prompt);
  }
}

module.exports = { callGemini };