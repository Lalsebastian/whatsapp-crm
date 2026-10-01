import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = require('../../db/supabaseClient');
const env = require('../../config/env');
const dashboardService = require('../../analytics/dashboardService');

const originalServiceRoleConfigured = env.SUPABASE_SERVICE_ROLE_CONFIGURED;

function event(type, occurredAt = '2026-09-30T10:00:00.000Z', extra = {}) {
  return { event_type: type, occurred_at: occurredAt, metadata: {}, ...extra };
}

describe('chatbot analytics dashboard service', () => {
  beforeEach(() => {
    env.SUPABASE_SERVICE_ROLE_CONFIGURED = true;
    vi.spyOn(db, 'get');
  });

  afterEach(() => {
    env.SUPABASE_SERVICE_ROLE_CONFIGURED = originalServiceRoleConfigured;
    vi.restoreAllMocks();
  });

  it('requests only columns used by aggregation', () => {
    const query = dashboardService.eventQuery({
      from: '2026-09-24T00:00:00.000Z',
      to: '2026-09-30T12:00:00.000Z',
    }, 1000, 0);

    expect(query).toContain('select=event_type,occurred_at,flow,step,service_id,language,metadata');
    expect(query).not.toMatch(/session_id|booking_id|complaint_id|feedback_id|customer_id|phone_hash/);
    expect(query).toContain('limit=1000');
    expect(query).toContain('offset=0');
  });

  it('returns valid zero analytics when the event table is empty', async () => {
    db.get
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const analytics = await dashboardService.getChatbotAnalytics('7d', new Date('2026-09-30T12:00:00.000Z'));

    expect(analytics.totals.events).toBe(0);
    expect(analytics.kpis.conversations).toBe(0);
    expect(analytics.summary).toBe('No chatbot activity was recorded in this period.');
  });

  it('keeps analytics available when optional service-name resolution fails', async () => {
    db.get
      .mockResolvedValueOnce([event('SERVICE_SELECTED', undefined, { service_id: 'service-1' })])
      .mockRejectedValueOnce(Object.assign(new Error('services unavailable'), {
        response: { status: 503, data: { code: 'PGRST002', message: 'schema cache unavailable' } },
      }));

    const analytics = await dashboardService.getChatbotAnalytics('7d', new Date('2026-09-30T12:00:00.000Z'));

    expect(analytics.totals.events).toBe(1);
    expect(analytics.services).toEqual([{ label: 'Unavailable service', count: 1, rate: 1 }]);
    expect(analytics.warnings).toContain('Service names are temporarily unavailable; service totals remain included.');
  });

  it('classifies an event-table query failure as a datastore dependency error', async () => {
    db.get.mockRejectedValueOnce(Object.assign(new Error('request failed'), {
      response: { status: 403, data: { code: '42501', message: 'permission denied for table' } },
    }));

    await expect(dashboardService.getChatbotAnalytics('7d', new Date('2026-09-30T12:00:00.000Z')))
      .rejects.toMatchObject({
        statusCode: 503,
        stage: 'event_query',
        isDependencyError: true,
        supabaseStatus: 403,
        supabaseCode: '42501',
      });
  });

  it('fails clearly before querying when the service-role key is not configured', async () => {
    env.SUPABASE_SERVICE_ROLE_CONFIGURED = false;

    await expect(dashboardService.getChatbotAnalytics('7d'))
      .rejects.toMatchObject({
        statusCode: 503,
        stage: 'configuration',
        supabaseCode: 'SUPABASE_SERVICE_ROLE_KEY_MISSING',
      });
    expect(db.get).not.toHaveBeenCalled();
  });
});
