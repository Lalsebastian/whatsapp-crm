// Booking entry point and service selection (buttons, free text, voice and
// room-based recommendations).
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { parseDateInput, todayInTimeZone } = require('../dateUtils');
const serviceResolver = require('../../ai/serviceResolver');
const AI_CONFIDENCE = require('../../ai/confidence');
const { recommendServiceableServices } = require('../../ai/serviceRecommendations');
const { withFieldDiagnostics } = require('../conversationFields');
const messageBudget = require('../../analytics/messageBudget');
const {
  crm,
  FLOW,
  propertyDisplay,
  matchSavedProperty,
  aiPrefill,
  extractedFieldNames,
  noteAvoidedQuestion,
  normalizedSavedLocation,
} = require('./shared');
const {
  promptServiceList,
  promptServiceConfirmation,
  promptServiceShortlist,
  joinNames,
} = require('./servicePrompts');
const { promptPropertyList, advanceAfterProperty } = require('./property');
const { propertyInput, pinLocation, promptGeocodedPin } = require('./locationPin');

async function recommendationContext(session, customer, context) {
  if (context.location || context.propertyId || !customer) return context;
  const properties = await crm.getCustomerProperties(customer.id);
  const property = matchSavedProperty(context.locationHint, properties)
    || (!context.locationHint && (properties.find((item) => item.isDefault) || (properties.length === 1 ? properties[0] : null)));
  if (!property) return context;
  return noteAvoidedQuestion(session, {
    ...context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location: normalizedSavedLocation(property),
  }, 'property', 'saved_property_reused');
}

async function promptRecommendedServices(session, customer, services, context) {
  const cleanContext = await recommendationContext(session, customer, context);
  const recommendationResult = await recommendServiceableServices(cleanContext, services, {
    location: cleanContext.location,
    checkServiceability: crm.checkServiceability,
  });
  const recommendations = recommendationResult.services;
  if (recommendations.length === 0 && recommendationResult.excludedServiceIds.length > 0) {
    const locationName = cleanContext.propertyLabel || (cleanContext.location && cleanContext.location.label) || 'that address';
    await whatsapp.sendText(
      session.phone,
      `I couldn't find a relevant service currently available at ${locationName}. Please send another service address, or type "support" for assistance.`
    );
    await sessionStore.setFlow(session.phone, FLOW, 'recommendation_location', withFieldDiagnostics({
      ...cleanContext,
      serviceabilityFiltered: true,
      recommendedServices: [],
      excludedServiceIds: recommendationResult.excludedServiceIds,
      propertyId: undefined,
      propertyLabel: undefined,
      location: undefined,
    }));
    return;
  }
  if (recommendations.length === 0) return promptServiceList(session, services, context);
  const shown = recommendations.length > 3 ? recommendations.slice(0, 2) : recommendations.slice(0, 3);
  const buttons = shown.map((service) => ({ id: `SVC_${service.id}`, title: service.name }));
  if (recommendations.length > shown.length) buttons.push({ id: 'MORE_SERVICES', title: 'More Services' });
  const room = cleanContext.room ? ` with your ${cleanContext.room}` : '';
  await whatsapp.sendButtons(session.phone, `I can help${room}. What do you need?`, buttons);
  await sessionStore.setFlow(session.phone, FLOW, 'select_service', withFieldDiagnostics({
    ...cleanContext,
    recommendedServices: recommendations.map((service) => ({ id: service.id, name: service.name })),
    serviceabilityFiltered: recommendationResult.serviceabilityFiltered,
    excludedServiceIds: recommendationResult.excludedServiceIds,
  }));
}

async function handleRecommendationLocation(session, customer, input) {
  let property;
  let location;
  if (input.location) {
    const address = input.location.address || input.location.label;
    if (!address) {
      if (await promptGeocodedPin(session, session.context, input.location, 'recommendation')) return;
      await whatsapp.sendText(session.phone, 'Please send the full address with the location pin so I can check available services.');
      return;
    }
    property = await crm.addProperty(
      customer.id,
      propertyInput(address, input.location, null, input.location.label || undefined)
    );
    location = pinLocation(property, input.location, address);
  } else if (input.text && input.text.trim().length >= 5) {
    property = await crm.addProperty(customer.id, { addressLine: input.text.trim() });
    location = normalizedSavedLocation(property);
    location.source = 'typed_address';
  } else {
    await whatsapp.sendText(session.phone, 'Please send the full service address so I can check which services are available there.');
    return;
  }
  const services = await crm.getServices();
  return promptRecommendedServices(session, customer, services, {
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location,
  });
}

