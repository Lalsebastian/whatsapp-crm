// Pure helpers and shared constants for the booking flow. Nothing here sends
// a WhatsApp message, so every other booking module can depend on it.
const { randomUUID } = require('node:crypto');
const logger = require('../../utils/logger');
const { parseDateInput, formatSlotForCustomer } = require('../dateUtils');
const { withFieldDiagnostics } = require('../conversationFields');
const messageBudget = require('../../analytics/messageBudget');
const { getCrmAdapter } = require('../../crm');

const crm = getCrmAdapter();
const FLOW = 'booking';

const CORRECTION_FIELDS = ['service', 'property', 'date', 'time'];
// Structured slot details that travel with the selected time.
const SLOT_DETAIL_FIELDS = ['timeEnd', 'slotId', 'slotStartsAt', 'slotEndsAt', 'timezone'];

function bookingItemFromContext(context) {
  return {
    serviceId: context.serviceId,
    serviceName: context.serviceName,
    propertyId: context.propertyId,
    propertyLabel: context.propertyLabel || context.locationHint || 'Saved service address',
    date: context.date,
    time: context.time,
    ...SLOT_DETAIL_FIELDS.reduce((fields, key) => (context[key] ? { ...fields, [key]: context[key] } : fields), {}),
    room: context.room || null,
    issue: context.issue || null,
  };
}

// Customer-facing time for a booking item: the CRM's range when known
// ("9:00 AM – 11:00 AM"), otherwise the start time.
function itemTimeLabel(item) {
  if (!item || !item.time) return formatSlotForCustomer(item && item.time);
  return formatSlotForCustomer(item.timeEnd ? `${item.time}-${item.timeEnd}` : item.time);
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
    ...(fields.some((field) => ['service', 'property', 'date', 'time'].includes(field))
      ? { time: undefined, ...Object.fromEntries(SLOT_DETAIL_FIELDS.map((key) => [key, undefined])) }
      : { time: item.time }),
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

module.exports = {
  crm,
  FLOW,
  CORRECTION_FIELDS,
  bookingItemFromContext,
  itemTimeLabel,
  buildCorrectionDebug,
  correctionContext,
  propertyDisplay,
  propertyName,
  prioritizeProperties,
  matchSavedProperty,
  selectPreferredSlot,
  aiPrefill,
  extractedFieldNames,
  noteAvoidedQuestion,
  normalizedSavedLocation,
};
