// PLACEHOLDER — deferred by design (no speech-to-text vendor chosen yet).
// The router already calls this at the right point in the pipeline
// (download audio -> transcribeAudio -> feed transcript back into the normal
// text path), so wiring a real provider (Google Cloud Speech, Whisper API,
// etc.) later is a one-function change, nothing else in the app needs to move.
async function transcribeAudio(_audioBuffer, _mimeType) {
  throw new Error('transcribeAudio not implemented — no speech-to-text provider configured yet');
}

module.exports = { transcribeAudio };