async function startBooking(session, customer, input = {}) {
  const firstMessageFields = extractedFieldNames(input);
  messageBudget.start(session.phone, { initialCustomerMessages: 1, fieldsExtracted: firstMessageFields });
  logger.audit('BOOKING_STARTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    source: input.source || (input.buttonId ? 'button' : 'text'),
    returningCustomer: !!(customer && customer.profile && customer.profile.returningCustomer),
    language: session.preferredLanguage,
    result: 'started',
  });
  const services = await crm.getServices();
  if (!services || services.length === 0) {
    await whatsapp.sendText(session.phone, "I'm sorry, our services are not available for booking right now. Please try again shortly, or type \"support\" to speak with our team.");
    return;
  }
  const context = withFieldDiagnostics({
    ...aiPrefill(input),
    ...(input.prefill || {}),
    customerName: customer && customer.name,
    firstMessageFields,
  });
  if (input.ai) {
    const serviceText = [input.ai.service, input.ai.issue, input.text].filter(Boolean).join(' ');
    if (!input.ai.service && !input.ai.issue && input.ai.room) {
      return promptRecommendedServices(session, customer, services, context);
    }
    // Several plausible services and no exact name: ask which one, without
    // an AI call, instead of guessing or showing the whole catalogue.
    const candidates = serviceResolver.rankServiceCandidates(serviceText, services);
    if (candidates.length >= 2 && !serviceResolver.exactServiceMatch(serviceText, services, { namesOnly: true })
      && !serviceResolver.semanticHintMatch(serviceText, services)) {
      logger.audit('SERVICE_CLARIFICATION_ASKED', { phone: session.phone, flow: FLOW, candidates: candidates.length, result: 'asked' });
      return promptServiceShortlist(session, candidates, context);
    }
    const match = await serviceResolver.resolveService(serviceText, services, {
      preferredLanguage: session.preferredLanguage,
    });
    if (match && match.confidence >= AI_CONFIDENCE.HIGH) {
      return continueWithService(session, customer, match.service, noteAvoidedQuestion(session, {
        ...context,
        serviceMatchSource: match.source,
        serviceMatchConfidence: match.confidence,
      }, 'service', 'service_extracted'));
    }
    if (match && match.confidence >= AI_CONFIDENCE.MEDIUM) {
      return promptServiceConfirmation(session, match.service, context, match);
    }
    logger.audit('AI_FALLBACK_USED', { phone: session.phone, flow: FLOW, step: 'select_service', taskType: 'service_match', reason: 'service_not_resolved', result: 'fallback' });
    if (context.room) return promptRecommendedServices(session, customer, services, context);
    if (candidates.length === 1) return promptServiceConfirmation(session, candidates[0], context, { source: 'synonym', confidence: AI_CONFIDENCE.MEDIUM });
  }
  // A bare "I want to book": lead with what this customer has booked before.
  const familiar = recentServicesFor(customer, services);
  if (familiar.length > 0) {
    return promptServiceShortlist(
      session,
      familiar,
      context,
      `Certainly. Is this for ${joinNames(familiar.map((service) => service.name))} again, or something else? You can also describe the problem in your own words.`
    );
  }
  await promptServiceList(session, services, context);
}

// Distinct services from the customer's recent bookings that are still in
// the catalogue, most recent first (max 2, leaving room for "Other Services").
function recentServicesFor(customer, services) {
  const recent = (customer && customer.profile && customer.profile.recentBookings) || [];
  const seen = new Set();
  const result = [];
  for (const booking of recent) {
    if (!booking.serviceId || seen.has(String(booking.serviceId))) continue;
    seen.add(String(booking.serviceId));
    const service = services.find((item) => String(item.id) === String(booking.serviceId));
    if (service) result.push(service);
    if (result.length === 2) break;
  }
  return result;
}

/**
 * Continues a saved booking draft (see router/bookingRecovery.js). Nothing
 * from the draft is trusted blindly: the service must still exist, the
 * address must still belong to the customer, a past date is dropped, and the
 * time is always re-picked from live availability.
 */
