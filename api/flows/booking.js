// Hybrid booking flow. Buttons/lists remain the fastest path, while text and
// transcribed voice notes can prefill fields. AI only interprets input; every
// service, property, date and slot is validated against CRM data before the
// backend performs any booking action.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput, formatDateForCustomer, formatSlotForCustomer } = require('./dateUtils');
const serviceResolver = require('../ai/serviceResolver');
const intentService = require('../ai/intentService');
const AI_CONFIDENCE = require('../ai/confidence');
const { getCrmAdapter } = require('../crm');
const { randomUUID } = require('node:crypto');
const { executeOnce } = require('../reliability/actionGuard');
const { triggerEscalation } = require('../escalation/escalationService');
const { recommendServiceableServices } = require('../ai/serviceRecommendations');
const { withFieldDiagnostics } = require('./conversationFields');
const messageBudget = require('../analytics/messageBudget');

const crm = getCrmAdapter();
const FLOW = 'booking';

const CORRECTION_FIELDS = ['service', 'property', 'date', 'time'];

function bookingItemFromContext(context) {
  return {
    serviceId: context.serviceId,
    serviceName: context.serviceName,
    propertyId: context.propertyId,
    propertyLabel: context.propertyLabel || context.locationHint || 'Saved service address',
    date: context.date,
    time: context.time,
    room: context.room || null,
    issue: context.issue || null,
  };
}

function correctionValue(item, field) {
  if (field === 'service') return item.serviceName;
  if (field === 'property') return item.propertyLabel;
  return item[field];
}

function buildCorrectionDebug(fields, previousItem, nextItem) {
  const changedFields = [...new Set((fields || []).filter((field) => CORRECTION_FIELDS.includes(field)))];
  if (changedFields.length === 0) return null;
  if (changedFields.length === 1) {
    const field = changedFields[0];
    return {
      changedField: field,
      previousValue: correctionValue(previousItem, field) || null,
      newValue: correctionValue(nextItem, field) || null,
    };
  }
  return {
    changedField: changedFields,
    previousValue: Object.fromEntries(changedFields.map((field) => [field, correctionValue(previousItem, field) || null])),
    newValue: Object.fromEntries(changedFields.map((field) => [field, correctionValue(nextItem, field) || null])),
  };
}

function correctionContext(item, cart, fields) {
  return {
    ...item,
    cart,
    correctionMode: true,
    correctionFields: fields,
    correctionPreviousItem: item,
    time: fields.some((field) => ['service', 'property', 'date', 'time'].includes(field)) ? undefined : item.time,
    availableSlots: undefined,
  };
}

function propertyDisplay(property) {
  const place = [property.area, property.city].filter(Boolean).join(', ');
  return property.label ? `${property.label}${place ? ` — ${place}` : ''}` : property.addressLine;
}

function propertyName(property) {
  return property.label || property.area || property.addressLine;
}

function prioritizeProperties(properties, recentBookings = []) {
  const recentOrder = new Map();
  recentBookings.forEach((booking, index) => {
    if (booking.propertyId && !recentOrder.has(booking.propertyId)) recentOrder.set(booking.propertyId, index);
  });
  return [...properties].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    const leftRecent = recentOrder.has(left.id) ? recentOrder.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightRecent = recentOrder.has(right.id) ? recentOrder.get(right.id) : Number.MAX_SAFE_INTEGER;
    return leftRecent - rightRecent;
  });
}

