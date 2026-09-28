// Default CrmAdapter implementation, backed by the Supabase tables in
// api/db/schema.sql. This is what makes the chatbot end-to-end testable today,
// ahead of the client's real CRM API being documented (see httpCrmAdapter.js).
const db = require('../db/supabaseClient');
const { generateReference } = require('../utils/reference');

const DEFAULT_SLOTS = ['09:00', '11:00', '13:00', '15:00', '17:00'];

function mapCustomer(row) {
  if (!row) return null;
  return { id: row.id, phone: row.phone, name: row.name, preferredLanguage: row.preferred_language };
}

function mapProperty(row) {
  if (!row) return null;
  return { id: row.id, customerId: row.customer_id, label: row.label, addressLine: row.address_line, area: row.area, city: row.city };
}

function mapService(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    basePrice: row.base_price,
    durationMinutes: row.duration_minutes,
  };
}

function mapBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    propertyId: row.property_id,
    serviceId: row.service_id,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    status: row.status,
    price: row.price,
    notes: row.notes,
  };
}

function mapComplaint(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    bookingId: row.booking_id,
    category: row.category,
    description: row.description,
    status: row.status,
  };
}

async function findCustomerByPhone(phone) {
  const existing = await db.get('customers', `phone=eq.${encodeURIComponent(phone)}&select=*`);
  if (existing && existing.length > 0) return mapCustomer(existing[0]);
  // A WhatsApp phone number is enough identification for a home-services
  // customer — auto-register on first contact rather than forcing a signup step.
  const created = await db.upsert('customers', { phone }, { onConflict: 'phone' });
  return mapCustomer(Array.isArray(created) ? created[0] : created);
}

async function getCustomerProperties(customerId) {
  const rows = await db.get('properties', `customer_id=eq.${customerId}&select=*&order=is_default.desc,created_at.asc`);
  return (rows || []).map(mapProperty);
}

async function addProperty(customerId, property) {
  const created = await db.insert('properties', {
    customer_id: customerId,
    label: property.label || null,
    address_line: property.addressLine,
    area: property.area || null,
    city: property.city || 'Dubai',
  });
  return mapProperty(Array.isArray(created) ? created[0] : created);
}

async function getServices() {
  const rows = await db.get('services', 'active=eq.true&select=*&order=name.asc');
  return (rows || []).map(mapService);
}

async function getServiceDetails(serviceId) {
  const rows = await db.get('services', `id=eq.${serviceId}&select=*`);
  return rows && rows.length > 0 ? mapService(rows[0]) : null;
}

async function getAvailability(serviceId, date) {
  const bookedRows = await db.get(
    'bookings',
    `service_id=eq.${serviceId}&scheduled_date=eq.${date}&status=neq.cancelled&select=scheduled_time`
  );
  const taken = new Set((bookedRows || []).map((r) => (r.scheduled_time || '').slice(0, 5)));
  return DEFAULT_SLOTS.filter((slot) => !taken.has(slot));
}

async function createBooking({ customerId, propertyId, serviceId, date, time, notes }) {
  const service = await getServiceDetails(serviceId);
  const reference = generateReference('BK');
  const created = await db.insert('bookings', {
    reference,
    customer_id: customerId,
    property_id: propertyId,
    service_id: serviceId,
    scheduled_date: date,
    scheduled_time: time,
    status: 'confirmed',
    price: service ? service.basePrice : null,
    notes: notes || null,
  });
  return mapBooking(Array.isArray(created) ? created[0] : created);
}

async function getBookings(customerId, { limit = 10 } = {}) {
  const rows = await db.get(
    'bookings',
    `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=${limit}`
  );
  return (rows || []).map(mapBooking);
}

async function getBookingStatus(reference) {
  const rows = await db.get('bookings', `reference=eq.${encodeURIComponent(reference)}&select=*`);
  return rows && rows.length > 0 ? mapBooking(rows[0]) : null;
}

async function rescheduleBooking(bookingId, { date, time }) {
  const updated = await db.patch('bookings', `id=eq.${bookingId}`, {
    scheduled_date: date,
    scheduled_time: time,
    status: 'confirmed',
    updated_at: new Date().toISOString(),
  });
  return mapBooking(Array.isArray(updated) ? updated[0] : updated);
}

async function cancelBooking(bookingId) {
  const updated = await db.patch('bookings', `id=eq.${bookingId}`, {
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  });
  return mapBooking(Array.isArray(updated) ? updated[0] : updated);
}

async function createComplaint({ customerId, bookingId, category, description, attachments }) {
  const reference = generateReference('CM');
  const created = await db.insert('complaints', {
    reference,
    customer_id: customerId,
    booking_id: bookingId || null,
    category,
    description: description || null,
    status: 'open',
  });
  const complaint = mapComplaint(Array.isArray(created) ? created[0] : created);

  if (attachments && attachments.length > 0) {
    await Promise.all(
      attachments.map((a) =>
        db.insert(
          'media_attachments',
          {
            complaint_id: complaint.id,
            customer_id: customerId,
            wa_media_id: a.waMediaId,
            media_type: a.mediaType,
          },
          { returnRepresentation: false }
        )
      )
    );
  }

  return complaint;
}

async function getComplaintStatus(reference) {
  const rows = await db.get('complaints', `reference=eq.${encodeURIComponent(reference)}&select=*`);
  return rows && rows.length > 0 ? mapComplaint(rows[0]) : null;
}

async function escalateToHuman({ customerId, phone, reason, summary }) {
  const created = await db.insert('escalations', {
    customer_id: customerId || null,
    phone,
    reason,
    conversation_summary: summary || null,
    status: 'open',
  });
  const row = Array.isArray(created) ? created[0] : created;
  return { id: row.id };
}

module.exports = {
  findCustomerByPhone,
  getCustomerProperties,
  addProperty,
  getServices,
  getServiceDetails,
  getAvailability,
  createBooking,
  getBookings,
  getBookingStatus,
  rescheduleBooking,
  cancelBooking,
  createComplaint,
  getComplaintStatus,
  escalateToHuman,
};
