// Stable media-layer entry point. Provider-specific work and validation stay
// isolated in transcriptionService.js so the conversation router remains
// independent of Gemini or any future speech-to-text provider.
module.exports = require('./transcriptionService');
