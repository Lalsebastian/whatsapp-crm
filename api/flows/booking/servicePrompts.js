// Service list and inferred-service confirmation prompts.
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const { withFieldDiagnostics } = require('../conversationFields');
const { FLOW } = require('./shared');

async function promptServiceList(session, services, context = {}, intro) {
  await whatsapp.sendListMessage(
    session.phone,
    intro || 'Certainly. What service can I help you with? You can select one below or describe the problem in your own words.',
    'Choose service',
    [{ title: 'Available Services', rows: services.slice(0, 10).map((service) => ({
      id: `SVC_${service.id}`,
      title: service.name,
      description: service.basePrice ? `From AED ${service.basePrice}` : (service.description || ''),
    })) }]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_service', withFieldDiagnostics(context));
}

async function promptServiceConfirmation(session, service, context, match = {}) {
  await whatsapp.sendButtons(session.phone, `It sounds like you need ${service.name}. Is that correct?`, [
    { id: 'CONFIRM_INFERRED_SERVICE', title: `Yes, ${service.name}` },
    { id: 'CHOOSE_ANOTHER_SERVICE', title: 'Choose Another' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_service', {
    ...context,
    inferredServiceId: service.id,
    inferredServiceName: service.name,
    serviceMatchSource: match.source || 'ai',
    serviceMatchConfidence: match.confidence ?? null,
  });
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Focused question when a message fits a few services ("water near the
 * light" → Plumbing or Electrical): the likely services as buttons, plus
 * "Other Services" when there is room. Keeps the customer in the flow
 * instead of restarting it.
 */
async function promptServiceShortlist(session, candidates, context = {}, intro) {
  const shown = candidates.slice(0, candidates.length >= 3 ? 3 : 2);
  const buttons = shown.map((service) => ({ id: `SVC_${service.id}`, title: service.name.slice(0, 20) }));
  if (buttons.length < 3) buttons.push({ id: 'MORE_SERVICES', title: 'Other Services' });
  const names = shown.map((service) => service.name);
  await whatsapp.sendButtons(
    session.phone,
    intro || `It sounds like this is about ${joinNames(names)}. Which one do you mean?`,
    buttons
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_service', withFieldDiagnostics({
    ...context,
    shortlistedServices: shown.map((service) => ({ id: service.id, name: service.name })),
  }));
}

module.exports = {
  promptServiceList,
  promptServiceConfirmation,
  promptServiceShortlist,
  joinNames,
};
