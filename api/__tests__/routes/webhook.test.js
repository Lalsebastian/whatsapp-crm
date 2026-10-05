// Exercises POST/GET /webhook through the real Express app (createApp), so
// raw-body capture, signature verification and parsing are tested exactly as
// deployed. The conversation pipeline itself is replaced with a spy.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const request = require('supertest');
const env = require('../../config/env');
const { computeSignature } = require('../../utils/signature');
const conversationRouter = require('../../router/conversationRouter');
conversationRouter.handleInboundMessage = vi.fn();
const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
const { createApp } = require('../../app');

const SECRET = 'meta-app-secret-for-tests';
const original = {
  secret: env.WHATSAPP_APP_SECRET,
  nodeEnv: env.NODE_ENV,
  phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  verifyToken: env.WHATSAPP_VERIFY_TOKEN,
};

const app = createApp();

function textMessage(id, from, body, timestamp = '1700000000') {
  return { id, from, timestamp, type: 'text', text: { body } };
}

function delivery(messages, { phoneNumberId = 'PN-1', statuses } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '971400000000', phone_number_id: phoneNumberId },
          ...(messages ? { messages } : {}),
          ...(statuses ? { statuses } : {}),
        },
      }],
    }],
  };
}

function signedPost(payload, secret = SECRET) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', `sha256=${computeSignature(secret, Buffer.from(raw))}`)
    .send(raw);
}

