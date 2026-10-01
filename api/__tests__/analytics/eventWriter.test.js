import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = require('../../db/supabaseClient');
db.upsert = vi.fn();
const env = require('../../config/env');
const analytics = require('../../analytics/eventWriter');
const lifecycle = require('../../analytics/conversationLifecycle');

const originalNodeEnv = env.NODE_ENV;
const originalSalt = env.ANALYTICS_HASH_SALT;

describe('analytics event writer', () => {
  beforeEach(() => {
    db.upsert.mockReset().mockResolvedValue([]);
    analytics.clearTestEvents();
    lifecycle.clearForTests();
    env.ANALYTICS_HASH_SALT = 'test-only-stable-salt';
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.ANALYTICS_HASH_SALT = originalSalt;
    vi.restoreAllMocks();
  });

  it('normalizes events with a stable phone hash and strips private text fields', () => {
    const row = analytics.normalizeEvent('PROPERTY_SELECTED', {
      phone: '971500000000', customerId: 'customer-1', propertyId: 'property-1',
      address: 'Villa 12, Private Street', transcript: 'private voice text',
      metadata: { comment: 'private feedback', category: 'plumbing' },
    });

    expect(row.phone_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain('971500000000');
    expect(JSON.stringify(row)).not.toContain('Private Street');
    expect(JSON.stringify(row)).not.toContain('private voice text');
    expect(JSON.stringify(row)).not.toContain('private feedback');
    expect(row.metadata.propertyId).toBe('property-1');
  });

  it('stores efficiency counts and field names without message bodies, transcripts, or addresses', () => {
    const row = analytics.normalizeEvent('FIELDS_EXTRACTED_FROM_MESSAGE', {
      phone: '971500000000',
      fields: ['service', 'property', 'date', 'time'],
      fieldCount: 4,
      customerMessage: 'Need a plumber at Villa 12 tomorrow',
      transcript: 'private voice transcript',
      address: 'Villa 12, Private Street',
    });

    expect(row.metadata).toMatchObject({ fields: ['service', 'property', 'date', 'time'], fieldCount: 4 });
    expect(JSON.stringify(row)).not.toContain('Need a plumber');
    expect(JSON.stringify(row)).not.toContain('private voice transcript');
    expect(JSON.stringify(row)).not.toContain('Private Street');
  });

  it('never throws into the chatbot when storage fails', async () => {
    env.NODE_ENV = 'production';
    db.upsert.mockRejectedValue(new Error('analytics table unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(analytics.trackEvent('BOOKING_STARTED', { phone: '971500' }))
      .resolves.toMatchObject({ stored: false });
  });

  it('uses the same dedupe key for the same critical event and correlation ID', async () => {
    env.NODE_ENV = 'production';
    await analytics.trackEvent('BOOKING_CREATED', {
      phone: '971500', correlationId: 'wamid-1', bookingId: 'booking-1',
    });
    await analytics.trackEvent('BOOKING_CREATED', {
      phone: '971500', correlationId: 'wamid-1', bookingId: 'booking-1',
    });

    expect(db.upsert).toHaveBeenCalledTimes(2);
    expect(db.upsert.mock.calls[0][1].dedupe_key).toBe(db.upsert.mock.calls[1][1].dedupe_key);
    expect(db.upsert).toHaveBeenCalledWith(
      'chatbot_analytics_events', expect.any(Object), { onConflict: 'dedupe_key' }
    );
  });

  it('distinguishes a new conversation from a resumed active session', () => {
    expect(lifecycle.noteActivity({ phone: '971500', currentFlow: null, currentStep: null }))
      .toBe('CONVERSATION_STARTED');
    lifecycle.clearForTests();
    expect(lifecycle.noteActivity({ phone: '971500', currentFlow: 'booking', currentStep: 'select_date' }))
      .toBe('CONVERSATION_RESUMED');
  });
});
