const VALID_RANGES = new Set(['today', '7d', '30d', '90d']);

const FUNNEL_EVENTS = [
  ['BOOKING_STARTED', 'Booking started'],
  ['SERVICE_SELECTED', 'Service selected'],
  ['DATE_SELECTED', 'Date selected'],
  ['TIME_SELECTED', 'Time selected'],
  ['BOOKING_REVIEW_SHOWN', 'Review shown'],
  ['BOOKING_CREATED', 'Booking created'],
];

const ERROR_EVENTS = [
  ['CRM_READ_ERROR', 'CRM read'],
  ['CRM_WRITE_ERROR', 'CRM write'],
  ['WHATSAPP_SEND_ERROR', 'WhatsApp send'],
  ['AI_ERROR', 'AI provider'],
  ['AI_PROVIDER_ERROR', 'AI provider'],
  ['MEDIA_DOWNLOAD_ERROR', 'Media download'],
  ['TRANSCRIPTION_ERROR', 'Transcription'],
  ['SESSION_ERROR', 'Session'],
];

function rangeBounds(range = '7d', nowValue = new Date()) {
  if (!VALID_RANGES.has(range)) throw Object.assign(new Error('Unsupported analytics range'), { code: 'INVALID_RANGE' });
  const to = new Date(nowValue);
  const from = new Date(to);
  from.setUTCHours(0, 0, 0, 0);
  if (range !== 'today') from.setUTCDate(from.getUTCDate() - ({ '7d': 6, '30d': 29, '90d': 89 }[range]));
  return { range, from: from.toISOString(), to: to.toISOString() };
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function metadata(event) {
  return event && event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata
    : {};
}

function countByType(events) {
  const counts = new Map();
  for (const event of events) counts.set(event.event_type, (counts.get(event.event_type) || 0) + 1);
  return counts;
}

function countOf(counts, type) {
  return counts.get(type) || 0;
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
}

function percentile(values, quantile) {
  const valid = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (valid.length < 5) return null;
  const index = Math.ceil(quantile * valid.length) - 1;
  return valid[Math.max(0, Math.min(index, valid.length - 1))];
}

function latencySummary(events, types) {
  const values = events
    .filter((event) => types.includes(event.event_type))
    .map((event) => metadata(event).latencyMs)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    samples: values.length,
    averageMs: average(values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function breakdown(events, picker, total = events.length) {
  const counts = new Map();
  for (const event of events) {
    const value = picker(event);
    if (value === undefined || value === null || value === '') continue;
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, rate: safeRatio(count, total) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function buildTrend(events, type, bounds) {
  const hourly = bounds.range === 'today';
  const start = new Date(bounds.from);
  const end = new Date(bounds.to);
  const buckets = new Map();
  const cursor = new Date(start);

  while (cursor <= end) {
    const key = hourly ? cursor.toISOString().slice(0, 13) : cursor.toISOString().slice(0, 10);
    const label = hourly ? `${String(cursor.getUTCHours()).padStart(2, '0')}:00` : key;
    buckets.set(key, { label, count: 0 });
    if (hourly) cursor.setUTCHours(cursor.getUTCHours() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const event of events) {
    if (event.event_type !== type) continue;
    const key = hourly ? String(event.occurred_at).slice(0, 13) : String(event.occurred_at).slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.count += 1;
  }
  return [...buckets.values()];
}

function buildAiTrend(events, bounds) {
  const requests = buildTrend(events, 'AI_INTENT_REQUESTED', bounds);
  const fallbacks = buildTrend(events, 'AI_FALLBACK_USED', bounds);
  return requests.map((entry, index) => ({
    label: entry.label,
    requests: entry.count,
    fallbacks: fallbacks[index] ? fallbacks[index].count : 0,
  }));
}

function normalizeStep(event) {
  const raw = event.step || metadata(event).lastStep || metadata(event).previousStep || 'unknown';
  const aliases = {
    select_service: 'Service selection',
    confirm_service: 'Service confirmation',
    select_property: 'Address',
    awaiting_new_property: 'Address',
    confirm_default_property: 'Address',
    select_date: 'Date',
    select_slot: 'Time',
    review_item: 'Review',
    confirm: 'Review',
    confirm_cancel: 'Review',
    unknown: 'Unknown step',
  };
  return aliases[raw] || String(raw).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function languageLabel(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  if (['en', 'en-us', 'en-gb'].includes(normalized)) return 'English';
  if (['ml', 'ml-in'].includes(normalized)) return 'Malayalam';
  if (normalized === 'ml-latn' || normalized.includes('manglish')) return 'Manglish';
  if (['hi', 'hi-in'].includes(normalized)) return 'Hindi';
  if (normalized === 'hi-latn' || normalized.includes('hinglish')) return 'Hinglish';
  return normalized === 'unknown' ? 'Unknown' : normalized.toUpperCase();
}

function aggregateChatbotAnalytics(events = [], services = [], options = {}) {
  const bounds = rangeBounds(options.range || '7d', options.now || new Date());
  const fromMs = new Date(bounds.from).getTime();
  const toMs = new Date(bounds.to).getTime();
  const scoped = events.filter((event) => {
    const time = new Date(event.occurred_at).getTime();
    return Number.isFinite(time) && time >= fromMs && time <= toMs;
  });
  const counts = countByType(scoped);
  const count = (type) => countOf(counts, type);

  const conversations = count('CONVERSATION_STARTED');
  const bookingsStarted = count('BOOKING_STARTED');
  const bookingsCreated = count('BOOKING_CREATED');
  const bookingsAbandoned = count('BOOKING_ABANDONED');
  const complaintsCreated = count('COMPLAINT_CREATED');
  const handoffsRequested = count('HANDOFF_REQUESTED');
  const handoffsCreated = count('HANDOFF_CREATED');
  const handoffsFailed = count('HANDOFF_FAILED');
  const aiRequested = count('AI_INTENT_REQUESTED');
  const aiResolved = count('AI_INTENT_RESOLVED');
  const aiFallbacks = count('AI_FALLBACK_USED');
  const aiErrors = count('AI_ERROR') + count('AI_PROVIDER_ERROR');
  const aiTimeouts = count('AI_TIMEOUT');
  const voiceReceived = count('VOICE_RECEIVED');
  const voiceTranscribed = count('VOICE_TRANSCRIBED');
  const voiceFailed = count('VOICE_TRANSCRIPTION_FAILED');
  const customersIdentified = count('CUSTOMER_IDENTIFIED');
  const returningCustomers = count('RETURNING_CUSTOMER_IDENTIFIED');
  const ratingEvents = scoped.filter((event) => event.event_type === 'FEEDBACK_RATING_RECEIVED');
  const ratings = ratingEvents.map((event) => Number(metadata(event).rating)).filter((rating) => rating >= 1 && rating <= 5);
  const lowRatings = ratings.filter((rating) => rating <= 3).length;
  const bookingMessageEvents = scoped.filter((event) => event.event_type === 'BOOKING_MESSAGES_TO_COMPLETE');
  const botTurns = bookingMessageEvents.map((event) => Number(metadata(event).botMessages)).filter(Number.isFinite);
  const customerTurns = bookingMessageEvents.map((event) => Number(metadata(event).customerMessages)).filter(Number.isFinite);
  const totalTurns = bookingMessageEvents.map((event) => Number(metadata(event).totalMessages)).filter(Number.isFinite);
  const firstMessageFields = bookingMessageEvents
    .map((event) => Number(metadata(event).fieldsExtractedFirstMessage))
    .filter(Number.isFinite);
  const redundantQuestionsAvoided = bookingMessageEvents.reduce(
    (total, event) => total + (Number(metadata(event).redundantQuestionsAvoided) || 0),
    0
  );
  const withinFourBotMessages = bookingMessageEvents.filter((event) => metadata(event).withinFourBotMessages === true).length;
  const fastPathBookings = bookingMessageEvents.filter((event) => metadata(event).fastPathUsed === true).length;

  const serviceNames = new Map(services.map((service) => [service.id, service.name]));
  const selectedServices = scoped.filter((event) => event.event_type === 'SERVICE_SELECTED' && event.service_id);
  const servicesSelected = breakdown(selectedServices, (event) => serviceNames.get(event.service_id) || 'Unavailable service');

  const complaintEvents = scoped.filter((event) => event.event_type === 'COMPLAINT_CREATED');
  const complaintStarts = count('COMPLAINT_STARTED');
  const complaintHandoffs = scoped.filter((event) => event.event_type === 'HANDOFF_CREATED' && event.flow === 'complaint').length;
  const handoffEvents = scoped.filter((event) => event.event_type === 'HANDOFF_CREATED');
  const languageBase = scoped.filter((event) => event.event_type === 'CONVERSATION_STARTED' && event.language);
  const voiceLanguageEvents = scoped.filter((event) => event.event_type === 'VOICE_TRANSCRIBED');

  const errorMap = new Map();
  for (const [type, label] of ERROR_EVENTS) {
    const value = count(type);
    if (value) errorMap.set(label, (errorMap.get(label) || 0) + value);
  }
  const errors = [...errorMap.entries()].map(([label, value]) => ({ label, count: value })).sort((a, b) => b.count - a.count);

  const funnel = FUNNEL_EVENTS.map(([eventType, label]) => ({
    eventType,
    label,
    count: count(eventType),
    rate: safeRatio(count(eventType), bookingsStarted),
  }));

  const ratingDistribution = [1, 2, 3, 4, 5].map((rating) => ({
    label: `${rating} star${rating === 1 ? '' : 's'}`,
    rating,
    count: ratings.filter((value) => value === rating).length,
  }));

  const kpis = {
    conversations,
    bookingsStarted,
    bookingsCreated,
    bookingConversionRate: safeRatio(bookingsCreated, bookingsStarted),
    bookingAbandonmentRate: safeRatio(bookingsAbandoned, bookingsStarted),
    complaintsCreated,
    handoffRate: safeRatio(handoffsCreated, conversations),
    aiFallbackRate: safeRatio(aiFallbacks, aiRequested),
    voiceUsageRate: safeRatio(voiceReceived, conversations),
    returningCustomerRate: safeRatio(returningCustomers, customersIdentified),
    averageCsat: average(ratings),
    lowRatingRate: safeRatio(lowRatings, ratings.length),
    averageBotMessagesPerBooking: average(botTurns),
    averageCustomerMessagesPerBooking: average(customerTurns),
    averageTotalTurnsPerBooking: average(totalTurns),
    bookingsWithinFourBotMessagesRate: safeRatio(withinFourBotMessages, bookingMessageEvents.length),
    fastPathBookingRate: safeRatio(fastPathBookings, bookingMessageEvents.length),
  };

  const summary = conversations === 0
    ? 'No chatbot activity was recorded in this period.'
    : `In this period, ${(kpis.bookingConversionRate * 100).toFixed(0)}% of booking journeys produced a booking. ${bookingsAbandoned ? `The highest recorded abandonment point was ${breakdown(scoped.filter((event) => event.event_type === 'BOOKING_ABANDONED'), normalizeStep)[0]?.label || 'unknown'}. ` : ''}Human handoff occurred in ${(kpis.handoffRate * 100).toFixed(0)}% of conversations.`;

  return {
    range: bounds.range,
    period: { from: bounds.from, to: bounds.to },
    generatedAt: new Date(options.now || new Date()).toISOString(),
    truncated: !!options.truncated,
    warnings: options.truncated ? ['The event limit was reached. Narrow the date range for complete results.'] : [],
    totals: { events: scoped.length },
    kpis,
    conversationTrend: buildTrend(scoped, 'CONVERSATION_STARTED', bounds),
    funnel,
    abandonment: breakdown(scoped.filter((event) => event.event_type === 'BOOKING_ABANDONED'), normalizeStep),
    services: servicesSelected.slice(0, 10),
    complaints: {
      created: complaintsCreated,
      categories: breakdown(complaintEvents, (event) => metadata(event).category),
      complaintToBookingRate: safeRatio(complaintsCreated, bookingsCreated),
      handoffRate: safeRatio(complaintHandoffs, complaintStarts),
      mediaUsageRate: safeRatio(count('COMPLAINT_MEDIA_RECEIVED'), complaintStarts),
    },
    handoff: {
      requested: handoffsRequested,
      created: handoffsCreated,
      failed: handoffsFailed,
      successRate: safeRatio(handoffsCreated, handoffsRequested),
      reasons: breakdown(handoffEvents, (event) => metadata(event).reason),
      priorities: breakdown(handoffEvents, (event) => metadata(event).priority),
      flows: breakdown(handoffEvents, (event) => event.flow || 'unknown'),
    },
    ai: {
      requested: aiRequested,
      resolved: aiResolved,
      lowConfidence: count('AI_LOW_CONFIDENCE'),
      fallbacks: aiFallbacks,
      errors: aiErrors,
      timeouts: aiTimeouts,
      fallbackRate: safeRatio(aiFallbacks, aiRequested),
      errorRate: safeRatio(aiErrors + aiTimeouts, aiRequested),
      averageLatencyMs: latencySummary(scoped, ['AI_INTENT_RESOLVED']).averageMs,
      trend: buildAiTrend(scoped, bounds),
    },
    voice: {
      received: voiceReceived,
      transcribed: voiceTranscribed,
      failed: voiceFailed,
      successRate: safeRatio(voiceTranscribed, voiceReceived),
      averageLatencyMs: latencySummary(scoped, ['VOICE_TRANSCRIBED']).averageMs,
      languages: breakdown(voiceLanguageEvents, (event) => languageLabel(metadata(event).detectedLanguage)),
    },
    languages: breakdown(languageBase, (event) => languageLabel(event.language)),
    customerType: {
      identified: customersIdentified,
      returning: returningCustomers,
      new: Math.max(0, customersIdentified - returningCustomers),
      returningRate: safeRatio(returningCustomers, customersIdentified),
      method: 'event_based',
    },
    messageEfficiency: {
      successfulBookingsMeasured: bookingMessageEvents.length,
      averageBotMessagesPerBooking: average(botTurns),
      averageCustomerMessagesPerBooking: average(customerTurns),
      averageTotalTurnsPerBooking: average(totalTurns),
      averageFieldsExtractedFromFirstMessage: average(firstMessageFields),
      bookingsWithinFourBotMessages: withinFourBotMessages,
      bookingsWithinFourBotMessagesRate: safeRatio(withinFourBotMessages, bookingMessageEvents.length),
      redundantQuestionsAvoided,
      fastPathBookings,
      fastPathBookingRate: safeRatio(fastPathBookings, bookingMessageEvents.length),
    },
    csat: {
      responses: ratings.length,
      average: average(ratings),
      lowRatings,
      lowRatingRate: safeRatio(lowRatings, ratings.length),
      completed: count('FEEDBACK_COMPLETED'),
      reviewOffers: count('FEEDBACK_REVIEW_OFFERED'),
      distribution: ratingDistribution,
    },
    latency: {
      ai: latencySummary(scoped, ['AI_INTENT_RESOLVED']),
      crmRead: latencySummary(scoped, ['CRM_READ_COMPLETED', 'CRM_READ_ERROR']),
      crmWrite: latencySummary(scoped, ['CRM_WRITE_COMPLETED', 'CRM_WRITE_ERROR']),
      whatsapp: latencySummary(scoped, ['WHATSAPP_SEND_COMPLETED', 'WHATSAPP_SEND_ERROR']),
      voice: latencySummary(scoped, ['VOICE_TRANSCRIBED']),
      route: latencySummary(scoped, ['ROUTE_COMPLETED']),
    },
    errors,
    summary,
  };
}

module.exports = {
  VALID_RANGES,
  aggregateChatbotAnalytics,
  rangeBounds,
  safeRatio,
};
