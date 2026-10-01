const db = require('../db/supabaseClient');
const env = require('../config/env');
const logger = require('../utils/logger');
const { aggregateChatbotAnalytics, rangeBounds } = require('./dashboardAggregator');

const PAGE_SIZE = 1000;
const MAX_EVENTS = 25000;
const EVENT_COLUMNS = [
  'event_type', 'occurred_at', 'flow', 'step', 'service_id', 'language', 'metadata',
].join(',');

function safeLogValue(value, fallback = 'none') {
  const normalized = String(value || fallback).replace(/[\r\n]/g, ' ').slice(0, 300);
  return normalized || fallback;
}

function supabaseErrorDetails(error) {
  const body = error && error.response && error.response.data;
  return {
    status: error && error.response ? error.response.status : null,
    code: body && typeof body === 'object' ? body.code || null : error && error.code,
    message: body && typeof body === 'object' ? body.message || error.message : error && error.message,
  };
}

function logStageFailure(stage, error, level = 'error') {
  const details = supabaseErrorDetails(error);
  logger[level](
    'CHATBOT_ANALYTICS',
    `stage=${stage}`,
    `supabaseStatus=${safeLogValue(details.status)}`,
    `supabaseCode=${safeLogValue(details.code)}`,
    `message=${safeLogValue(details.message, 'Unknown dependency error')}`
  );
  return details;
}

function dependencyError(stage, error) {
  const details = logStageFailure(stage, error);
  const wrapped = new Error('Chatbot analytics datastore is unavailable.');
  wrapped.code = 'CHATBOT_ANALYTICS_DATASTORE_UNAVAILABLE';
  wrapped.statusCode = 503;
  wrapped.stage = stage;
  wrapped.isDependencyError = true;
  wrapped.supabaseStatus = details.status;
  wrapped.supabaseCode = details.code;
  wrapped.supabaseMessage = details.message;
  return wrapped;
}

function eventQuery(bounds, limit, offset) {
  return [
    `select=${EVENT_COLUMNS}`,
    `occurred_at=gte.${encodeURIComponent(bounds.from)}`,
    `occurred_at=lte.${encodeURIComponent(bounds.to)}`,
    'order=occurred_at.asc',
    `limit=${limit}`,
    `offset=${offset}`,
  ].join('&');
}

async function loadEvents(bounds) {
  const events = [];
  try {
    while (events.length < MAX_EVENTS) {
      const limit = Math.min(PAGE_SIZE, MAX_EVENTS - events.length);
      const page = await db.get('chatbot_analytics_events', eventQuery(bounds, limit, events.length));
      if (!Array.isArray(page)) throw Object.assign(new Error('Supabase returned a non-array analytics response.'), { code: 'INVALID_DATASTORE_RESPONSE' });
      events.push(...page);
      if (page.length < limit) return { events, truncated: false };
    }
    const overflow = await db.get('chatbot_analytics_events', eventQuery(bounds, 1, MAX_EVENTS));
    if (!Array.isArray(overflow)) throw Object.assign(new Error('Supabase returned a non-array analytics response.'), { code: 'INVALID_DATASTORE_RESPONSE' });
    return { events, truncated: overflow.length > 0 };
  } catch (error) {
    throw dependencyError('event_query', error);
  }
}

async function loadServices() {
  try {
    const services = await db.get('services', 'select=id,name&order=name.asc&limit=1000');
    if (!Array.isArray(services)) throw Object.assign(new Error('Supabase returned a non-array services response.'), { code: 'INVALID_DATASTORE_RESPONSE' });
    return { services, warning: null };
  } catch (error) {
    logStageFailure('service_resolution', error, 'warn');
    return {
      services: [],
      warning: 'Service names are temporarily unavailable; service totals remain included.',
    };
  }
}

async function getChatbotAnalytics(range = '7d', now = new Date()) {
  if (!env.SUPABASE_SERVICE_ROLE_CONFIGURED) {
    const error = Object.assign(new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.'), {
      code: 'SUPABASE_SERVICE_ROLE_KEY_MISSING',
    });
    throw dependencyError('configuration', error);
  }
  const bounds = rangeBounds(range, now);
  const { events, truncated } = await loadEvents(bounds);
  const { services, warning } = await loadServices();
  try {
    const analytics = aggregateChatbotAnalytics(events, services, { range, now, truncated });
    if (warning) analytics.warnings.push(warning);
    return analytics;
  } catch (error) {
    error.stage = 'aggregation';
    throw error;
  }
}

module.exports = {
  getChatbotAnalytics,
  loadEvents,
  loadServices,
  eventQuery,
  supabaseErrorDetails,
  MAX_EVENTS,
  PAGE_SIZE,
};
