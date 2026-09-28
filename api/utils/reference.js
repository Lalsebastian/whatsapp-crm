// Human-friendly reference codes for bookings/complaints, e.g. BK-7F3K9Q, CM-4H2M8X.
// Excludes visually ambiguous characters (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateReference(prefix) {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

module.exports = { generateReference };
