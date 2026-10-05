// Changing details after review: buttons ("Change Date") and natural-language
// corrections ("make it tomorrow evening at my office").
const whatsapp = require('../../whatsapp/client');
const logger = require('../../utils/logger');
const sessionStore = require('../../session/sessionStore');
const { parseDateInput } = require('../dateUtils');
const serviceResolver = require('../../ai/serviceResolver');
const intentService = require('../../ai/intentService');
const AI_CONFIDENCE = require('../../ai/confidence');
const {
  crm,
  FLOW,
  correctionContext,
  propertyDisplay,
  matchSavedProperty,
} = require('./shared');
const { promptServiceList, promptServiceConfirmation } = require('./servicePrompts');
const { promptForDate, showAvailability } = require('./schedule');
const { promptFinalConfirmation } = require('./summary');
const { continueWithService } = require('./serviceSelection');

async function handleReviewItem(session, customer, input) {
  const { currentItem } = session.context;
  if (!currentItem) {
    await whatsapp.sendText(session.phone, 'I could not find the service details. Please type "menu" to start again.');
    return;
  }
  if (['CHANGE_BOOKING_DETAILS', 'CHANGE_DETAILS'].includes(input.buttonId)) {
    return promptChangeDetails(session, session.context.cart || [], currentItem);
  }
  if (input.text) {
    return handleNaturalCorrection(session, customer, input, session.context.cart || [], currentItem);
  }
  if (!['ADD_ANOTHER_SERVICE', 'PROCEED_TO_BOOKING'].includes(input.buttonId)) {
    await whatsapp.sendText(session.phone, 'Please select Add Another Service, Proceed to Booking, or Change Details.');
    return;
  }
  const cart = [...(session.context.cart || []), currentItem];
  if (input.buttonId === 'ADD_ANOTHER_SERVICE') {
    const services = await crm.getServices();
    return promptServiceList(session, services, {
      cart,
      propertyId: currentItem.propertyId,
      propertyLabel: currentItem.propertyLabel,
      date: currentItem.date,
    }, 'Your service is ready to book. What other service would you like to add for the same address?');
  }
  await promptFinalConfirmation(session, cart);
}

