import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const express = require('express');
const env = require('../../config/env');
const conversationRouter = require('../../router/conversationRouter');
conversationRouter.handleInboundMessage = vi.fn();

const whatsapp = require('../../whatsapp/client');
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
      return { intent: null, flow: 'main_menu', step: null };
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
      intent: null,
      flow: 'main_menu',
      step: null,
      options: [
        { id: 'BOOK_SERVICE', title: 'Book a Service' },
        { id: 'MY_BOOKINGS', title: 'My Bookings' },
        { id: 'MORE_OPTIONS', title: 'More Options' },
      ],
    });
  });
});
