// Unit costs for the message-cost analytics. These are estimates you set to
// match your contracts; nothing is billed by this code.
//   AI_CALL            average cost of one Gemini text request
//   TEMPLATE_MESSAGE   cost of one business-initiated template message
//                      (utility category in your WhatsApp market)
//   SESSION_MESSAGE    cost of a free-form reply inside the 24h window
//                      (free under WhatsApp's per-message pricing)
function rate(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

module.exports = Object.freeze({
  CURRENCY: process.env.COST_CURRENCY || 'USD',
  AI_CALL: rate('COST_PER_AI_CALL', 0.0003),
  TEMPLATE_MESSAGE: rate('COST_PER_TEMPLATE_MESSAGE', 0.0157),
  SESSION_MESSAGE: rate('COST_PER_SESSION_MESSAGE', 0),
});
