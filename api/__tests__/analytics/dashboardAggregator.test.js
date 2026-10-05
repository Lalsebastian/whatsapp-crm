import { describe, expect, it } from 'vitest';

const { aggregateChatbotAnalytics } = require('../../analytics/dashboardAggregator');

describe('chatbot message-efficiency analytics', () => {
  it('derives successful-booking averages, <=4 rate, avoided questions, and fast-path rate', () => {
    const occurredAt = '2026-10-01T10:00:00.000Z';
    const events = [
      {
        event_type: 'BOOKING_MESSAGES_TO_COMPLETE', occurred_at: occurredAt,
        metadata: {
          botMessages: 3, customerMessages: 2, totalMessages: 5,
          fieldsExtractedFirstMessage: 5, redundantQuestionsAvoided: 3,
          withinFourBotMessages: true, fastPathUsed: true,
        },
      },
      {
        event_type: 'BOOKING_MESSAGES_TO_COMPLETE', occurred_at: occurredAt,
        metadata: {
          botMessages: 5, customerMessages: 3, totalMessages: 8,
          fieldsExtractedFirstMessage: 2, redundantQuestionsAvoided: 1,
          withinFourBotMessages: false, fastPathUsed: false,
        },
      },
    ];

    const result = aggregateChatbotAnalytics(events, [], { range: 'today', now: new Date('2026-10-01T12:00:00.000Z') });

    expect(result.messageEfficiency).toEqual({
      successfulBookingsMeasured: 2,
      averageBotMessagesPerBooking: 4,
      averageCustomerMessagesPerBooking: 2.5,
      averageTotalTurnsPerBooking: 6.5,
      averageFieldsExtractedFromFirstMessage: 3.5,
      bookingsWithinFourBotMessages: 1,
      bookingsWithinFourBotMessagesRate: 0.5,
      redundantQuestionsAvoided: 4,
      fastPathBookings: 1,
      fastPathBookingRate: 0.5,
    });
  });

  it('reports message cost per booking and complaint and the AI calls avoided', () => {
    const occurred_at = '2026-10-01T10:00:00.000Z';
    const events = [
      { event_type: 'BOOKING_COST_SUMMARY', occurred_at, metadata: { botMessages: 4, aiCalls: 0, templateMessages: 0, estimatedCost: 0, currency: 'USD' } },
      { event_type: 'BOOKING_COST_SUMMARY', occurred_at, metadata: { botMessages: 6, aiCalls: 2, templateMessages: 1, estimatedCost: 0.0163, currency: 'USD' } },
      { event_type: 'COMPLAINT_COST_SUMMARY', occurred_at, metadata: { botMessages: 5, aiCalls: 1, templateMessages: 0, estimatedCost: 0.0003, currency: 'USD' } },
      { event_type: 'AI_CALL_AVOIDED', occurred_at, metadata: {} },
      { event_type: 'AI_CALL_AVOIDED', occurred_at, metadata: {} },
      { event_type: 'AI_CALL_AVOIDED', occurred_at, metadata: {} },
      { event_type: 'AI_INTENT_REQUESTED', occurred_at, metadata: {} },
    ];

    const { cost } = aggregateChatbotAnalytics(events, [], { range: 'today', now: new Date('2026-10-01T12:00:00.000Z') });

    expect(cost).toMatchObject({
      currency: 'USD',
      bookingsMeasured: 2,
      complaintsMeasured: 1,
      averageBotMessagesPerBooking: 5,
      averageAiCallsPerBooking: 1,
      averageCostPerBooking: 0.00815,
      totalEstimatedCost: 0.0166,
      templateMessages: 1,
      aiCallsMade: 1,
      aiCallsAvoided: 3,
      aiAvoidanceRate: 0.75,
    });
  });
});
