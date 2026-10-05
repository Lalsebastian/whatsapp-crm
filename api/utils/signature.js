// HMAC-SHA256 request signing helpers shared by every signed inbound webhook
// (Meta's X-Hub-Signature-256 and the client CRM's lifecycle events).
const crypto = require('node:crypto');

function computeSignature(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Accepts "sha256=<hex>" (Meta's format) or a bare hex digest.
function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.trim();
  const value = trimmed.toLowerCase().startsWith('sha256=') ? trimmed.slice(7) : trimmed;
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function isValidSignature({ secret, rawBody, header }) {
  if (!secret || !rawBody || rawBody.length === 0) return false;
  const provided = parseSignatureHeader(header);
  if (!provided) return false;
  const expected = computeSignature(secret, rawBody);
  return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { computeSignature, parseSignatureHeader, isValidSignature, secretsMatch };
