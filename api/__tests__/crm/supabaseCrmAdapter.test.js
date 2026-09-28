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
});
