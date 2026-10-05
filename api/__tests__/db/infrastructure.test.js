// Session store, PostgREST client and the health/readiness endpoints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axios = require('axios');
const request = require('supertest');
const env = require('../../config/env');
const db = require('../../db/supabaseClient');

describe('PostgREST client', () => {
  const original = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, adapter: axios.defaults.adapter };
  let transport;

  beforeEach(() => {
    env.SUPABASE_URL = 'https://project.supabase.co';
    env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    // supabaseClient calls axios(config) directly, so intercept at the
    // transport layer: no network, but the real request config is built.
    transport = vi.fn(async (config) => ({ data: true, status: 200, statusText: 'OK', headers: {}, config }));
    axios.defaults.adapter = transport;
  });

  afterEach(() => {
    env.SUPABASE_URL = original.url;
    env.SUPABASE_SERVICE_ROLE_KEY = original.key;
    axios.defaults.adapter = original.adapter;
  });

  it('calls database functions through /rpc with the service-role key', async () => {
    await expect(db.rpc('chatbot_try_lock', { p_key: 'k' })).resolves.toBe(true);
    const config = transport.mock.calls[0][0];
    expect(config.url).toBe('https://project.supabase.co/rest/v1/rpc/chatbot_try_lock');
    expect(config.method).toBe('post');
    expect(config.headers.Authorization).toBe('Bearer service-role-key');
    expect(JSON.parse(config.data)).toEqual({ p_key: 'k' });
  });

  it('sends a filtered DELETE with minimal return', async () => {
    await db.remove('chatbot_crm_events', 'event_id=eq.e1');
    const config = transport.mock.calls[0][0];
    expect(config.method).toBe('delete');
    expect(config.url).toBe('https://project.supabase.co/rest/v1/chatbot_crm_events?event_id=eq.e1');
    expect(config.headers.Prefer).toBe('return=minimal');
  });

  it('refuses an unfiltered DELETE', async () => {
    await expect(db.remove('messages', '')).rejects.toThrow('without a filter');
  });

  it('recognises missing functions and columns from PostgREST error codes', () => {
    const error = (code) => ({ response: { data: { code } } });
    expect(db.isMissingFunction(error('PGRST202'))).toBe(true);
    expect(db.isMissingFunction(error('23505'))).toBe(false);
    expect(db.isMissingColumn(error('PGRST204'))).toBe(true);
    expect(db.isMissingColumn({})).toBe(false);
  });
});

describe('session store', () => {
  const originals = { get: db.get, upsert: db.upsert, patch: db.patch };
  const sessionStore = require('../../session/sessionStore');

  beforeEach(() => {
    db.get = vi.fn();
    db.upsert = vi.fn();
    db.patch = vi.fn();
  });

  afterEach(() => Object.assign(db, originals));

  it('maps an existing session row', async () => {
    db.get.mockResolvedValue([{
      phone: '971500', customer_id: 'c1', current_flow: 'booking', current_step: 'select_date',
      context: { serviceId: 's1' }, preferred_language: 'en', human_takeover: false, last_activity_at: '2026-10-04T10:00:00Z',
    }]);
    await expect(sessionStore.getOrCreateSession('971500')).resolves.toEqual({
      phone: '971500', customerId: 'c1', currentFlow: 'booking', currentStep: 'select_date',
      context: { serviceId: 's1' }, preferredLanguage: 'en', humanTakeover: false, lastActivityAt: '2026-10-04T10:00:00Z',
    });
    expect(db.get.mock.calls[0][1]).toContain('phone=eq.971500');
  });

  it('creates a session on first contact', async () => {
    db.get.mockResolvedValue([]);
    db.upsert.mockResolvedValue([{ phone: '971500', context: {} }]);
    const session = await sessionStore.getOrCreateSession('971500');
    expect(session).toMatchObject({ phone: '971500', currentFlow: null, humanTakeover: false });
    expect(db.upsert).toHaveBeenCalledWith('sessions', expect.objectContaining({ phone: '971500', human_takeover: false }), { onConflict: 'phone' });
  });

  it('only writes the fields that changed, and encodes the phone filter', async () => {
    db.patch.mockResolvedValue([{ phone: '+971500' }]);
    await sessionStore.updateSession('+971500', { currentFlow: 'feedback', humanTakeover: true });
    const [table, filter, payload] = db.patch.mock.calls[0];
    expect(table).toBe('sessions');
    expect(filter).toBe('phone=eq.%2B971500');
    expect(Object.keys(payload).sort()).toEqual(['current_flow', 'human_takeover', 'last_activity_at']);
  });

  it('resets a test session without touching customer records', async () => {
    db.patch.mockResolvedValue([{ phone: '971500' }]);
    await sessionStore.resetSession('971500');
    expect(db.patch).toHaveBeenCalledWith('sessions', 'phone=eq.971500', expect.objectContaining({
      current_flow: null, current_step: null, context: {}, human_takeover: false,
    }));
    db.patch.mockResolvedValue([]);
    await expect(sessionStore.resetSession('unknown')).resolves.toBeNull();
  });

  it('clears a flow and toggles human takeover through updateSession', async () => {
    db.patch.mockResolvedValue([{ phone: '971500' }]);
    await sessionStore.clearFlow('971500');
    await sessionStore.setHumanTakeover('971500', true);
    await sessionStore.touchActivity('971500');
    expect(db.patch.mock.calls[0][2]).toMatchObject({ current_flow: null, current_step: null, context: {} });
    expect(db.patch.mock.calls[1][2]).toMatchObject({ human_takeover: true });
    expect(Object.keys(db.patch.mock.calls[2][2])).toEqual(['last_activity_at']);
  });
});

describe('health and readiness endpoints', () => {
  const originalGet = db.get;
  const { createApp } = require('../../app');
  const app = createApp();

  afterEach(() => { db.get = originalGet; });

  it('reports liveness without touching dependencies', async () => {
    db.get = vi.fn();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(db.get).not.toHaveBeenCalled();
  });

  it('reports ready only when the datastore answers', async () => {
    db.get = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('down'));
    expect((await request(app).get('/ready')).status).toBe(200);
    expect((await request(app).get('/ready')).status).toBe(503);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const response = await request(app).get('/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });
});