async function promptPropertyList(session, service, context, properties) {
  const { suggestedPropertyId, suggestedPropertyLabel, ...cleanContext } = context;
  const ordered = prioritizeProperties(properties, (session.customerProfile && session.customerProfile.recentBookings) || []);
  const propertyOptions = {};
  const rows = ordered.slice(0, 9).map((property) => {
    propertyOptions[property.id] = propertyDisplay(property);
    return {
      id: `PROP_${property.id}`,
      title: property.label || property.addressLine.slice(0, 24),
      description: [property.addressLine, property.area, property.city].filter(Boolean).join(', ').slice(0, 72),
    };
  });
  rows.push({ id: 'PROP_NEW', title: 'Use Another Address', description: 'Enter a different service address' });
  await whatsapp.sendListMessage(session.phone, `Where would you like the ${service.name} professional to visit?`, 'Choose address', [
    { title: 'Saved Addresses', rows },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_property', { ...cleanContext, propertyOptions });
}

async function promptPropertyConfirmation(session, service, context, property) {
  const name = propertyName(property);
  await whatsapp.sendButtons(
    session.phone,
    `Certainly. Would you like the ${service.name} service at your ${name} address?`,
    [
      { id: 'CONFIRM_DEFAULT_PROPERTY', title: `Yes, ${name}`.slice(0, 20) },
      { id: 'CHOOSE_ANOTHER_PROPERTY', title: 'Choose Another' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_default_property', {
    ...context,
    suggestedPropertyId: property.id,
    suggestedPropertyLabel: propertyDisplay(property),
  });
  logger.audit('DEFAULT_PROPERTY_OFFERED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'confirm_default_property',
    serviceId: service.id,
    propertyId: property.id,
    result: 'offered',
  });
}

function matchSavedProperty(locationHint, properties) {
  const hint = String(locationHint || '').trim().toLowerCase();
  if (!hint) return null;
  const matches = properties.filter((property) =>
    [property.label, property.addressLine, property.area, property.city]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(hint) || hint.includes(String(value).toLowerCase()))
  );
  return matches.length === 1 ? matches[0] : null;
}

function selectPreferredSlot(preference, slots) {
  const wanted = String(preference || '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = slots.filter((slot) =>
    String(slot).toLowerCase() === wanted || formatSlotForCustomer(slot).toLowerCase() === wanted
  );
  if (exact.length === 1) return exact[0];
  const clock = wanted.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (clock) {
    let requestedHour = Number(clock[1]);
    const requestedMinute = Number(clock[2] || 0);
    const period = clock[3] || (/evening|night|shaam|vaikunneram/.test(wanted) ? 'pm' : null);
    if (period === 'pm' && requestedHour < 12) requestedHour += 12;
    if (period === 'am' && requestedHour === 12) requestedHour = 0;
    const requestedTotal = requestedHour * 60 + requestedMinute;
    const candidates = slots
      .map((slot) => {
        const match = String(slot).match(/^(\d{1,2}):(\d{2})/);
        return match ? { slot, total: Number(match[1]) * 60 + Number(match[2]) } : null;
      })
      .filter(Boolean)
      .filter((entry) => /\bafter\b/.test(wanted) ? entry.total >= requestedTotal : entry.total === requestedTotal)
      .sort((a, b) => a.total - b.total);
    if (candidates.length > 0) return candidates[0].slot;
  }
  const periodMatches = slots.filter((slot) => {
    const hourMatch = String(slot).match(/^(\d{1,2}):/);
    if (!hourMatch) return false;
    const hour = Number(hourMatch[1]);
    if (/morning|ravile|raavile|subah/.test(wanted)) return hour < 12;
    if (/afternoon|uchakku|dopahar/.test(wanted)) return hour >= 12 && hour < 17;
    if (/evening|vaikunneram|shaam|night/.test(wanted)) return hour >= 17;
    return false;
  });
  return periodMatches.length === 1 ? periodMatches[0] : null;
}

function aiPrefill(input = {}) {
  const ai = input.ai || {};
  return withFieldDiagnostics({
    room: ai.room || null,
    issue: ai.issue || null,
    locationHint: ai.locationHint || ai.propertyHint || null,
    date: parseDateInput(ai.preferredDate),
    preferredTime: ai.preferredTime || null,
    voiceNotes: input.voice ? [input.voice] : [],
    interactionSource: input.source || (input.buttonId ? 'button' : 'text'),
    cart: [],
  });
}

function extractedFieldNames(input = {}) {
  const ai = input.ai || {};
  return [
    (ai.service || ai.serviceId) && 'service',
    ai.room && 'room',
    ai.issue && 'issue',
    (ai.propertyHint || ai.locationHint || input.location) && 'property',
    ai.preferredDate && 'date',
    ai.preferredTime && 'time',
  ].filter(Boolean);
}

function noteAvoidedQuestion(session, context, field, reason) {
  const fields = [...new Set(context.redundantQuestionFields || [])];
  if (fields.includes(field)) return context;
  fields.push(field);
  messageBudget.avoidQuestion(session.phone);
  logger.audit('REDUNDANT_QUESTION_AVOIDED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    field,
    reason,
    count: 1,
    dedupeKey: randomUUID(),
    result: 'avoided',
  });
  return { ...context, redundantQuestionFields: fields, redundantQuestionsAvoided: fields.length };
}

