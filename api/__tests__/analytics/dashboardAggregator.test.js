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
});
