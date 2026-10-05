import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = require('../../db/supabaseClient');
db.get = vi.fn();
db.patch = vi.fn();

const coordination = require('../../reliability/coordinationStore');
coordination.tryAcquireLease = vi.fn();

const serviceWindow = require('../../whatsapp/serviceWindow');
serviceWindow.isWithinServiceWindow = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();

const env = require('../../config/env');
const { runSlaCheckOnce, REASSURANCE } = require('../../escalation/slaMonitor');

const NOW = Date.parse('2031-01-01T12:00:00Z');
const minutesAgo = (value) => new Date(NOW - value * 60000).toISOString();
const row = (overrides = {}) => ({ id: 'esc-1', phone: '971500', priority: 'normal', created_at: minutesAgo(10), sla_breached_at: null, customer_notified_at: null, ...overrides });

describe('escalation SLA monitor', () => {
  beforeEach(() => {
    env.CRM_PROVIDER = 'supabase';
    db.get.mockReset();
    db.patch.mockReset().mockResolvedValue([{ id: 'esc-1' }]);
    coordination.tryAcquireLease.mockReset().mockResolvedValue(true);
    serviceWindow.isWithinServiceWindow.mockReset().mockResolvedValue(true);
    whatsapp.sendText.mockReset().mockResolvedValue({});
  });

  it('leaves escalations inside their threshold alone', async () => {
    db.get.mockResolvedValue([row({ priority: 'urgent', created_at: minutesAgo(10) }), row({ id: 'esc-2', created_at: minutesAgo(100) })]);
    expect(await runSlaCheckOnce(NOW)).toEqual({ checked: 2, breached: 0 });
    expect(db.patch).not.toHaveBeenCalled();
  });

  it('raises a breached escalation one level, once, and reassures the customer without promising a time', async () => {
    db.get.mockResolvedValue([row({ priority: 'high', created_at: minutesAgo(45) })]);
    expect(await runSlaCheckOnce(NOW)).toEqual({ checked: 1, breached: 1 });

    expect(db.patch).toHaveBeenNthCalledWith(1, 'escalations', 'id=eq.esc-1&sla_breached_at=is.null', expect.objectContaining({ priority: 'urgent' }));
    expect(db.patch).toHaveBeenNthCalledWith(2, 'escalations', 'id=eq.esc-1&customer_notified_at=is.null', expect.any(Object));
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', REASSURANCE);
    expect(REASSURANCE).not.toMatch(/\d+\s*(?:min|hour)/i);
  });

  it('does not message twice when another instance already claimed the reassurance', async () => {
    db.get.mockResolvedValue([row({ created_at: minutesAgo(200) })]);
    db.patch.mockResolvedValueOnce([{ id: 'esc-1' }]).mockResolvedValueOnce([]);
    await runSlaCheckOnce(NOW);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('never messages outside the WhatsApp service window', async () => {
    db.get.mockResolvedValue([row({ created_at: minutesAgo(200), sla_breached_at: minutesAgo(5) })]);
    serviceWindow.isWithinServiceWindow.mockResolvedValue(false);
    await runSlaCheckOnce(NOW);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('stays silent if the tracking column is missing (cannot remember it reassured)', async () => {
    db.get.mockResolvedValue([row({ created_at: minutesAgo(200), sla_breached_at: minutesAgo(5) })]);
    db.patch.mockRejectedValue(new Error('column customer_notified_at does not exist'));
    await runSlaCheckOnce(NOW);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('runs on one instance only, and only for the bundled CRM', async () => {
    coordination.tryAcquireLease.mockResolvedValue(false);
    expect(await runSlaCheckOnce(NOW)).toEqual({ skipped: 'other_instance' });
    env.CRM_PROVIDER = 'http';
    expect(await runSlaCheckOnce(NOW)).toEqual({ skipped: 'external_crm' });
    expect(db.get).not.toHaveBeenCalled();
  });
});
