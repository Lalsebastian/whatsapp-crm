// See ai/intentService.test.js for why require()-cache monkey-patching is
// used here instead of vi.mock (which doesn't reach transitive require()
// calls in this plain-CommonJS project).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = require('../../db/supabaseClient');
db.get = vi.fn();
db.insert = vi.fn();
db.upsert = vi.fn();
db.patch = vi.fn();

const crm = require('../../crm/supabaseCrmAdapter');

describe('supabaseCrmAdapter', () => {
  beforeEach(() => { db.get.mockReset(); db.insert.mockReset(); db.upsert.mockReset(); db.patch.mockReset(); });

  it('createBooking generates a BK- prefixed reference and inserts the right payload', async () => {
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
    expect(db.upsert).toHaveBeenCalledWith('customers', { phone: '971500' }, { onConflict: 'phone' });
  });

  it('findCustomerByPhone returns the existing customer without upserting', async () => {
    db.get.mockResolvedValueOnce([{ id: 'cust1', phone: '971500', name: 'Test' }]);
    const customer = await crm.findCustomerByPhone('971500');
    expect(customer.id).toBe('cust1');
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('getAvailability excludes already-booked slots for that service/date', async () => {
    db.get.mockResolvedValueOnce([{ scheduled_time: '09:00:00' }]);
    const slots = await crm.getAvailability('svc1', '2026-10-01');
    expect(slots).not.toContain('09:00');
    expect(slots.length).toBeGreaterThan(0);
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
