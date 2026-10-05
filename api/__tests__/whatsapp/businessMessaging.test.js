import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axios = require('axios');
const db = require('../../db/supabaseClient');
const { normalizeInboundMessages, parseWebhookBody } = require('../../whatsapp/parseInbound');
const whatsapp = require('../../whatsapp/client');
const { isWithinServiceWindow } = require('../../whatsapp/serviceWindow');
const testChannel = require('../../whatsapp/testChannel');
const sessionStore = require('../../session/sessionStore');

describe('WhatsApp profile name', () => {
  it('attaches each sender\'s profile name to their messages', () => {
    const { messages } = parseWebhookBody({
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '919910992795', profile: { name: ' Lal Sebastian ' } }],
        messages: [
          { from: '919910992795', id: 'w1', timestamp: '1', type: 'text', text: { body: 'hi' } },
          { from: '971500000000', id: 'w2', timestamp: '2', type: 'text', text: { body: 'hello' } },
        ],
      } }] }],
    });
    expect(messages[0]).toMatchObject({ from: '919910992795', profileName: 'Lal Sebastian' });
    expect(messages[1]).not.toHaveProperty('profileName');
  });
});

describe('webhook body parsing', () => {
  it('returns an empty list for status-only callbacks and malformed bodies', () => {
    expect(normalizeInboundMessages({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] })).toEqual([]);
    expect(normalizeInboundMessages(null)).toEqual([]);
    expect(normalizeInboundMessages({ entry: 'nope' })).toEqual([]);
  });

  it('skips non-message webhook fields and reports why', () => {
    const { messages, ignored } = parseWebhookBody({
      entry: [{ changes: [{ field: 'account_update', value: { messages: [{ id: 'x', from: '1', type: 'text', text: { body: 'hi' } }] } }] }],
    });
    expect(messages).toEqual([]);
    expect(ignored).toEqual([{ reason: 'unsupported_field' }]);
  });
});

describe('template messages', () => {
  let postSpy;
  const originalInsert = db.insert;

  beforeEach(() => {
    postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
    db.insert = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    postSpy.mockRestore();
    db.insert = originalInsert;
  });

  it('sends body parameters and quick-reply payloads in the Cloud API format', async () => {
    await whatsapp.sendTemplate('971500', {
      name: 'feedback_request_v1',
      language: 'en',
      bodyParams: ['Aisha', ''],
      quickReplyPayloads: ['RATING_5', 'RATING_4'],
      summary: 'How was your AC Service?',
    });

    expect(postSpy.mock.calls[0][1]).toEqual({
      messaging_product: 'whatsapp',
      to: '971500',
      type: 'template',
      template: {
        name: 'feedback_request_v1',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Aisha' }, { type: 'text', text: '-' }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'RATING_5' }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'RATING_4' }] },
        ],
      },
    });
    expect(db.insert).toHaveBeenCalledWith('messages', expect.objectContaining({ type: 'template', content: 'How was your AC Service?' }), expect.anything());
  });

  it('is captured (never sent) inside the developer test console', async () => {
    const { messages } = await testChannel.withCapture(() => whatsapp.sendTemplate('971500', { name: 'booking_assigned_v1', quickReplyPayloads: [] }));
    expect(postSpy).not.toHaveBeenCalled();
    expect(messages[0]).toMatchObject({ type: 'template', template: 'booking_assigned_v1' });
  });
});

describe('24-hour customer-service window', () => {
  const originalGet = db.get;
  afterEach(() => { db.get = originalGet; });

  it('is open within 24 hours of the last inbound message and closed after', async () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    db.get = vi.fn()
      .mockResolvedValueOnce([{ created_at: '2026-10-03T13:00:00Z' }])
      .mockResolvedValueOnce([{ created_at: '2026-10-03T11:00:00Z' }])
      .mockResolvedValueOnce([]);
    await expect(isWithinServiceWindow('971500', now)).resolves.toBe(true);
    await expect(isWithinServiceWindow('971500', now)).resolves.toBe(false);
    await expect(isWithinServiceWindow('971500', now)).resolves.toBe(false); // never messaged
    expect(db.get.mock.calls[0][1]).toContain('direction=eq.inbound');
  });

  it('closes slightly early so a message is not sent just as the window ends', async () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    db.get = vi.fn().mockResolvedValue([{ created_at: '2026-10-03T12:02:00Z' }]);
    await expect(isWithinServiceWindow('971500', now)).resolves.toBe(false);
  });

  it('reports "unknown" rather than guessing when the log cannot be read', async () => {
    db.get = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(isWithinServiceWindow('971500')).resolves.toBeNull();
  });
});

describe('session expiry for business-initiated prompts', () => {
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

  it('expires a normal flow after the default inactivity window', () => {
    expect(sessionStore.isExpired({ currentFlow: 'booking', currentStep: 'select_date', context: {}, lastActivityAt: minutesAgo(120) })).toBe(true);
  });

  it('keeps a feedback request answerable for its own, longer window', () => {
    const session = { currentFlow: 'feedback', currentStep: 'select_rating', context: { flowTtlMinutes: 72 * 60 }, lastActivityAt: minutesAgo(600) };
    expect(sessionStore.isExpired(session)).toBe(false);
    expect(sessionStore.isExpired({ ...session, lastActivityAt: minutesAgo(73 * 60) })).toBe(true);
  });
});
