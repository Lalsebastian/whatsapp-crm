import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const express = require('express');
const env = require('../../config/env');
const conversationRouter = require('../../router/conversationRouter');
conversationRouter.handleInboundMessage = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.resetSession = vi.fn();
sessionStore.getOrCreateSession = vi.fn();
const unknownStreak = require('../../router/unknownStreak');
unknownStreak.reset = vi.fn();

const whatsapp = require('../../whatsapp/client');
const feedback = require('../../flows/feedback');
feedback.startFeedbackForBooking = vi.fn();
const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.findCustomerByPhone = vi.fn();
const chatTestRoute = require('../../routes/chatTest');

const originalEnabled = env.ENABLE_TEST_CHAT;
const originalSecret = env.TEST_CHAT_SECRET;
let server;
let baseUrl;

describe('authorized test-chat endpoint', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat/test', chatTestRoute);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    env.ENABLE_TEST_CHAT = originalEnabled;
    env.TEST_CHAT_SECRET = originalSecret;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    env.ENABLE_TEST_CHAT = false;
    env.TEST_CHAT_SECRET = 'developer-secret';
    conversationRouter.handleInboundMessage.mockReset();
    sessionStore.resetSession.mockReset();
    sessionStore.getOrCreateSession.mockReset();
    feedback.startFeedbackForBooking.mockReset();
    fakeCrm.findCustomerByPhone.mockReset();
    unknownStreak.reset.mockReset();
  });

  afterEach(() => {
    env.ENABLE_TEST_CHAT = originalEnabled;
    env.TEST_CHAT_SECRET = originalSecret;
  });

  it('reports disabled status and returns a safe 404 when the feature flag is off', async () => {
    const statusResponse = await fetch(`${baseUrl}/api/chat/test/status`);
    expect(await statusResponse.json()).toEqual({ enabled: false, requiresSecret: true });

    const response = await fetch(`${baseUrl}/api/chat/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'developer-secret' },
      body: JSON.stringify({ phone: '971500000000', message: 'hi' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Test chat is disabled on this deployment.',
      code: 'TEST_CHAT_DISABLED',
    });
    expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
  });

  it('rejects an enabled request without the correct developer secret', async () => {
    env.ENABLE_TEST_CHAT = true;

    const response = await fetch(`${baseUrl}/api/chat/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'wrong-secret' },
      body: JSON.stringify({ phone: '971500000000', message: 'hi' }),
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('TEST_CHAT_UNAUTHORIZED');
    expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
  });

  it('uses the shared conversation router and returns captured button metadata when enabled', async () => {
    env.ENABLE_TEST_CHAT = true;
    conversationRouter.handleInboundMessage.mockImplementationOnce(async (inbound) => {
      await whatsapp.sendButtons(inbound.from, 'Hello from Joboy', [
        { id: 'BOOK_SERVICE', title: 'Book a Service' },
        { id: 'MY_BOOKINGS', title: 'My Bookings' },
        { id: 'MORE_OPTIONS', title: 'More Options' },
      ]);
      return {
        intent: 'NEW_BOOKING', confidence: 0.96, flow: 'booking', step: 'select_property',
        service: 'Electrical', matchSource: 'semantic_hint', serviceConfidence: 0.95,
        changedField: 'date', previousValue: '2026-10-01', newValue: '2026-10-02',
        handoff: true, priority: 'HIGH', handoffReason: 'repeat_service_failure',
      };
    });

    const statusResponse = await fetch(`${baseUrl}/api/chat/test/status`);
    expect(await statusResponse.json()).toEqual({ enabled: true, requiresSecret: true });

    const response = await fetch(`${baseUrl}/api/chat/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'developer-secret' },
      body: JSON.stringify({ phone: '971500000000', message: 'hi' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(conversationRouter.handleInboundMessage).toHaveBeenCalledWith({
      from: '971500000000', type: 'text', text: 'hi',
    });
    expect(body).toMatchObject({
      reply: 'Hello from Joboy',
      intent: 'NEW_BOOKING',
      confidence: 0.96,
      flow: 'booking',
      step: 'select_property',
      service: 'Electrical',
      matchSource: 'semantic_hint',
      serviceConfidence: 0.95,
      changedField: 'date',
      previousValue: '2026-10-01',
      newValue: '2026-10-02',
      handoff: true,
      priority: 'HIGH',
      handoffReason: 'repeat_service_failure',
      options: [
        { id: 'BOOK_SERVICE', title: 'Book a Service' },
        { id: 'MY_BOOKINGS', title: 'My Bookings' },
        { id: 'MORE_OPTIONS', title: 'More Options' },
      ],
    });
  });

  it('resets only the selected phone session with a valid secret', async () => {
    env.ENABLE_TEST_CHAT = true;
    sessionStore.resetSession.mockResolvedValue({ phone: '971500000123' });

    const response = await fetch(`${baseUrl}/api/chat/test/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'developer-secret' },
      body: JSON.stringify({ phone: '971500000123' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Test session reset.' });
    expect(sessionStore.resetSession).toHaveBeenCalledTimes(1);
    expect(sessionStore.resetSession).toHaveBeenCalledWith('971500000123');
    expect(unknownStreak.reset).toHaveBeenCalledWith('971500000123');
  });

  it('starts feedback through the protected developer action and returns feedback metadata', async () => {
    env.ENABLE_TEST_CHAT = true;
    const testSession = { phone: '971500000123', currentFlow: null, currentStep: null, context: {} };
    const feedbackSession = {
      ...testSession,
      currentFlow: 'feedback',
      currentStep: 'select_rating',
      context: { rating: null, followUpRequired: false, complaintLinked: false },
    };
    sessionStore.getOrCreateSession.mockResolvedValueOnce(testSession).mockResolvedValueOnce(feedbackSession);
    fakeCrm.findCustomerByPhone.mockResolvedValue({ id: 'customer-1', phone: testSession.phone });
    feedback.startFeedbackForBooking.mockImplementation(async ({ session: current }) => {
      await whatsapp.sendButtons(current.phone, 'How would you rate your experience?', [
        { id: 'RATING_5', title: 'Excellent' },
        { id: 'RATING_4', title: 'Good' },
        { id: 'RATING_MORE', title: 'More Ratings' },
      ]);
      return { started: true };
    });

    const response = await fetch(`${baseUrl}/api/chat/test/start-feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'developer-secret' },
      body: JSON.stringify({ phone: testSession.phone, bookingId: 'booking-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(feedback.startFeedbackForBooking).toHaveBeenCalledWith(expect.objectContaining({
      session: testSession,
      customer: expect.objectContaining({ id: 'customer-1' }),
      bookingId: 'booking-1',
      allowUnverifiedCompletion: true,
    }));
    expect(body).toMatchObject({
      intent: 'FEEDBACK', flow: 'feedback', step: 'select_rating', rating: null,
      followUpRequired: false, complaintLinked: false,
    });
  });

  it('does not reset a session with an invalid secret', async () => {
    env.ENABLE_TEST_CHAT = true;
    const response = await fetch(`${baseUrl}/api/chat/test/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'wrong-secret' },
      body: JSON.stringify({ phone: '971500000123' }),
    });

    expect(response.status).toBe(401);
    expect(sessionStore.resetSession).not.toHaveBeenCalled();
  });

  it('does not expose reset when test chat is disabled', async () => {
    const response = await fetch(`${baseUrl}/api/chat/test/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-chat-secret': 'developer-secret' },
      body: JSON.stringify({ phone: '971500000123' }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('TEST_CHAT_DISABLED');
    expect(sessionStore.resetSession).not.toHaveBeenCalled();
  });
});
