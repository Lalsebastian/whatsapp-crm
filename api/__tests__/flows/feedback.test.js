import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.getBookingById = vi.fn();
fakeCrm.getBookings = vi.fn();
fakeCrm.getServiceDetails = vi.fn();
fakeCrm.getFeedbackForBooking = vi.fn();
fakeCrm.createFeedback = vi.fn();
fakeCrm.getOpenComplaintForBooking = vi.fn();
fakeCrm.markFeedbackFollowUp = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();
sessionStore.updateSession = vi.fn();

const escalation = require('../../escalation/escalationService');
escalation.triggerEscalation = vi.fn();

const actionGuard = require('../../reliability/actionGuard');
const analytics = require('../../analytics/eventWriter');
const env = require('../../config/env');
const feedback = require('../../flows/feedback');

const originalReviewsEnabled = env.REVIEWS_ENABLED;
const originalReviewUrl = env.PUBLIC_REVIEW_URL;
const originalReviewMinRating = env.REVIEW_MIN_RATING;

const customer = { id: 'customer-1', name: 'Amina' };
const booking = {
  id: 'booking-1', reference: 'BK-100', customerId: customer.id,
  serviceId: 'service-1', status: 'completed', scheduledDate: '2026-09-29',
};

function session(context = {}) {
  return { phone: '971500000000', preferredLanguage: 'en', context };
}

function feedbackContext(overrides = {}) {
  return {
    booking,
    service: { id: 'service-1', name: 'AC Repair' },
    rating: 5,
    requestNonce: 'nonce-1',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    fakeCrm.getBookingById, fakeCrm.getBookings, fakeCrm.getServiceDetails,
    fakeCrm.getFeedbackForBooking, fakeCrm.createFeedback, fakeCrm.getOpenComplaintForBooking,
    fakeCrm.markFeedbackFollowUp, whatsapp.sendText, whatsapp.sendButtons,
    whatsapp.sendListMessage, sessionStore.setFlow, sessionStore.clearFlow,
    sessionStore.updateSession, escalation.triggerEscalation,
  ]) fn.mockReset();
  fakeCrm.getServiceDetails.mockResolvedValue({ id: 'service-1', name: 'AC Repair' });
  fakeCrm.getFeedbackForBooking.mockResolvedValue(null);
  fakeCrm.getOpenComplaintForBooking.mockResolvedValue(null);
  fakeCrm.createFeedback.mockResolvedValue({ id: 'feedback-1', rating: 5 });
  actionGuard.clearForTests();
  analytics.clearTestEvents();
  env.REVIEWS_ENABLED = false;
  env.PUBLIC_REVIEW_URL = '';
  env.REVIEW_MIN_RATING = 4;
});

afterEach(() => {
  env.REVIEWS_ENABLED = originalReviewsEnabled;
  env.PUBLIC_REVIEW_URL = originalReviewUrl;
  env.REVIEW_MIN_RATING = originalReviewMinRating;
});

