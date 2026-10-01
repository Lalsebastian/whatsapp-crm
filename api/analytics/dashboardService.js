const db = require('../db/supabaseClient');
const { aggregateChatbotAnalytics, rangeBounds } = require('./dashboardAggregator');

const PAGE_SIZE = 1000;
const MAX_EVENTS = 25000;
const EVENT_COLUMNS = [
  'event_type', 'occurred_at', 'session_id', 'flow', 'step', 'service_id',
  'booking_id', 'complaint_id', 'feedback_id', 'language', 'source', 'metadata',
].join(',');

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
  while (events.length < MAX_EVENTS) {
    const limit = Math.min(PAGE_SIZE, MAX_EVENTS - events.length);
    const page = await db.get('chatbot_analytics_events', eventQuery(bounds, limit, events.length));
    events.push(...(page || []));
    if (!page || page.length < limit) return { events, truncated: false };
  }
  const overflow = await db.get('chatbot_analytics_events', eventQuery(bounds, 1, MAX_EVENTS));
  return { events, truncated: !!(overflow && overflow.length) };
}

async function loadServices() {
  return (await db.get('services', 'select=id,name&order=name.asc&limit=1000')) || [];
}

async function getChatbotAnalytics(range = '7d', now = new Date()) {
  const bounds = rangeBounds(range, now);
  const [{ events, truncated }, services] = await Promise.all([loadEvents(bounds), loadServices()]);
  return aggregateChatbotAnalytics(events, services, { range, now, truncated });
}

module.exports = { getChatbotAnalytics, loadEvents, eventQuery, MAX_EVENTS, PAGE_SIZE };