async function resumeBookingDraft(session, customer, draft) {
  const saved = (draft && draft.context) || {};
  messageBudget.start(session.phone, { initialCustomerMessages: 1, fieldsExtracted: [] });
  const {
    time, timeEnd, slotId, slotStartsAt, slotEndsAt, timezone, availableSlots, confirmationNonce,
    currentItem, correctionMode, correctionFields, correctionPreviousItem, offeredDates, ...rest
  } = saved;
  const context = withFieldDiagnostics({ ...rest, cart: Array.isArray(saved.cart) ? saved.cart : [] });
  if (context.date && context.date < todayInTimeZone()) delete context.date;
  if (context.propertyId) {
    const properties = await crm.getCustomerProperties(customer.id);
    if (!(properties || []).some((property) => String(property.id) === String(context.propertyId))) {
      delete context.propertyId;
      delete context.propertyLabel;
      delete context.location;
    }
  }
  const serviceId = context.serviceId || (currentItem && currentItem.serviceId);
  const service = serviceId ? await crm.getServiceDetails(serviceId) : null;
  logger.audit('BOOKING_RESUMED', {
    phone: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    serviceId,
    result: service ? 'resumed' : 'service_unavailable',
  });
  if (!service) {
    return promptServiceList(session, await crm.getServices(), context, 'Welcome back. That service is no longer available, so please choose the service you need.');
  }
  return continueWithService(session, customer, service, { ...context, serviceMatchSource: 'resumed', serviceMatchConfidence: 1 });
}

/**
 * Starts a booking for a known service (quick actions such as "Book Plumbing
 * Again" or an add-on suggestion). `prefill` may carry an owned propertyId
 * and a date, which still go through serviceability and live availability.
 */
async function startBookingForService(session, customer, serviceId, prefill = {}) {
  messageBudget.start(session.phone, { initialCustomerMessages: 1, fieldsExtracted: ['service'] });
  const service = await crm.getServiceDetails(serviceId);
  logger.audit('BOOKING_STARTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    source: prefill.source || 'quick_action',
    returningCustomer: !!(customer && customer.profile && customer.profile.returningCustomer),
    result: service ? 'started' : 'service_unavailable',
  });
  if (!service) {
    return promptServiceList(session, await crm.getServices(), {}, 'I\'m sorry, that service is no longer available. Please choose another service.');
  }
  const { source, ...context } = prefill;
  return continueWithService(session, customer, service, withFieldDiagnostics({
    cart: [],
    customerName: customer && customer.name,
    interactionSource: 'button',
    serviceMatchSource: source || 'quick_action',
    serviceMatchConfidence: 1,
    ...context,
  }));
}

async function continueWithService(session, customer, service, priorContext = {}) {
  logger.audit('SERVICE_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    step: 'select_service',
    serviceId: service.id,
    source: priorContext.interactionSource || priorContext.serviceMatchSource || null,
    matchSource: priorContext.serviceMatchSource,
    confidence: priorContext.serviceMatchConfidence,
    result: 'selected',
  });
  if (priorContext.serviceMatchSource === 'ai') {
    logger.audit('AI_SERVICE_MATCH_USED', {
      phone: session.phone,
      flow: FLOW,
      serviceId: service.id,
      confidence: priorContext.serviceMatchConfidence,
      provider: 'gemini',
      result: 'used',
    });
  }
  const { inferredServiceId, inferredServiceName, ...cleanContext } = priorContext;
  const context = withFieldDiagnostics({
    ...cleanContext,
    serviceId: service.id,
    serviceName: service.name,
    price: service.basePrice || null,
  });
  if (context.propertyId) return advanceAfterProperty(session, context);

  const properties = await crm.getCustomerProperties(customer.id);
  const matchedProperty = matchSavedProperty(context.locationHint, properties);
  if (matchedProperty) {
    const matchedContext = noteAvoidedQuestion(session, context, 'property', 'saved_property_matched');
    return advanceAfterProperty(session, withFieldDiagnostics({
      ...matchedContext,
      propertyId: matchedProperty.id,
      propertyLabel: propertyDisplay(matchedProperty),
      location: {
        propertyId: matchedProperty.id,
        label: matchedProperty.label || null,
        address: matchedProperty.addressLine,
        latitude: null,
        longitude: null,
        areaId: null,
        areaName: matchedProperty.area || null,
        source: 'saved_property',
      },
    }));
  }
  if (properties.length === 0) {
    const noted = context.locationHint ? ` I noted “${context.locationHint}”, but I still need the full address.` : '';
    await whatsapp.sendText(session.phone, `Please send the full service address.${noted}`);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', context);
    return;
  }

  const preferred = properties.find((property) => property.isDefault) || (properties.length === 1 ? properties[0] : null);
  if (preferred && !context.locationHint) {
    logger.audit('DEFAULT_PROPERTY_USED', {
      phone: session.phone, customerId: customer.id, propertyId: preferred.id, result: 'auto_selected',
    });
    const preferredContext = noteAvoidedQuestion(session, context, 'property', 'default_property_reused');
    return advanceAfterProperty(session, withFieldDiagnostics({
      ...preferredContext,
      propertyId: preferred.id,
      propertyLabel: propertyDisplay(preferred),
      location: {
        propertyId: preferred.id,
        label: preferred.label || null,
        address: preferred.addressLine,
        latitude: null,
        longitude: null,
        areaId: null,
        areaName: preferred.area || null,
        source: 'saved_property',
      },
    }));
  }
  return promptPropertyList(session, service, context, properties);
}

