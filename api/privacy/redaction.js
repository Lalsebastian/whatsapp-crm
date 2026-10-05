// Masks high-risk identifiers that customers sometimes read out in voice
// notes. Deliberately narrow: only patterns with a low false-positive rate,
// so booking details (dates, times, flat numbers, phone numbers the customer
// wants us to call) are left intact.

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES = [
  {
    // Emirates ID: 784-YYYY-NNNNNNN-C, with or without separators.
    kind: 'emirates_id',
    re: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g,
    replace: () => '[redacted Emirates ID]',
  },
  {
    // UAE IBAN: AE + 2 check digits + 19 digits, optional spaces.
    kind: 'iban',
    re: /\bAE\d{2}(?:\s?\d){19}\b/gi,
    replace: () => '[redacted IBAN]',
  },
  {
    // Card numbers: 13-19 digits (optionally grouped), Luhn-checked so
    // ordinary long numbers are not masked.
    kind: 'card_number',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (match) => (luhnValid(match.replace(/\D/g, '')) ? '[redacted card number]' : match),
  },
];

/**
 * @returns {{ text: string, redactions: string[] }}
 */
function redactSensitive(text) {
  if (!text || typeof text !== 'string') return { text, redactions: [] };
  const redactions = [];
  let output = text;
  for (const rule of RULES) {
    output = output.replace(rule.re, (match) => {
      const replaced = rule.replace(match);
      if (replaced !== match) redactions.push(rule.kind);
      return replaced;
    });
  }
  return { text: output, redactions };
}

module.exports = { redactSensitive, luhnValid };