describe('feedback flow eligibility and rating UX', () => {
  it('starts feedback for a valid completed booking owned by the customer', async () => {
    fakeCrm.getBookingById.mockResolvedValue(booking);
    await feedback.startFeedbackForBooking({ session: session(), customer, bookingId: booking.id });

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500000000',
      expect.stringContaining('AC Repair'),
      [
        { id: 'RATING_5', title: 'Excellent' },
        { id: 'RATING_4', title: 'Good' },
        { id: 'RATING_MORE', title: 'More Ratings' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500000000', 'feedback', 'select_rating', expect.objectContaining({ booking })
    );
  });

  it('rejects an invalid or differently owned booking', async () => {
    fakeCrm.getBookingById.mockResolvedValue({ ...booking, customerId: 'other-customer' });
    const result = await feedback.startFeedbackForBooking({ session: session(), customer, bookingId: booking.id });
    expect(result).toMatchObject({ started: false, reason: 'invalid_booking' });
    expect(sessionStore.setFlow).not.toHaveBeenCalled();
  });

  it('does not request feedback for a cancelled booking even with explicit test initiation', async () => {
    fakeCrm.getBookingById.mockResolvedValue({ ...booking, status: 'cancelled' });
    const result = await feedback.startFeedbackForBooking({
      session: session(), customer, bookingId: booking.id, allowUnverifiedCompletion: true,
    });
    expect(result.reason).toBe('cancelled_booking');
  });

  it('exposes a completion hook that starts only for a completed booking event', async () => {
    fakeCrm.getBookingById.mockResolvedValue(booking);
    const result = await feedback.onBookingCompleted({ session: session(), customer, booking });
    expect(result.started).toBe(true);

    const ignored = await feedback.onBookingCompleted({
      session: session(), customer, booking: { ...booking, status: 'in_progress' },
    });
    expect(ignored).toEqual({ started: false, reason: 'not_completed' });
  });

  it.each([
    ['RATING_5', 5], ['RATING_4', 4], ['RATING_3', 3], ['RATING_2', 2], ['RATING_1', 1],
  ])('normalizes %s to rating %i', async (buttonId, rating) => {
    await feedback.steps.select_rating(session(feedbackContext({ rating: undefined })), customer, { buttonId });
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500000000', 'feedback', 'awaiting_comment', expect.objectContaining({ rating })
    );
    expect(analytics.getTestEvents('971500000000').map((event) => event.eventType))
      .toContain('FEEDBACK_RATING_RECEIVED');
  });

  it.each([
    ['excellent', 5], ['very good', 5], ['good', 4], ['average', 3], ['not good', 2], ['poor', 2], ['terrible service', 1],
  ])('deterministically interprets typed rating "%s" as %i', (text, expected) => {
    expect(feedback.parseRating({ text })).toBe(expected);
  });

  it('uses the same path for a transcribed voice rating', async () => {
    await feedback.steps.select_rating(session(feedbackContext({ rating: undefined })), customer, {
      text: 'excellent', source: 'voice', voice: { transcript: 'excellent' },
    });
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500000000', 'feedback', 'awaiting_comment', expect.objectContaining({ rating: 5, ratingSource: 'voice' })
    );
  });

  it('does not invent a numeric rating from unrelated positive prose', async () => {
    await feedback.steps.select_rating(session(feedbackContext({ rating: undefined })), customer, {
      text: 'The technician was professional and explained everything clearly',
    });
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500000000', 'feedback', 'select_rating', expect.objectContaining({ preRatingComment: expect.any(String) })
    );
  });
});