async function handleSelectService(session, customer, input) {
  const services = await crm.getServices();
  const interactionSource = input.source || (input.buttonId ? 'button' : 'text');
  const voiceContext = input.voice
    ? { ...session.context, voiceNotes: [...(session.context.voiceNotes || []), input.voice] }
    : session.context;
  if (input.buttonId === 'MORE_SERVICES') {
    return promptServiceList(session, services, voiceContext, 'Please select the service you need, or describe the issue in your own words.');
  }
  if (input.buttonId && input.buttonId.startsWith('SVC_')) {
    const service = await crm.getServiceDetails(input.buttonId.replace('SVC_', ''));
    if (service) return continueWithService(session, customer, service, {
      ...voiceContext,
      interactionSource,
      serviceMatchSource: 'button',
      serviceMatchConfidence: 1,
    });
  } else if (input.text) {
    const enrichedContext = withFieldDiagnostics({
      ...voiceContext,
      room: (input.ai && input.ai.room) || voiceContext.room,
      issue: (input.ai && input.ai.issue) || voiceContext.issue || input.text.trim(),
      locationHint: (input.ai && (input.ai.locationHint || input.ai.propertyHint)) || voiceContext.locationHint,
      date: parseDateInput(input.ai && input.ai.preferredDate) || voiceContext.date,
      preferredTime: (input.ai && input.ai.preferredTime) || voiceContext.preferredTime,
    });
    const match = await serviceResolver.resolveService(input.text, services, {
      preferredLanguage: session.preferredLanguage,
    });
    if (match && match.confidence >= AI_CONFIDENCE.HIGH) {
      return continueWithService(session, customer, match.service, noteAvoidedQuestion(session, {
        ...enrichedContext,
        interactionSource,
        issue: voiceContext.issue || input.text.trim(),
        serviceMatchSource: match.source,
        serviceMatchConfidence: match.confidence,
      }, 'service', 'service_extracted'));
    }
    if (match && match.confidence >= AI_CONFIDENCE.MEDIUM) {
      return promptServiceConfirmation(session, match.service, {
        ...enrichedContext,
        interactionSource,
        issue: voiceContext.issue || input.text.trim(),
      }, match);
    }
    logger.audit('AI_LOW_CONFIDENCE', { phone: session.phone, flow: FLOW, step: 'select_service', taskType: 'service_match', result: 'fallback' });
    if (enrichedContext.room) return promptRecommendedServices(session, customer, services, enrichedContext);
  }
  const message = input.buttonId
    ? "I'm sorry, that service is no longer available. Please select another service."
    : 'I\'m not sure which of our services covers that. Please choose the closest one below, or type "support" and our team will help.';
  await promptServiceList(session, services, voiceContext, message);
}

async function handleConfirmService(session, customer, input) {
  if (input.buttonId === 'CHOOSE_ANOTHER_SERVICE') {
    const services = await crm.getServices();
    const {
      inferredServiceId,
      inferredServiceName,
      serviceMatchSource,
      serviceMatchConfidence,
      ...context
    } = session.context;
    return promptServiceList(session, services, context, 'Certainly. Please choose another service or describe what you need.');
  }
  if (input.buttonId !== 'CONFIRM_INFERRED_SERVICE') {
    await whatsapp.sendText(session.phone, 'Please confirm the suggested service or choose another service.');
    return;
  }
  const service = await crm.getServiceDetails(session.context.inferredServiceId);
  if (!service) {
    const services = await crm.getServices();
    return promptServiceList(session, services, session.context, 'That service is no longer available. Please choose another service.');
  }
  await continueWithService(session, customer, service, session.context);
}

module.exports = {
  startBooking,
  startBookingForService,
  resumeBookingDraft,
  continueWithService,
  promptRecommendedServices,
  handleRecommendationLocation,
  handleSelectService,
  handleConfirmService,
};