function normalizedSavedLocation(property) {
  return {
    propertyId: property.id,
    label: property.label || null,
    address: property.addressLine,
    latitude: null,
    longitude: null,
    areaId: null,
    areaName: property.area || null,
    source: 'saved_property',
  };
}

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
      await whatsapp.sendText(session.phone, 'Please send the full address with the location pin so I can check available services.');
      return;
    }
    property = await crm.addProperty(customer.id, { addressLine: address, label: input.location.label || undefined });
    location = {
      propertyId: property.id,
      label: input.location.label || property.label || null,
      address,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      areaId: null,
      areaName: property.area || null,
      source: 'whatsapp_location',
    };
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
    customerName: customer && customer.name,
    firstMessageFields,
  });
  if (input.ai) {
    const serviceText = [input.ai.service, input.ai.issue, input.text].filter(Boolean).join(' ');
    if (!input.ai.service && !input.ai.issue && input.ai.room) {
      return promptRecommendedServices(session, customer, services, context);
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
  }
  await promptServiceList(session, services, context);
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

async function handleConfirmDefaultProperty(session, customer, input) {
  const service = await crm.getServiceDetails(session.context.serviceId);
  const properties = await crm.getCustomerProperties(customer.id);
  if (!service) return promptServiceList(session, await crm.getServices(), session.context);

  if (input.buttonId === 'CHOOSE_ANOTHER_PROPERTY') {
    return promptPropertyList(session, service, session.context, properties);
  }
  if (input.buttonId !== 'CONFIRM_DEFAULT_PROPERTY') {
    await whatsapp.sendText(session.phone, 'Please confirm the suggested address or choose another address.');
    return;
  }

  const property = properties.find((item) => item.id === session.context.suggestedPropertyId);
  if (!property) {
    await whatsapp.sendText(session.phone, 'That saved address is no longer available. Please choose another address.');
    if (properties.length) return promptPropertyList(session, service, session.context, properties);
    await whatsapp.sendText(session.phone, 'Please send the full service address.');
    return sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
  }
  logger.audit('DEFAULT_PROPERTY_USED', {
    phone: session.phone,
    customerId: customer.id,
    propertyId: property.id,
    result: 'confirmed',
  });
  return advanceAfterProperty(session, {
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    suggestedPropertyId: undefined,
    suggestedPropertyLabel: undefined,
  });
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
    : "I couldn't confidently match that request to an available service. Please select the closest option below.";
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

async function handleSelectProperty(session, customer, input) {
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, 'Certainly. Please send the full service address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  if (input.location) {
    const address = input.location.address || input.location.label;
    if (!address) {
      await whatsapp.sendText(session.phone, 'I received the location pin. Please also send the full address so our technician can locate the property.');
      await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
        ...session.context,
        location: { ...input.location, source: 'whatsapp_location' },
      }));
      return;
    }
    const property = await crm.addProperty(customer.id, { addressLine: address, label: input.location.label || undefined });
    return advanceAfterProperty(session, withFieldDiagnostics({
      ...session.context,
      propertyId: property.id,
      propertyLabel: propertyDisplay(property),
      location: {
        propertyId: property.id,
        label: input.location.label || null,
        address,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        areaId: null,
        areaName: property.area || null,
        source: 'whatsapp_location',
      },
    }));
  }
  let propertyId = input.buttonId && input.buttonId.startsWith('PROP_')
    ? input.buttonId.replace('PROP_', '')
    : null;
  if (!propertyId && input.text) {
    const words = input.text.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !['the', 'my', 'address'].includes(word));
    const matches = Object.entries(session.context.propertyOptions || {}).filter(([, label]) =>
      words.length > 0 && words.every((word) => String(label).toLowerCase().includes(word))
    );
    if (matches.length === 1) propertyId = matches[0][0];
  }
  if (!propertyId && input.text && session.context.correctionMode && input.text.trim().length >= 5) {
    return handleAwaitingNewProperty(session, customer, input);
  }
  if (!propertyId) {
    await whatsapp.sendText(session.phone, 'Please select a saved address or choose Use Another Address.');
    return;
  }
  const properties = await crm.getCustomerProperties(customer.id);
  const property = properties.find((item) => item.id === propertyId);
  if (!property) {
    const service = await crm.getServiceDetails(session.context.serviceId);
    await whatsapp.sendText(session.phone, 'That saved address is no longer available. Please choose another address.');
    if (service && properties.length) return promptPropertyList(session, service, session.context, properties);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  await advanceAfterProperty(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    propertyId,
    propertyLabel: propertyDisplay(property),
    propertyOptions: undefined,
  });
}

