import { describe, it, expect, vi } from 'vitest';

const { wrapCrmAdapter } = require('../../crm/reliableCrmAdapter');

function options(overrides = {}) {
  return { timeoutMs: 15, maxReadRetries: 0, retryBaseDelayMs: 1, ...overrides };
}

describe('reliable CRM adapter', () => {
  it('times out a hung CRM read', async () => {
    const adapter = { getServices: vi.fn(() => new Promise(() => {})) };
    const crm = wrapCrmAdapter(adapter, options());

    await expect(crm.getServices()).rejects.toMatchObject({
      code: 'OPERATION_TIMEOUT',
      uncertain: false,
    });
  });

  it('retries a transient read with exponential-backoff policy', async () => {
    const transient = Object.assign(new Error('unavailable'), { response: { status: 503 } });
    const adapter = { getServices: vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce([{ id: 'svc1' }]) };
    const crm = wrapCrmAdapter(adapter, options({ maxReadRetries: 1 }));

    await expect(crm.getServices()).resolves.toEqual([{ id: 'svc1' }]);
    expect(adapter.getServices).toHaveBeenCalledTimes(2);
  });

  it('does not retry a transient write and marks a write timeout as uncertain', async () => {
    const transient = Object.assign(new Error('unavailable'), { response: { status: 503 } });
    const failedAdapter = { createBooking: vi.fn().mockRejectedValue(transient) };
    const failedCrm = wrapCrmAdapter(failedAdapter, options({ maxReadRetries: 3 }));

    await expect(failedCrm.createBooking({})).rejects.toBe(transient);
    expect(transient.uncertain).toBe(true);
    expect(failedAdapter.createBooking).toHaveBeenCalledTimes(1);

    const hungAdapter = { createBooking: vi.fn(() => new Promise(() => {})) };
    const hungCrm = wrapCrmAdapter(hungAdapter, options());
    await expect(hungCrm.createBooking({})).rejects.toMatchObject({
      code: 'OPERATION_TIMEOUT',
      uncertain: true,
    });
    expect(hungAdapter.createBooking).toHaveBeenCalledTimes(1);
  });
});
