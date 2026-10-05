// See ai/intentService.test.js for why require()-cache monkey-patching is
// used here instead of vi.mock (which doesn't reach transitive require()
// calls in this plain-CommonJS project).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = require('../../db/supabaseClient');
db.get = vi.fn();
db.insert = vi.fn();
db.upsert = vi.fn();
db.patch = vi.fn();
db.rpc = vi.fn();

const crm = require('../../crm/supabaseCrmAdapter');
const { todayInTimeZone, addDays } = require('../../flows/dateUtils');

function missingFunctionError() {
  return Object.assign(new Error('Not Found'), { response: { status: 404, data: { code: 'PGRST202' } } });
}

describe('supabaseCrmAdapter', () => {
  beforeEach(() => {
    db.get.mockReset(); db.insert.mockReset(); db.upsert.mockReset(); db.patch.mockReset(); db.rpc.mockReset();
  });

  it('createBooking falls back to a direct insert with a BK- reference when the atomic function is not deployed', async () => {
    db.rpc.mockRejectedValueOnce(missingFunctionError());
    db.get.mockResolvedValueOnce([{ id: 'svc1', name: 'AC', base_price: 150 }]); // getServiceDetails lookup
    db.insert.mockResolvedValueOnce([{
      id: 'b1', reference: 'BK-ABC123', customer_id: 'cust1', property_id: 'prop1', service_id: 'svc1',
      scheduled_date: '2026-10-01', scheduled_time: '09:00', status: 'confirmed', price: 150,
    }]);

    const booking = await crm.createBooking({ customerId: 'cust1', propertyId: 'prop1', serviceId: 'svc1', date: '2026-10-01', time: '09:00' });

    expect(booking.reference).toMatch(/^BK-/);
    expect(db.insert).toHaveBeenCalledWith('bookings', expect.objectContaining({
      customer_id: 'cust1', property_id: 'prop1', service_id: 'svc1',
      scheduled_date: '2026-10-01', scheduled_time: '09:00', status: 'confirmed', price: 150,
    }));
  });

  it('createComplaint generates a CM- prefixed reference and inserts a media_attachments row per attachment', async () => {
    db.insert.mockResolvedValueOnce([{ id: 'c1', reference: 'CM-XYZ789', customer_id: 'cust1', category: 'other', status: 'open' }]);
    db.insert.mockResolvedValueOnce({});

    const complaint = await crm.createComplaint({
      customerId: 'cust1', category: 'other', description: 'leak', attachments: [{ waMediaId: 'w1', mediaType: 'image' }],
    });

    expect(complaint.reference).toMatch(/^CM-/);
    expect(db.insert).toHaveBeenCalledWith(
      'media_attachments',
      expect.objectContaining({ complaint_id: 'c1', wa_media_id: 'w1', media_type: 'image' }),
      expect.anything()
    );
  });

  it('findCustomerByPhone auto-registers a new customer on first contact', async () => {
    db.get.mockResolvedValueOnce([]);
    db.upsert.mockResolvedValueOnce([{ id: 'cust1', phone: '971500' }]);

    const customer = await crm.findCustomerByPhone('971500');
    expect(customer.id).toBe('cust1');
    expect(customer.returningCustomer).toBe(false);
    expect(db.upsert).toHaveBeenCalledWith('customers', { phone: '971500' }, { onConflict: 'phone' });
  });

  it('findCustomerByPhone returns the existing customer without upserting', async () => {
    db.get.mockResolvedValueOnce([{ id: 'cust1', phone: '971500', name: 'Test' }]);
    const customer = await crm.findCustomerByPhone('971500');
    expect(customer.id).toBe('cust1');
    expect(customer.returningCustomer).toBe(true);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('updates a validated default property without modifying another customer property', async () => {
    db.get
      .mockResolvedValueOnce([{ id: 'prop1' }])
      .mockResolvedValueOnce([{ id: 'cust1', preferred_language: 'en' }])
      .mockResolvedValueOnce([{ id: 'prop1', customer_id: 'cust1', is_default: true }]);
    db.patch.mockResolvedValue([]);

    const result = await crm.updateCustomerPreferences('cust1', { defaultPropertyId: 'prop1' });

    expect(db.patch).toHaveBeenNthCalledWith(1, 'properties', expect.stringContaining('id=eq.prop1'), { is_default: true });
    expect(db.patch).toHaveBeenNthCalledWith(2, 'properties', expect.stringContaining('id=neq.prop1'), { is_default: false });
    expect(result.defaultPropertyId).toBe('prop1');
  });

  it('rejects a default property that is not owned by the customer', async () => {
    db.get.mockResolvedValueOnce([]);
    await expect(crm.updateCustomerPreferences('cust1', { defaultPropertyId: 'other' }))
      .rejects.toMatchObject({ code: 'INVALID_DEFAULT_PROPERTY' });
    expect(db.patch).not.toHaveBeenCalled();
  });

  it('getAvailability excludes already-booked slots and returns structured slot data', async () => {
    const date = addDays(todayInTimeZone(), 2);
    db.get
      .mockResolvedValueOnce([{ scheduled_time: '09:00:00' }]) // bookings on that date
      .mockResolvedValueOnce([{ id: 'svc1', name: 'AC', duration_minutes: 90 }]); // service duration
    const slots = await crm.getAvailability('svc1', date);
    expect(slots.map((slot) => slot.id)).not.toContain('09:00');
    expect(slots[0]).toEqual({
      id: '11:00',
      start: '11:00',
      end: '12:30',
      startsAt: `${date}T11:00:00+04:00`,
      endsAt: `${date}T12:30:00+04:00`,
      timezone: 'Asia/Dubai',
      label: '11:00 AM – 12:30 PM',
    });
  });

  it('getAvailability never offers past dates', async () => {
    db.get.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'svc1', duration_minutes: 60 }]);
    expect(await crm.getAvailability('svc1', addDays(todayInTimeZone(), -1))).toEqual([]);
  });

  it('getAvailabilityRange returns every day in the window from one bookings query', async () => {
    const from = addDays(todayInTimeZone(), 1);
    db.get
      .mockResolvedValueOnce([{ scheduled_date: from, scheduled_time: '09:00:00' }])
      .mockResolvedValueOnce([{ id: 'svc1', duration_minutes: 60 }]);
    const range = await crm.getAvailabilityRange('svc1', { fromDate: from, days: 3 });
    expect(range.map((day) => day.date)).toEqual([from, addDays(from, 1), addDays(from, 2)]);
    expect(range[0].slots.map((slot) => slot.id)).not.toContain('09:00');
    expect(range[1].slots.map((slot) => slot.id)).toContain('09:00');
    expect(db.get).toHaveBeenNthCalledWith(1, 'bookings', expect.stringContaining(`scheduled_date=gte.${from}`));
  });

  it('createBookings creates every service through one atomic database call', async () => {
    db.rpc.mockResolvedValueOnce([
      { id: 'b1', reference: 'BK-AAA111', customer_id: 'cust1', service_id: 'svc1', status: 'confirmed' },
      { id: 'b2', reference: 'BK-BBB222', customer_id: 'cust1', service_id: 'svc2', status: 'confirmed' },
    ]);
    const bookings = await crm.createBookings({
      customerId: 'cust1',
      idempotencyKey: 'wa-nonce',
      items: [
        { propertyId: 'p1', serviceId: 'svc1', date: '2026-10-10', time: '09:00' },
        { propertyId: 'p1', serviceId: 'svc2', date: '2026-10-10', time: '11:00', notes: 'kitchen' },
      ],
    });
    expect(bookings.map((booking) => booking.reference)).toEqual(['BK-AAA111', 'BK-BBB222']);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('chatbot_create_bookings', {
      p_customer_id: 'cust1',
      p_idempotency_key: 'wa-nonce',
      p_items: [
        { property_id: 'p1', service_id: 'svc1', scheduled_date: '2026-10-10', scheduled_time: '09:00', notes: null },
        { property_id: 'p1', service_id: 'svc2', scheduled_date: '2026-10-10', scheduled_time: '11:00', notes: 'kitchen' },
      ],
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('maps a slot conflict raised by the database to a definitive SLOT_UNAVAILABLE error', async () => {
    db.rpc.mockRejectedValueOnce(Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: { code: 'P0001', message: 'SLOT_UNAVAILABLE:1' } },
    }));
    await expect(crm.createBookings({
      customerId: 'cust1',
      items: [{ propertyId: 'p1', serviceId: 'svc1', date: '2026-10-10', time: '09:00' }],
    })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('cancels already-created bookings when the non-atomic fallback fails part-way', async () => {
    db.rpc.mockRejectedValueOnce(missingFunctionError());
    db.get.mockResolvedValue([{ id: 'svc', base_price: 100 }]);
    db.insert
      .mockResolvedValueOnce([{ id: 'b1', reference: 'BK-AAA111', status: 'confirmed' }])
      .mockRejectedValueOnce(Object.assign(new Error('Bad Request'), { response: { status: 400, data: {} } }));
    db.patch.mockResolvedValueOnce([{ id: 'b1', status: 'cancelled' }]);
    await expect(crm.createBookings({
      customerId: 'cust1',
      items: [
        { propertyId: 'p1', serviceId: 'svc1', date: '2026-10-10', time: '09:00' },
        { propertyId: 'p1', serviceId: 'svc2', date: '2026-10-10', time: '11:00' },
      ],
    })).rejects.toThrow('Bad Request');
    expect(db.patch).toHaveBeenCalledWith('bookings', 'id=eq.b1', expect.objectContaining({ status: 'cancelled' }));
  });

  it('saves geocoded coordinates with a new property, or the address alone before the column migration', async () => {
    db.insert
      .mockRejectedValueOnce(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { code: 'PGRST204' } } }))
      .mockResolvedValueOnce([{ id: 'p9', customer_id: 'cust1', address_line: 'Villa 3, Al Barsha', city: 'Dubai' }]);
    const property = await crm.addProperty('cust1', {
      addressLine: 'Villa 3, Al Barsha', city: 'Dubai', latitude: 25.1, longitude: 55.2, locationSource: 'whatsapp_location',
    });
    expect(property.id).toBe('p9');
    expect(db.insert).toHaveBeenNthCalledWith(1, 'properties', expect.objectContaining({ latitude: 25.1, longitude: 55.2 }));
    expect(db.insert).toHaveBeenNthCalledWith(2, 'properties', expect.not.objectContaining({ latitude: 25.1 }));
  });

  it('stores structured handoff details through the existing escalation summary field', async () => {
    db.insert.mockResolvedValueOnce([{ id: 'handoff-1' }]);
    const handoff = {
      customer: { id: 'cust1', phone: '971500' },
      issue: { summary: 'Customer requested help.', urgency: 'NORMAL', reasonForEscalation: 'explicit_human_request' },
    };

    await crm.escalateToHuman({
      customerId: 'cust1', phone: '971500', reason: 'explicit_human_request',
      summary: 'Customer requested help.', handoff,
    });

    expect(db.insert).toHaveBeenCalledWith('escalations', expect.objectContaining({
      customer_id: 'cust1', phone: '971500', reason: 'explicit_human_request', status: 'open',
      conversation_summary: expect.stringContaining('Structured handoff:'),
    }));
    expect(db.insert.mock.calls[0][1].conversation_summary).toContain(JSON.stringify(handoff));
  });

  it('inserts completed WhatsApp feedback when no survey row exists', async () => {
    db.get.mockResolvedValueOnce([]);
    db.insert.mockResolvedValueOnce([{
      id: 'feedback-1', customer_id: 'cust1', booking_id: 'booking-1', phone: '971500',
      rating: 5, comment: 'Excellent service', responded_at: '2026-09-30T10:00:00.000Z',
    }]);

    const result = await crm.createFeedback({
      customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 5, comment: 'Excellent service',
    });

    expect(db.insert).toHaveBeenCalledWith('satisfaction_surveys', expect.objectContaining({
      customer_id: 'cust1', booking_id: 'booking-1', phone: '971500', rating: 5,
      comment: 'Excellent service', responded_at: expect.any(String),
    }));
    expect(result).toMatchObject({
      id: 'feedback-1', customerId: 'cust1', bookingId: 'booking-1', rating: 5,
      duplicate: false, persistenceStatus: 'inserted',
    });
  });

  it('atomically completes an existing pending survey instead of inserting', async () => {
    db.get.mockResolvedValueOnce([{
      id: 'survey-1', customer_id: 'cust1', booking_id: 'booking-1', phone: '971500',
      rating: null, comment: null, responded_at: null,
    }]);
    db.patch.mockResolvedValueOnce([{
      id: 'survey-1', customer_id: 'cust1', booking_id: 'booking-1', phone: '971500',
      rating: 2, comment: 'The service was incomplete.', responded_at: '2026-09-30T10:00:00.000Z',
    }]);

    const result = await crm.createFeedback({
      customerId: 'cust1', bookingId: 'booking-1', phone: '971500',
      rating: 2, comment: 'The service was incomplete.',
    });

    expect(db.patch).toHaveBeenCalledWith(
      'satisfaction_surveys',
      'id=eq.survey-1&customer_id=eq.cust1&booking_id=eq.booking-1&responded_at=is.null',
      expect.objectContaining({ rating: 2, comment: 'The service was incomplete.', responded_at: expect.any(String) })
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'survey-1', duplicate: false, persistenceStatus: 'updated_pending' });
  });

  it('reuses completed feedback without overwriting its rating or comment', async () => {
    db.get.mockResolvedValueOnce([{
      id: 'survey-1', customer_id: 'cust1', booking_id: 'booking-1',
      rating: 5, comment: 'Original comment', responded_at: '2026-09-30T10:00:00.000Z',
    }]);

    const result = await crm.createFeedback({
      customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 1, comment: 'Replacement comment',
    });

    expect(db.patch).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      rating: 5, comment: 'Original comment', duplicate: true, persistenceStatus: 'existing_completed',
    });
  });

  it('returns the concurrent winner when two requests complete the same pending row', async () => {
    const pending = {
      id: 'survey-1', customer_id: 'cust1', booking_id: 'booking-1',
      rating: null, comment: null, responded_at: null,
    };
    const completed = {
      ...pending, rating: 5, comment: 'First response', responded_at: '2026-09-30T10:00:00.000Z',
    };
    let readCount = 0;
    db.get.mockImplementation(async () => {
      readCount += 1;
      return readCount <= 2 ? [pending] : [completed];
    });
    let patchCount = 0;
    db.patch.mockImplementation(async () => {
      patchCount += 1;
      return patchCount === 1 ? [completed] : [];
    });

    const results = await Promise.all([
      crm.createFeedback({ customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 5, comment: 'First response' }),
      crm.createFeedback({ customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 1, comment: 'Second response' }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(results.every((result) => result.rating === 5 && result.comment === 'First response')).toBe(true);
  });

  it('handles a unique-constraint race by returning the completed winning row', async () => {
    const uniqueError = Object.assign(new Error('duplicate key'), {
      response: { status: 409, data: { code: '23505', message: 'unique violation' } },
    });
    db.get
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'winner', customer_id: 'cust1', booking_id: 'booking-1',
        rating: 4, comment: 'Winning response', responded_at: '2026-09-30T10:00:00.000Z',
      }]);
    db.insert.mockRejectedValueOnce(uniqueError);

    const result = await crm.createFeedback({
      customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 2, comment: 'Losing response',
    });

    expect(result).toMatchObject({
      id: 'winner', rating: 4, comment: 'Winning response', duplicate: true,
      persistenceStatus: 'existing_completed',
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-unique CRM write failure without retrying the insert', async () => {
    db.get.mockResolvedValueOnce([]);
    db.insert.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(crm.createFeedback({
      customerId: 'cust1', bookingId: 'booking-1', phone: '971500', rating: 5,
    })).rejects.toThrow('database unavailable');
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it('checks for an existing completed response by customer and booking', async () => {
    db.get.mockResolvedValueOnce([{ id: 'feedback-1', customer_id: 'cust1', booking_id: 'booking-1', rating: 4 }]);
    const result = await crm.getFeedbackForBooking('cust1', 'booking-1');
    expect(db.get).toHaveBeenCalledWith(
      'satisfaction_surveys',
      expect.stringContaining('customer_id=eq.cust1&booking_id=eq.booking-1&responded_at=not.is.null')
    );
    expect(result.rating).toBe(4);
  });

  it('links feedback to an existing or newly submitted complaint', async () => {
    db.patch.mockResolvedValueOnce([{
      id: 'feedback-1', customer_id: 'cust1', booking_id: 'booking-1', complaint_id: 'complaint-1', rating: 2,
    }]);
    const result = await crm.markFeedbackFollowUp('feedback-1', { complaintId: 'complaint-1' });
    expect(db.patch).toHaveBeenCalledWith('satisfaction_surveys', 'id=eq.feedback-1', { complaint_id: 'complaint-1' });
    expect(result.complaintId).toBe('complaint-1');
  });
});