async function handleAwaitingNewProperty(session, customer, input) {
  if (input.location) return handleSelectProperty(session, customer, input);
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, 'Please send the full service address so our technician can locate it.');
    return;
  }
  const property = await crm.addProperty(customer.id, { addressLine: input.text.trim() });
  await advanceAfterProperty(session, withFieldDiagnostics({
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location: {
      propertyId: property.id,
      label: property.label || null,
      address: property.addressLine,
      latitude: session.context.location && session.context.location.latitude,
      longitude: session.context.location && session.context.location.longitude,
      areaId: null,
      areaName: property.area || null,
      source: session.context.location && session.context.location.source === 'whatsapp_location'
        ? 'whatsapp_location'
        : 'typed_address',
    },
  }));
}

async function advanceAfterProperty(session, context) {
  logger.audit('PROPERTY_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_property',
    serviceId: context.serviceId,
    propertyId: context.propertyId,
    result: 'selected',
  });
  if (typeof crm.checkServiceability === 'function') {
    const serviceability = await crm.checkServiceability(context.serviceId, context.location || {
      propertyId: context.propertyId,
      label: context.propertyLabel,
      source: 'saved_property',
    });
    if (serviceability && serviceability.serviceable === false) {
      await whatsapp.sendText(
        session.phone,
        'That location is currently outside the service area for this service. Please send another address, or type "support" for assistance.'
      );
      await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
        ...context,
        propertyId: undefined,
        propertyLabel: undefined,
        ambiguousFields: ['property'],
      }));
      return;
    }
  }
  if (context.date) {
    const datedContext = noteAvoidedQuestion(session, context, 'date', 'date_extracted');
    if ((datedContext.firstMessageFields || []).length >= 3) messageBudget.markFastPath(session.phone);
    return showAvailability(session, datedContext, datedContext.date);
  }
  await promptForDate(session, context);
}