async function settle() {
  // Processing happens after the 200 ack; let it run.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('WhatsApp webhook route', () => {
  beforeEach(() => {
    env.WHATSAPP_APP_SECRET = SECRET;
    env.NODE_ENV = 'test';
    env.WHATSAPP_PHONE_NUMBER_ID = 'PN-1';
    env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    conversationRouter.handleInboundMessage.mockReset();
    conversationRouter.handleInboundMessage.mockResolvedValue({});
    whatsapp.sendText.mockReset();
  });

  afterAll(() => {
    env.WHATSAPP_APP_SECRET = original.secret;
    env.NODE_ENV = original.nodeEnv;
    env.WHATSAPP_PHONE_NUMBER_ID = original.phoneNumberId;
    env.WHATSAPP_VERIFY_TOKEN = original.verifyToken;
  });

  describe('signature verification', () => {
    it('accepts a correctly signed delivery and processes the message', async () => {
      const response = await signedPost(delivery([textMessage('wamid.1', '971500', 'hi')]));
      await settle();

      expect(response.status).toBe(200);
      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledTimes(1);
      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledWith(expect.objectContaining({
        from: '971500', waMessageId: 'wamid.1', type: 'text', text: 'hi',
      }));
    });

    it('rejects a delivery with no signature header', async () => {
      const response = await request(app).post('/webhook').send(delivery([textMessage('wamid.2', '971500', 'hi')]));
      await settle();

      expect(response.status).toBe(401);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('rejects a delivery signed with the wrong secret', async () => {
      const response = await signedPost(delivery([textMessage('wamid.3', '971500', 'hi')]), 'attacker-secret');
      await settle();

      expect(response.status).toBe(401);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('rejects a body that was altered after signing', async () => {
      const original = JSON.stringify(delivery([textMessage('wamid.4', '971500', 'book a cleaning')]));
      const tampered = original.replace('book a cleaning', 'cancel everything');
      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${computeSignature(SECRET, Buffer.from(original))}`)
        .send(tampered);
      await settle();

      expect(response.status).toBe(401);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('rejects a malformed signature header without throwing', async () => {
      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha256=not-hex')
        .send(JSON.stringify(delivery([textMessage('wamid.5', '971500', 'hi')])));

      expect(response.status).toBe(401);
    });

    it('fails closed in production when the app secret is not configured', async () => {
      env.WHATSAPP_APP_SECRET = '';
      env.NODE_ENV = 'production';
      const response = await request(app).post('/webhook').send(delivery([textMessage('wamid.6', '971500', 'hi')]));
      await settle();

      expect(response.status).toBe(503);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('allows unsigned deliveries outside production only when no secret is configured', async () => {
      env.WHATSAPP_APP_SECRET = '';
      env.NODE_ENV = 'development';
      const response = await request(app).post('/webhook').send(delivery([textMessage('wamid.7', '971500', 'hi')]));
      await settle();

      expect(response.status).toBe(200);
      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('delivery contents', () => {
    it('processes every message when Meta batches several in one call', async () => {
      const response = await signedPost(delivery([
        textMessage('wamid.a', '971500', 'first', '1700000001'),
        textMessage('wamid.b', '971511', 'other customer', '1700000002'),
        textMessage('wamid.c', '971500', 'second', '1700000003'),
      ]));
      await settle();

      expect(response.status).toBe(200);
      expect(conversationRouter.handleInboundMessage.mock.calls.map(([inbound]) => inbound.waMessageId))
        .toEqual(['wamid.a', 'wamid.b', 'wamid.c']);
    });

    it('processes messages spread across several entries and changes', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          delivery([textMessage('wamid.e1', '971500', 'one', '1700000010')]).entry[0],
          delivery([textMessage('wamid.e2', '971522', 'two', '1700000011')]).entry[0],
        ],
      };
      await signedPost(payload);
      await settle();

      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledTimes(2);
    });

    it('queues one customer\'s batched messages in the order they were sent', async () => {
      await signedPost(delivery([
        textMessage('wamid.late', '971500', 'later', '1700000020'),
        textMessage('wamid.early', '971500', 'earlier', '1700000019'),
      ]));
      await settle();

      expect(conversationRouter.handleInboundMessage.mock.calls.map(([inbound]) => inbound.waMessageId))
        .toEqual(['wamid.early', 'wamid.late']);
    });

    it('keeps processing the rest of the batch when one message fails', async () => {
      conversationRouter.handleInboundMessage
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({});
      await signedPost(delivery([
        textMessage('wamid.f1', '971500', 'fails', '1700000030'),
        textMessage('wamid.f2', '971533', 'works', '1700000031'),
      ]));
      await settle();
      await settle();

      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledTimes(2);
      expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('try again'));
    });

    it('acknowledges status-only callbacks (sent/delivered/read) without processing anything', async () => {
      const response = await signedPost(delivery(null, {
        statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1700000040', recipient_id: '971500' }],
      }));
      await settle();

      expect(response.status).toBe(200);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('ignores messages addressed to a different business phone number on the same app', async () => {
      const response = await signedPost(delivery([textMessage('wamid.other', '971500', 'hi')], { phoneNumberId: 'PN-OTHER' }));
      await settle();

      expect(response.status).toBe(200);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('routes a template quick-reply tap like an interactive button', async () => {
      await signedPost(delivery([{
        id: 'wamid.tpl', from: '971500', timestamp: '1700000050', type: 'button',
        button: { payload: 'RATING_5', text: 'Excellent' },
      }]));
      await settle();

      expect(conversationRouter.handleInboundMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'interactive', buttonId: 'RATING_5', source: 'template_button',
      }));
    });

    it('returns 400 for malformed JSON without invoking the pipeline', async () => {
      const raw = '{"entry": [';
      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${computeSignature(SECRET, Buffer.from(raw))}`)
        .send(raw);

      expect(response.status).toBe(400);
      expect(conversationRouter.handleInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('verification handshake', () => {
    it('echoes the challenge for the configured verify token', async () => {
      const response = await request(app)
        .get('/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' });
      expect(response.status).toBe(200);
      expect(response.text).toBe('12345');
    });

    it('refuses a wrong verify token', async () => {
      const response = await request(app)
        .get('/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
      expect(response.status).toBe(403);
    });

    it('refuses verification when no verify token is configured', async () => {
      env.WHATSAPP_VERIFY_TOKEN = undefined;
      const response = await request(app)
        .get('/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.challenge': '12345' });
      expect(response.status).toBe(403);
    });
  });
});