async function promptChangeDetails(session, cart, currentItem) {
  logger.audit('BOOKING_CHANGE_REQUESTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'change_details',
    serviceId: currentItem && currentItem.serviceId,
    result: 'requested',
  });
  await whatsapp.sendButtons(session.phone, 'Which booking detail would you like to change?', [
    { id: 'CHANGE_SERVICE', title: 'Change Service' },
    { id: 'CHANGE_PROPERTY', title: 'Change Address' },
    { id: 'CHANGE_MORE', title: 'More Changes' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'change_details', { cart, currentItem });
}

async function promptMoreChanges(session, cart, currentItem) {
  await whatsapp.sendButtons(session.phone, 'What else would you like to change?', [
    { id: 'CHANGE_DATE', title: 'Change Date' },
    { id: 'CHANGE_TIME', title: 'Change Time' },
    { id: 'BACK_TO_REVIEW', title: 'Back to Review' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'change_more', { cart, currentItem });
}

async function handleChangeDetails(session, customer, input) {
  const { cart = [], currentItem } = session.context;
  if (!currentItem) {
    await whatsapp.sendText(session.phone, 'I could not find the booking details. Please type "menu" to start again.');
    return;
  }
  if (input.buttonId === 'CHANGE_SERVICE') {
    const services = await crm.getServices();
    return promptServiceList(
      session,
      services,
      correctionContext(currentItem, cart, ['service']),
      'Certainly. Please choose the service you need.'
    );
  }
  if (['CHANGE_PROPERTY', 'CHANGE_ADDRESS'].includes(input.buttonId)) {
    const service = await crm.getServiceDetails(currentItem.serviceId);
    return continueWithService(session, customer, service || {
      id: currentItem.serviceId,
      name: currentItem.serviceName,
    }, {
      ...correctionContext(currentItem, cart, ['property']),
      propertyId: undefined,
      propertyLabel: undefined,
      locationHint: undefined,
    });
  }
  if (input.buttonId === 'CHANGE_MORE') {
    return promptMoreChanges(session, cart, currentItem);
  }
  if (input.buttonId === 'CHANGE_DATE_TIME') {
    return promptForDate(session, { ...correctionContext(currentItem, cart, ['date']), date: undefined });
  }
  if (input.text) {
    return handleNaturalCorrection(session, customer, input, cart, currentItem);
  }
  await whatsapp.sendText(session.phone, 'Please select Change Service, Change Address, or More Changes.');
}

async function handleMoreChanges(session, customer, input) {
  const { cart = [], currentItem } = session.context;
  if (!currentItem) {
    await whatsapp.sendText(session.phone, 'I could not find the booking details. Please type "menu" to start again.');
    return;
  }
  if (input.buttonId === 'CHANGE_DATE') {
    return promptForDate(session, { ...correctionContext(currentItem, cart, ['date']), date: undefined });
  }
  if (input.buttonId === 'CHANGE_TIME') {
    return showAvailability(session, correctionContext(currentItem, cart, ['time']), currentItem.date);
  }
  if (input.buttonId === 'BACK_TO_REVIEW') {
    return promptFinalConfirmation(session, [...cart, currentItem]);
  }
  if (input.text) {
    return handleNaturalCorrection(session, customer, input, cart, currentItem);
  }
  await whatsapp.sendText(session.phone, 'Please select Change Date, Change Time, or Back to Review.');
}

function extractDateCorrection(text, aiDate) {
  const parsedAiDate = parseDateInput(aiDate);
  if (parsedAiDate) return parsedAiDate;
  const normalized = String(text || '').toLowerCase();
  const explicit = normalized.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (explicit) return parseDateInput(explicit[0]);
  const relative = normalized.match(/\b(?:the )?day after tomorrow\b|\btomorrow\b|\btoday\b/);
  if (relative) return parseDateInput(relative[0]);
  const weekday = normalized.match(/\b(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  return weekday ? parseDateInput(weekday[0]) : null;
}

function extractTimeCorrection(text, aiTime) {
  if (aiTime) return aiTime;
  const normalized = String(text || '').toLowerCase();
  const period = normalized.match(/\b(?:morning|afternoon|evening|night|ravile|raavile|uchakku|vaikunneram|subah|dopahar|shaam)\b/);
  if (period) return period[0];
  const clock = normalized.match(/\b(?:after\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/);
  return clock ? clock[0] : null;
}

function extractLocationCorrection(text, aiLocation) {
  if (aiLocation) return aiLocation;
  const normalized = String(text || '').toLowerCase();
  if (/\b(?:my )?office(?: address)?\b/.test(normalized)) return 'office';
  if (/\b(?:my )?home(?: address)?\b/.test(normalized)) return 'home';
  return null;
}

async function handleNaturalCorrection(session, customer, input, cart, currentItem) {
  const analysis = await intentService.analyzeBookingCorrection(input.text, {
    preferredLanguage: session.preferredLanguage,
    booking: currentItem,
  });
  const trusted = analysis.confidence >= AI_CONFIDENCE.MEDIUM ? analysis : {};
  const date = extractDateCorrection(input.text, trusted.preferredDate || (input.ai && input.ai.preferredDate));
  const preferredTime = extractTimeCorrection(input.text, trusted.preferredTime || (input.ai && input.ai.preferredTime));
  const locationHint = extractLocationCorrection(input.text, trusted.locationHint || (input.ai && input.ai.locationHint));
  const serviceRequest = trusted.service || (input.ai && input.ai.service) || null;
  const fields = [];
  if (serviceRequest) fields.push('service');
  if (locationHint) fields.push('property');
  if (date) fields.push('date');
  if (preferredTime) fields.push('time');

  if (fields.length === 0) {
    await whatsapp.sendText(session.phone, 'Please tell me which detail you would like to change, or select Change Details to view the available options.');
    return;
  }

  const services = serviceRequest ? await crm.getServices() : null;
  const serviceMatch = serviceRequest
    ? await serviceResolver.resolveService(serviceRequest, services, { preferredLanguage: session.preferredLanguage })
    : null;
  const nextContext = {
    ...correctionContext(currentItem, cart, fields),
    date: date || currentItem.date,
    preferredTime: preferredTime || null,
    voiceNotes: input.voice
      ? [...(session.context.voiceNotes || []), input.voice]
      : session.context.voiceNotes,
  };

  if (locationHint) {
    const properties = await crm.getCustomerProperties(customer.id);
    const property = matchSavedProperty(locationHint, properties);
    nextContext.locationHint = locationHint;
    nextContext.propertyId = property ? property.id : undefined;
    nextContext.propertyLabel = property ? propertyDisplay(property) : undefined;
  }

  if (serviceRequest && (!serviceMatch || serviceMatch.confidence < AI_CONFIDENCE.MEDIUM)) {
    return promptServiceList(
      session,
      services,
      nextContext,
      'I could not confidently identify the new service. Please select the service you need.'
    );
  }

  const service = serviceMatch
    ? serviceMatch.service
    : await crm.getServiceDetails(currentItem.serviceId);
  if (!service) {
    await whatsapp.sendText(session.phone, 'I could not load the selected service. Please choose the service again.');
    return promptServiceList(session, await crm.getServices(), nextContext);
  }

  if (serviceMatch && serviceMatch.confidence < AI_CONFIDENCE.HIGH) {
    return promptServiceConfirmation(session, service, {
      ...nextContext,
      serviceMatchSource: serviceMatch.source,
      serviceMatchConfidence: serviceMatch.confidence,
    }, serviceMatch);
  }

  return continueWithService(session, customer, service, {
    ...nextContext,
    serviceMatchSource: serviceMatch ? serviceMatch.source : nextContext.serviceMatchSource,
    serviceMatchConfidence: serviceMatch ? serviceMatch.confidence : nextContext.serviceMatchConfidence,
  });
}

module.exports = {
  handleReviewItem,
  promptChangeDetails,
  handleChangeDetails,
  handleMoreChanges,
  handleNaturalCorrection,
};
