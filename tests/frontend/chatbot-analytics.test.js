import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analyticsContentState, formatLatency } from '../../src/lib/chatbot-analytics.js';

const require = createRequire(import.meta.url);
const { aggregateChatbotAnalytics, rangeBounds, safeRatio } = require('../../api/analytics/dashboardAggregator.js');
const NOW = new Date('2026-09-30T12:00:00.000Z');

for (const [range, expected] of [['today', '2026-09-30'], ['7d', '2026-09-24'], ['30d', '2026-09-01'], ['90d', '2026-07-03']]) {
  test(`${range} chatbot analytics starts on ${expected} and excludes the future`, () => {
    const bounds = rangeBounds(range, NOW);
    assert.equal(bounds.from.slice(0, 10), expected);
    assert.equal(bounds.to, NOW.toISOString());
  });
}

test('zero denominators never produce NaN or Infinity', () => {
  const result = aggregateChatbotAnalytics([], [], { range: '7d', now: NOW });
  assert.equal(safeRatio(1, 0), 0);
  assert.equal(result.kpis.bookingConversionRate, 0);
  assert.equal(result.kpis.bookingAbandonmentRate, 0);
  assert.equal(result.kpis.aiFallbackRate, 0);
  assert.equal(result.kpis.voiceUsageRate, 0);
  assert.equal(result.kpis.handoffRate, 0);
  assert.equal(result.kpis.averageCsat, null);
  assert.equal(JSON.stringify(result).includes('NaN'), false);
});

test('calculates booking, abandonment, CSAT, AI, voice and handoff metrics', () => {
  const at = '2026-09-29T10:00:00.000Z';
  const event = (event_type, extra = {}) => ({ event_type, occurred_at: at, metadata: {}, ...extra });
  const events = [
    event('CONVERSATION_STARTED'), event('CONVERSATION_STARTED'),
    event('BOOKING_STARTED'), event('BOOKING_STARTED'), event('BOOKING_CREATED'),
    event('BOOKING_ABANDONED', { step: 'select_slot' }),
    event('SERVICE_SELECTED', { service_id: 'service-1' }),
    event('AI_INTENT_REQUESTED'), event('AI_INTENT_REQUESTED'), event('AI_FALLBACK_USED'),
    event('VOICE_RECEIVED'), event('HANDOFF_CREATED'),
    event('CUSTOMER_IDENTIFIED'), event('CUSTOMER_IDENTIFIED'), event('RETURNING_CUSTOMER_IDENTIFIED'),
    event('FEEDBACK_RATING_RECEIVED', { metadata: { rating: 5 } }),
    event('FEEDBACK_RATING_RECEIVED', { metadata: { rating: 2 } }),
  ];
  const result = aggregateChatbotAnalytics(events, [{ id: 'service-1', name: 'AC Repair' }], { range: '7d', now: NOW });

  assert.equal(result.kpis.bookingConversionRate, 0.5);
  assert.equal(result.kpis.bookingAbandonmentRate, 0.5);
  assert.equal(result.abandonment[0].label, 'Time');
  assert.equal(result.kpis.averageCsat, 3.5);
  assert.equal(result.kpis.lowRatingRate, 0.5);
  assert.equal(result.kpis.aiFallbackRate, 0.5);
  assert.equal(result.kpis.voiceUsageRate, 0.5);
  assert.equal(result.kpis.handoffRate, 0.5);
  assert.equal(result.kpis.returningCustomerRate, 0.5);
  assert.deepEqual(result.services[0], { label: 'AC Repair', count: 1, rate: 1 });
});

test('maps empty and failed API results to explicit UI states', () => {
  assert.equal(analyticsContentState({ hasCredential: false }), 'locked');
  assert.equal(analyticsContentState({ hasCredential: true, isLoading: true }), 'loading');
  assert.equal(analyticsContentState({ hasCredential: true, error: new Error('network') }), 'error');
  assert.equal(analyticsContentState({ hasCredential: true, data: { totals: { events: 0 } } }), 'empty');
  assert.equal(analyticsContentState({ hasCredential: true, data: { totals: { events: 1 } } }), 'ready');
  assert.equal(formatLatency(undefined), '—');
});
