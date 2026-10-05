import { describe, it, expect, vi } from 'vitest';

const { createHttpCrmAdapter, CrmConfigurationError } = require('../../crm/httpCrmAdapter');
const { wrapCrmAdapter } = require('../../crm/reliableCrmAdapter');

function httpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

function adapterWith(handler, overrides = {}) {
  const http = { request: vi.fn(handler) };
  const adapter = createHttpCrmAdapter({
    http,
    baseUrl: 'https://crm.example.com/api/v1/',
    apiKey: 'secret-key',
    ...overrides,
  });
  return { adapter, http };
}

describe('HTTP CRM adapter', () => {
  describe('configuration', () => {
    it('refuses to run without a base URL or API key', async () => {
      const noUrl = createHttpCrmAdapter({ http: { request: vi.fn() }, baseUrl: '', apiKey: 'k' });
      const noKey = createHttpCrmAdapter({ http: { request: vi.fn() }, baseUrl: 'https://crm.example.com', apiKey: '' });
      await expect(noUrl.getServices()).rejects.toBeInstanceOf(CrmConfigurationError);
      await expect(noKey.getServices()).rejects.toMatchObject({ code: 'CRM_NOT_CONFIGURED' });
    });

    it('refuses plain http except for localhost', async () => {
      const remote = createHttpCrmAdapter({ http: { request: vi.fn() }, baseUrl: 'http://crm.example.com', apiKey: 'k' });
      await expect(remote.getServices()).rejects.toThrow('must use https');
      const { adapter, http } = adapterWith(async () => ({ data: [] }), { baseUrl: 'http://localhost:4000' });
      await adapter.getServices();
      expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://localhost:4000/services' }));
    });

    it('rejects malformed endpoint overrides', async () => {
      const bad = createHttpCrmAdapter({ http: { request: vi.fn() }, baseUrl: 'https://x.test', apiKey: 'k', endpoints: '{"nope": "/x"}' });
      await expect(bad.getServices()).rejects.toThrow('unknown method "nope"');
    });

    it('applies endpoint overrides and a custom auth header', async () => {
      const { adapter, http } = adapterWith(async () => ({ data: { bookings: [] } }), {
        endpoints: JSON.stringify({ createBookings: '/v2/jobs/bulk' }),
        authHeader: 'x-api-key',
      });
      await adapter.createBookings({ customerId: 'c1', items: [], idempotencyKey: 'k1' });
      expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://crm.example.com/api/v1/v2/jobs/bulk',
        headers: expect.objectContaining({ 'x-api-key': 'secret-key', 'Idempotency-Key': 'k1' }),
      }));
    });
  });

  describe('requests and mapping', () => {
    it('sends the API key as a bearer token and maps snake_case responses', async () => {
      const { adapter, http } = adapterWith(async () => ({
        data: { data: [{ id: 7, name: 'AC Service', base_price: 150, duration_minutes: 90 }] },
      }));
      const services = await adapter.getServices();
      expect(services).toEqual([{ id: '7', name: 'AC Service', category: null, description: null, basePrice: 150, durationMinutes: 90 }]);
      expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
        method: 'get',
        url: 'https://crm.example.com/api/v1/services',
        params: { active: true },
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }));
    });

    it('encodes path parameters', async () => {
      const { adapter, http } = adapterWith(async () => ({ data: { id: 'a/b', reference: 'BK-1' } }));
      await adapter.getBookingById('a/b');
      expect(http.request.mock.calls[0][0].url).toBe('https://crm.example.com/api/v1/bookings/a%2Fb');
    });

    it('finds an existing customer by phone without creating one', async () => {
      const { adapter, http } = adapterWith(async () => ({ data: [{ id: 'c1', phone: '971500', full_name: 'Aisha' }] }));
      await expect(adapter.findCustomerByPhone('971500')).resolves.toEqual({
        id: 'c1', phone: '971500', name: 'Aisha', preferredLanguage: null, returningCustomer: true,
      });
      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('registers a first-time WhatsApp customer and survives a concurrent registration', async () => {
      const { adapter, http } = adapterWith(async (config) => {
        if (config.method === 'post') throw httpError(409, { code: 'CUSTOMER_EXISTS' });
        return { data: http.request.mock.calls.length === 1 ? [] : [{ id: 'c2', phone: '971511' }] };
      });
      await expect(adapter.findCustomerByPhone('971511')).resolves.toMatchObject({ id: 'c2', returningCustomer: false });
    });

    it('returns null for a 404 on single-resource reads', async () => {
      const { adapter } = adapterWith(async () => { throw httpError(404); });
      await expect(adapter.getServiceDetails('missing')).resolves.toBeNull();
      await expect(adapter.getBookingById('missing')).resolves.toBeNull();
      await expect(adapter.getCustomerById('missing')).resolves.toBeNull();
    });

    it('passes availability slots through for normalization and maps date ranges', async () => {
      const { adapter, http } = adapterWith(async (config) => (config.params.date
        ? { data: { slots: [{ id: 's1', start: '09:00', end: '11:00' }] } }
        : { data: { days: [{ date: '2026-10-12', slots: ['09:00'] }] } }));
      await expect(adapter.getAvailability('svc1', '2026-10-12')).resolves.toEqual([{ id: 's1', start: '09:00', end: '11:00' }]);
      await expect(adapter.getAvailabilityRange('svc1', { fromDate: '2026-10-12', days: 7, location: { latitude: 25.1, longitude: 55.2 } }))
        .resolves.toEqual([{ date: '2026-10-12', slots: ['09:00'] }]);
      expect(http.request.mock.calls[1][0].params).toEqual({ from: '2026-10-12', days: 7, lat: 25.1, lng: 55.2 });
    });

    it('creates several bookings in one request with an idempotency key', async () => {
      const { adapter, http } = adapterWith(async () => ({
        data: { bookings: [{ id: 'b1', reference: 'BK-1' }, { id: 'b2', reference: 'BK-2' }] },
      }));
      const bookings = await adapter.createBookings({
        customerId: 'c1',
        idempotencyKey: 'wa-nonce',
        items: [{ serviceId: 's1' }, { serviceId: 's2' }],
      });
      expect(bookings.map((b) => b.reference)).toEqual(['BK-1', 'BK-2']);
      expect(http.request).toHaveBeenCalledTimes(1);
      expect(http.request.mock.calls[0][0]).toMatchObject({
        method: 'post',
        data: { customerId: 'c1', items: [{ serviceId: 's1' }, { serviceId: 's2' }] },
        headers: expect.objectContaining({ 'Idempotency-Key': 'wa-nonce' }),
      });
    });

    it('maps a booking conflict (409) to SLOT_UNAVAILABLE', async () => {
      const { adapter } = adapterWith(async () => { throw httpError(409, { error: { code: 'SLOT_TAKEN', message: 'taken' } }); });
      await expect(adapter.createBooking({ customerId: 'c1', idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'SLOT_TAKEN' });
      const { adapter: plain } = adapterWith(async () => { throw httpError(409, {}); });
      await expect(plain.createBooking({ customerId: 'c1' })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    });

    it('returns the existing feedback when the CRM reports a duplicate', async () => {
      const { adapter } = adapterWith(async (config) => {
        if (config.method === 'post') throw httpError(409, {});
        return { data: { id: 'f1', booking_id: 'b1', customer_id: 'c1', rating: 5 } };
      });
      await expect(adapter.createFeedback({ customerId: 'c1', bookingId: 'b1', rating: 4 }))
        .resolves.toMatchObject({ id: 'f1', rating: 5, duplicate: true });
    });

    it('does not return another customer\'s feedback', async () => {
      const { adapter } = adapterWith(async () => ({ data: { id: 'f1', booking_id: 'b1', customer_id: 'someone-else', rating: 5 } }));
      await expect(adapter.getFeedbackForBooking('c1', 'b1')).resolves.toBeNull();
    });
  });

  describe('through the reliability wrapper', () => {
    it('treats a 5xx on a write as uncertain and never retries it', async () => {
      const { adapter, http } = adapterWith(async () => { throw httpError(503); });
      const crm = wrapCrmAdapter(adapter, { timeoutMs: 1000, maxReadRetries: 2, retryBaseDelayMs: 1 });
      await expect(crm.createBookings({ customerId: 'c1', items: [{}] })).rejects.toMatchObject({ uncertain: true });
      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('treats a 4xx on a write as a definite failure', async () => {
      const { adapter } = adapterWith(async () => { throw httpError(422, { code: 'INVALID_PROPERTY' }); });
      const crm = wrapCrmAdapter(adapter, { timeoutMs: 1000, maxReadRetries: 0, retryBaseDelayMs: 1 });
      const error = await crm.createBooking({ customerId: 'c1' }).catch((err) => err);
      expect(error.code).toBe('INVALID_PROPERTY');
      expect(error.uncertain).toBeFalsy();
    });

    it('retries a transient read', async () => {
      let calls = 0;
      const { adapter } = adapterWith(async () => {
        calls += 1;
        if (calls === 1) throw httpError(502);
        return { data: [] };
      });
      const crm = wrapCrmAdapter(adapter, { timeoutMs: 1000, maxReadRetries: 2, retryBaseDelayMs: 1 });
      await expect(crm.getServices()).resolves.toEqual([]);
      expect(calls).toBe(2);
    });
  });
});
