// Isolates the concrete Gemini API call so api/ai/intentService.js never
// imports a vendor SDK directly — swapping to "or other AI api" later means
// adding a sibling provider file and changing one require() in intentService.js.
const axios = require('axios');
const env = require('../../config/env');

const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(prompt) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const candidate = res.data && res.data.candidates && res.data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error('Gemini returned no usable content');
  return text;
}

module.exports = { callGemini };