async function promptForDate(session, context) {
  await whatsapp.sendButtons(session.phone, 'What date would you prefer? Select an option below, or enter a date in YYYY-MM-DD format.', [
    { id: 'DATE_TODAY', title: 'Today' },
    { id: 'DATE_TOMORROW', title: 'Tomorrow' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_date', withFieldDiagnostics(context));
}

async function showAvailability(session, context, date) {
  logger.audit('DATE_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_date',
    serviceId: context.serviceId,
    date,
    result: 'selected',
  });
  const slots = await crm.getAvailability(context.serviceId, date);
  const dateLabel = formatDateForCustomer(date);
  if (!slots || slots.length === 0) {
    const { date: ignoredDate, time: ignoredTime, ...retryContext } = context;
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${dateLabel}. Please select another date.`);
    await sessionStore.setFlow(session.phone, FLOW, 'select_date', retryContext);
    return;
  }
  if (slots.length === 1 && !context.correctionMode) {
    const singleSlotContext = noteAvoidedQuestion(session, context, 'time', 'single_available_slot');
    messageBudget.markFastPath(session.phone);
    return promptItemReview(session, { ...singleSlotContext, date, time: slots[0] });
  }
  const preferredSlot = selectPreferredSlot(context.preferredTime, slots);
  if (preferredSlot) {
    const preferredContext = noteAvoidedQuestion(session, context, 'time', 'time_preference_matched');
    messageBudget.markFastPath(session.phone);
    return promptItemReview(session, { ...preferredContext, date, time: preferredSlot });
  }
  const prefix = context.customerName ? `Certainly, ${context.customerName}. ` : '';
  if (slots.length <= 3) {
    await whatsapp.sendButtons(
      session.phone,
      `${prefix}Available times for ${dateLabel}. Which time works best?`,
      slots.map((slot) => ({ id: `SLOT_${slot}`, title: formatSlotForCustomer(slot) }))
    );
    await sessionStore.setFlow(session.phone, FLOW, 'select_slot', withFieldDiagnostics({ ...context, date, availableSlots: slots }));
    return;
  }
  await whatsapp.sendListMessage(session.phone, `${prefix}Available times for ${dateLabel}:`, 'Choose time', [
    { title: 'Available Times', rows: slots.slice(0, 10).map((slot) => ({
      id: `SLOT_${slot}`,
      title: formatSlotForCustomer(slot),
    })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_slot', withFieldDiagnostics({ ...context, date, availableSlots: slots }));
}

async function handleSelectDate(session, customer, input) {
  let date = null;
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (input.text) date = parseDateInput(input.ai && input.ai.preferredDate) || parseDateInput(input.text);
  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }
  await showAvailability(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    preferredTime: (input.ai && input.ai.preferredTime) || session.context.preferredTime,
  }, date);
}

async function handleSelectSlot(session, customer, input) {
  let time = input.buttonId && input.buttonId.startsWith('SLOT_')
    ? input.buttonId.replace('SLOT_', '')
    : null;
  if (!time && input.text) {
    time = selectPreferredSlot(
      (input.ai && input.ai.preferredTime) || input.text,
      session.context.availableSlots || []
    );
  }
  if (!time) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const { availableSlots, ...context } = session.context;
  await promptItemReview(session, {
    ...context,
    time,
    voiceNotes: input.voice ? [...(context.voiceNotes || []), input.voice] : context.voiceNotes,
  });
}

async function promptItemReview(session, context) {
  let serviceName = context.serviceName;
  if (!serviceName) {
    const service = await crm.getServiceDetails(context.serviceId);
    serviceName = service ? service.name : 'Service';
  }
  const currentItem = bookingItemFromContext({ ...context, serviceName });
  if (!context.correctionMode && !context.offerAdditionalService) {
    logger.audit('TIME_SELECTED', {
      phone: session.phone,
      sessionId: session.phone,
      flow: FLOW,
      step: 'select_slot',
      serviceId: currentItem.serviceId,
      time: currentItem.time,
      result: 'selected',
    });
    return promptFinalConfirmation(session, [...(context.cart || []), currentItem]);
  }
  if (context.correctionMode) {
    const correctionDebug = buildCorrectionDebug(
      context.correctionFields,
      context.correctionPreviousItem || currentItem,
      currentItem
    );
    return promptFinalConfirmation(session, [...(context.cart || []), currentItem], {
      updated: true,
      correctionDebug,
    });
  }
  const issueLine = currentItem.issue ? `\n📝 ${currentItem.issue}` : '';
  await whatsapp.sendButtons(
    session.phone,
    `Here's what I have:\n\n🔧 ${currentItem.serviceName}\n📍 ${currentItem.propertyLabel}\n📅 ${formatDateForCustomer(currentItem.date)}\n🕙 ${formatSlotForCustomer(currentItem.time)}${issueLine}\n\nWould you like to add another service or continue with this booking?`,
    [
      { id: 'ADD_ANOTHER_SERVICE', title: 'Add Another Service' },
      { id: 'PROCEED_TO_BOOKING', title: 'Proceed to Booking' },
      { id: 'CHANGE_BOOKING_DETAILS', title: 'Change Details' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'review_item', { ...context, currentItem });
  logger.audit('TIME_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_slot',
    serviceId: currentItem.serviceId,
    time: currentItem.time,
    result: 'selected',
  });
  logger.audit('BOOKING_REVIEW_SHOWN', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'review_item',
    serviceId: currentItem.serviceId,
    result: 'shown',
  });
}

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

async function promptFinalConfirmation(session, cart, options = {}) {
  const preparedCart = cart.map((item) => ({ ...item, actionId: item.actionId || randomUUID() }));
  const confirmationNonce = randomUUID();
  const suppliedDetails = preparedCart
    .map((item) => [item.room, item.issue].filter(Boolean).join(' — '))
    .filter(Boolean);
  const lines = preparedCart.map((item, index) =>
    `${preparedCart.length > 1 ? `${index + 1}. ` : ''}🔧 Service: ${item.serviceName}\n📍 Location: ${item.propertyLabel}\n📅 Date: ${formatDateForCustomer(item.date)}\n🕒 Time: ${formatSlotForCustomer(item.time)}`
  );
  await whatsapp.sendButtons(
    session.phone,
    `${options.updated ? 'Updated. Please review the booking again:' : 'Please review your booking details:'}\n\n${lines.join('\n\n')}${suppliedDetails.length ? `\n\nDetails: ${suppliedDetails.join('; ')}` : ''}\n\nWould you like me to confirm ${preparedCart.length > 1 ? 'these bookings' : 'this booking'}?`,
    [
      { id: 'CONFIRM_BOOKING', title: 'Confirm Booking' },
      { id: 'CHANGE_DETAILS', title: 'Change Details' },
      { id: 'CANCEL_FLOW', title: 'Cancel' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', withFieldDiagnostics({
    ...(preparedCart.length === 1 ? preparedCart[0] : {}),
    cart: preparedCart,
    confirmationNonce,
    correctionDebug: options.correctionDebug || null,
  }));
  logger.audit('BOOKING_REVIEW_SHOWN', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'confirm',
    serviceId: preparedCart.length === 1 ? preparedCart[0].serviceId : null,
    itemCount: preparedCart.length,
    result: 'shown',
  });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    await whatsapp.sendButtons(session.phone, 'Would you like to cancel this booking request?', [
      { id: 'CONFIRM_CANCEL_FLOW', title: 'Yes, Cancel' },
      { id: 'KEEP_BOOKING', title: 'Keep Booking' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'confirm_cancel', session.context);
    return;
  }
  if (['CHANGE_BOOKING_DETAILS', 'CHANGE_DETAILS'].includes(input.buttonId)) {
    const item = session.context.cart && session.context.cart[session.context.cart.length - 1];
    if (item) return promptChangeDetails(session, session.context.cart.slice(0, -1), item);
  }
  if (input.text) {
    const item = session.context.cart && session.context.cart[session.context.cart.length - 1];
    if (item) {
      return handleNaturalCorrection(
        session,
        customer,
        input,
        session.context.cart.slice(0, -1),
        item
      );
    }
  }
  if (input.buttonId !== 'CONFIRM_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please select Confirm Booking, Change Details, or Cancel.');
    return;
  }
  logger.audit('BOOKING_CONFIRMED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    flow: FLOW,
    step: 'confirm',
    source: 'button',
    result: 'confirmed',
  });

  const fallbackItem = {
    serviceId: session.context.serviceId,
    propertyId: session.context.propertyId,
    serviceName: session.context.serviceName,
    propertyLabel: session.context.propertyLabel,
    date: session.context.date,
    time: session.context.time,
    issue: session.context.issue,
  };
  const cart = session.context.cart && session.context.cart.length ? session.context.cart : [fallbackItem];
  const confirmationNonce = session.context.confirmationNonce || randomUUID();
  session.context.confirmationNonce = confirmationNonce;
  cart.forEach((item) => {
    if (!item.actionId) item.actionId = randomUUID();
  });
  if (cart.some((item) => !item.serviceId || !item.propertyId || !item.date || !item.time)) {
    logger.error('BOOKING', 'Missing required fields at confirm step', session.context);
    await whatsapp.sendText(session.phone, 'I\'m sorry, some booking details are missing, so I could not complete the request. Please type "menu" to start again.');
    await sessionStore.clearFlow(session.phone);
    return;
  }

  const confirmed = [];
  for (let index = 0; index < cart.length; index += 1) {
    const item = cart[index];
    const payload = {
      customerId: customer.id,
      propertyId: item.propertyId,
      serviceId: item.serviceId,
      date: item.date,
      time: item.time,
    };
    if (item.issue) payload.notes = item.issue;
    const actionKey = `booking:${customer.id}:${confirmationNonce}:${item.actionId}`;
    logger.audit('BOOKING_CREATE_REQUESTED', {
      phone: session.phone,
      customerId: customer.id,
      sessionId: session.phone,
      result: 'requested',
      serviceId: item.serviceId,
    });
    try {
      const { value: booking, duplicate } = await executeOnce(actionKey, () => crm.createBooking(payload));
      if (duplicate) {
        logger.audit('BOOKING_DUPLICATE_BLOCKED', {
          phone: session.phone,
          customerId: customer.id,
          sessionId: session.phone,
          result: 'existing_result_returned',
          bookingReference: booking.reference,
        });
      }
      if (!duplicate) {
        logger.audit('BOOKING_CREATED', {
          phone: session.phone,
          customerId: customer.id,
          sessionId: session.phone,
          result: 'success',
          bookingReference: booking.reference,
          bookingId: booking.id,
          serviceId: item.serviceId,
        });
      }
      let serviceName = item.serviceName;
      if (!serviceName) {
        const service = await crm.getServiceDetails(item.serviceId);
        serviceName = service ? service.name : 'Service';
      }
      confirmed.push({ ...booking, serviceName, requestedDate: item.date, requestedTime: item.time });
    } catch (err) {
      logger.error('BOOKING', 'createBooking failed:', err.message);
      logger.audit(err.duplicateBlocked ? 'BOOKING_DUPLICATE_BLOCKED' : 'BOOKING_CREATE_FAILED', {
        phone: session.phone,
        customerId: customer.id,
        sessionId: session.phone,
        result: err.uncertain ? 'uncertain' : 'failed',
        reason: err.code || err.message,
        serviceId: item.serviceId,
      });
      if (err.uncertain) {
        let escalated = false;
        if (!err.duplicateBlocked) {
          try {
            await triggerEscalation({
              crm,
              phone: session.phone,
              customerId: customer.id,
              customer,
              session,
              reason: 'booking_creation_uncertain',
              summary: 'A booking creation request timed out. Please verify the CRM before retrying.',
              booking: item,
              originalCustomerMessage: item.issue,
              suggestedNextAction: 'Verify whether the booking was created before attempting another booking submission.',
            });
            escalated = true;
          } catch (escalationError) {
            logger.error('BOOKING', 'Uncertain booking escalation failed:', escalationError.message);
          }
        }
        const message = err.duplicateBlocked
          ? 'Your booking request is already being checked. Please wait for our support team before trying again.'
          : `I'm sorry, I could not verify whether the booking was completed. I have kept your details and ${escalated ? 'asked our support team to check the request' : 'recommend contacting support before trying again'} so that a duplicate booking is not created.`;
        await whatsapp.sendText(session.phone, message);
        return;
      }
      if (confirmed.length === 0) {
        await whatsapp.sendText(session.phone, "I'm sorry, I couldn't confirm your booking because of a system error. Your booking details are still saved, so you can try Confirm Booking again.");
      } else {
        await sessionStore.setFlow(session.phone, FLOW, 'confirm', { cart: cart.slice(index), confirmationNonce });
        const references = confirmed.map((booking) => booking.reference).join(', ');
        await whatsapp.sendText(session.phone, `I confirmed ${confirmed.length} service${confirmed.length > 1 ? 's' : ''} (${references}), but I could not confirm the remaining service${cart.length - index > 1 ? 's' : ''}. The remaining details are still saved; please try again or type "support".`);
      }
      return;
    }
  }

  await sessionStore.clearFlow(session.phone);
  logger.audit('CONVERSATION_COMPLETED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    flow: FLOW,
    outcome: 'booking_created',
    count: confirmed.length,
    result: 'completed',
  });
  const summaries = confirmed.map((booking) =>
    `Reference: *${booking.reference}*\nService: ${booking.serviceName}\nDate: ${formatDateForCustomer(booking.scheduledDate || booking.requestedDate)}\nTime: ${formatSlotForCustomer(booking.scheduledTime || booking.requestedTime)}`
  );
  await whatsapp.sendText(
    session.phone,
    `Your booking${confirmed.length > 1 ? 's are' : ' is'} confirmed ✅\n\n${summaries.join('\n\n')}\n\nWe'll keep you updated here on WhatsApp. If you need to make changes, simply message me.`
  );
  const messageCount = messageBudget.complete(session.phone);
  logger.audit('BOOKING_CUSTOMER_TURNS', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    turns: messageCount.customerMessages,
    result: 'completed',
  });
  logger.audit('BOOKING_BOT_TURNS', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    turns: messageCount.botMessages,
    result: 'completed',
  });
  logger.audit('BOOKING_MESSAGES_TO_COMPLETE', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    botMessages: messageCount.botMessages,
    customerMessages: messageCount.customerMessages,
    totalMessages: messageCount.botMessages + messageCount.customerMessages,
    fieldsExtractedFirstMessage: messageCount.fieldsExtractedFirstMessage,
    redundantQuestionsAvoided: messageCount.redundantQuestionsAvoided,
    withinFourBotMessages: messageCount.botMessages <= 4,
    fastPathUsed: messageCount.fastPathUsed,
    result: 'completed',
  });
}