describe('feedback persistence and customer outcome', () => {
  it('stores an optional comment and completes positive feedback', async () => {
    await feedback.steps.awaiting_comment(session(feedbackContext()), customer, { text: 'Very professional technician.' });
    expect(fakeCrm.createFeedback).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: booking.id, customerId: customer.id, rating: 5, comment: 'Very professional technician.',
    }));
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining('pleased to hear'));
  });

  it('offers only the configured public review URL when policy allows it', async () => {
    env.REVIEWS_ENABLED = true;
    env.PUBLIC_REVIEW_URL = 'https://example.com/review';
    env.REVIEW_MIN_RATING = 4;
    await feedback.steps.awaiting_comment(session(feedbackContext({ rating: 4 })), customer, { buttonId: 'NO_COMMENT' });
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining('https://example.com/review'));
  });

  it('does not fabricate a review link when none is configured', async () => {
    env.REVIEWS_ENABLED = true;
    await feedback.steps.awaiting_comment(session(feedbackContext()), customer, { buttonId: 'NO_COMMENT' });
    expect(whatsapp.sendText.mock.calls.some(([, text]) => /https?:\/\//.test(text))).toBe(false);
  });

  it('prevents duplicate feedback when the CRM already has a response', async () => {
    fakeCrm.getFeedbackForBooking.mockResolvedValue({ id: 'existing', rating: 5 });
    await feedback.steps.awaiting_comment(session(feedbackContext()), customer, { buttonId: 'NO_COMMENT' });
    expect(fakeCrm.createFeedback).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining('already received'));
  });

  it('uses the existing duplicate message when the adapter resolves a unique-constraint race', async () => {
    fakeCrm.createFeedback.mockResolvedValue({
      id: 'winner', rating: 5, comment: 'Original', duplicate: true,
      persistenceStatus: 'existing_completed',
    });
    await feedback.steps.awaiting_comment(session(feedbackContext()), customer, { buttonId: 'NO_COMMENT' });
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500000000',
      "Thank you — we've already received your feedback for this service."
    );
    expect(whatsapp.sendText).not.toHaveBeenCalledWith('971500000000', expect.stringContaining('pleased to hear'));
  });

  it('uses a customer/booking action key to make concurrent submissions idempotent before the unique constraint exists', async () => {
    const first = session(feedbackContext({ requestNonce: 'nonce-a' }));
    const second = session(feedbackContext({ requestNonce: 'nonce-b' }));
    await Promise.all([
      feedback.steps.awaiting_comment(first, customer, { buttonId: 'NO_COMMENT' }),
      feedback.steps.awaiting_comment(second, customer, { buttonId: 'NO_COMMENT' }),
    ]);
    expect(fakeCrm.createFeedback).toHaveBeenCalledTimes(1);
  });

  it('does not claim success when the CRM write fails', async () => {
    fakeCrm.createFeedback.mockRejectedValue(new Error('database unavailable'));
    await feedback.steps.awaiting_comment(session(feedbackContext()), customer, { buttonId: 'NO_COMMENT' });
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining("wasn't able to save"));
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
  });
});

describe('low-rating service recovery', () => {
  it('offers service recovery after an average rating with a comment', async () => {
    fakeCrm.createFeedback.mockResolvedValue({ id: 'feedback-3', rating: 3 });
    await feedback.steps.awaiting_comment(
      session(feedbackContext({ rating: 3 })), customer, { text: 'The technician was late.' }
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500000000', 'feedback', 'low_rating_followup', expect.objectContaining({ followUpRequired: true })
    );
  });

  it('links feedback to an existing open complaint instead of creating a duplicate', async () => {
    fakeCrm.createFeedback.mockResolvedValue({ id: 'feedback-2', rating: 2 });
    fakeCrm.getOpenComplaintForBooking.mockResolvedValue({ id: 'complaint-1', reference: 'CM-100' });
    await feedback.steps.awaiting_comment(
      session(feedbackContext({ rating: 2 })), customer, { text: 'The work was not finished.' }
    );
    expect(fakeCrm.markFeedbackFollowUp).toHaveBeenCalledWith('feedback-2', { complaintId: 'complaint-1' });
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining('CM-100'));
  });

  it('creates a professional handoff for serious poor feedback', async () => {
    fakeCrm.createFeedback.mockResolvedValue({ id: 'feedback-1', rating: 1 });
    escalation.triggerEscalation.mockResolvedValue({ id: 'escalation-1', priority: 'HIGH' });
    await feedback.steps.awaiting_comment(
      session(feedbackContext({ rating: 1 })), customer, { text: 'The technician damaged my wall.' }
    );
    expect(escalation.triggerEscalation).toHaveBeenCalledWith(expect.objectContaining({
      feedback: expect.objectContaining({ rating: 1 }),
      booking: expect.objectContaining({ id: booking.id }),
    }));
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining("won't need to repeat"));
  });

  it('truthfully reports when service recovery handoff fails after feedback was stored', async () => {
    fakeCrm.createFeedback.mockResolvedValue({ id: 'feedback-1', rating: 1 });
    escalation.triggerEscalation.mockRejectedValue(new Error('handoff unavailable'));
    await feedback.steps.awaiting_comment(
      session(feedbackContext({ rating: 1 })), customer, { text: 'There was a payment dispute.' }
    );
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500000000', expect.stringContaining("wasn't able to connect"));
  });
});