async function handleConfirmCancel(session, customer, input) {
  if (input.buttonId === 'CONFIRM_CANCEL_FLOW') {
    logger.audit('BOOKING_CANCELLED_BEFORE_CREATION', {
      phone: session.phone, sessionId: session.phone, customerId: customer.id,
      flow: FLOW, step: 'confirm_cancel', source: 'button', result: 'cancelled',
    });
    logger.audit('BOOKING_ABANDONED', {
      phone: session.phone, sessionId: session.phone, customerId: customer.id,
      flow: FLOW, step: 'confirm_cancel', reason: 'explicit_cancellation', result: 'abandoned',
    });
    await sessionStore.clearFlow(session.phone);
    messageBudget.reset(session.phone);
    await whatsapp.sendText(session.phone, 'Your booking request has been cancelled. No booking was created. Type "menu" whenever you would like to start again.');
    return;
  }
  if (input.buttonId === 'KEEP_BOOKING') {
    return promptFinalConfirmation(session, session.context.cart || []);
  }
  await whatsapp.sendText(session.phone, 'Please select Yes, Cancel or Keep Booking.');
}

module.exports = {
  startBooking,
  steps: {
    select_service: handleSelectService,
    recommendation_location: handleRecommendationLocation,
    confirm_service: handleConfirmService,
    select_property: handleSelectProperty,
    confirm_default_property: handleConfirmDefaultProperty,
    awaiting_new_property: handleAwaitingNewProperty,
    select_date: handleSelectDate,
    select_slot: handleSelectSlot,
    review_item: handleReviewItem,
    change_details: handleChangeDetails,
    change_more: handleMoreChanges,
    confirm: handleConfirm,
    confirm_cancel: handleConfirmCancel,
  },
};
