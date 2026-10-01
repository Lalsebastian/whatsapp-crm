// Default CrmAdapter implementation, backed by the Supabase tables in
// api/db/schema.sql. This is what makes the chatbot end-to-end testable today,
// ahead of the client's real CRM API being documented (see httpCrmAdapter.js).
const db = require('../db/supabaseClient');
const { generateReference } = require('../utils/reference');

const DEFAULT_SLOTS = ['09:00', '11:00', '13:00', '15:00', '17:00'];
const PREFERENCE_LANGUAGES = new Set(['en', 'ml', 'manglish', 'hi', 'hinglish']);

function mapCustomer(row) {
  if (!row) return null;
  return { id: row.id, phone: row.phone, name: row.name, preferredLanguage: row.preferred_language };
}

function mapProperty(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    label: row.label,
    addressLine: row.address_line,
    area: row.area,
    city: row.city,
    isDefault: !!row.is_default,
  };
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

function mapFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    bookingId: row.booking_id,
    complaintId: row.complaint_id || null,
    rating: row.rating,
    comment: row.comment || null,
    source: 'whatsapp',
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

function isUniqueViolation(error) {
  return error && (
    error.code === '23505'
    || (error.response && error.response.data && error.response.data.code === '23505')
  );
}

async function getSurveyRowsForBooking(customerId, bookingId) {
  const rows = await db.get(
    'satisfaction_surveys',
    `customer_id=eq.${encodeURIComponent(customerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&select=*&order=created_at.asc`
  );
  return rows || [];
}

function completedFeedback(rows) {
  const row = rows.find((item) => item.responded_at);
  return row ? { ...mapFeedback(row), duplicate: true, persistenceStatus: 'existing_completed' } : null;
}

async function completePendingFeedback(row, { customerId, bookingId, rating, comment }, now) {
  const updated = await db.patch(
    'satisfaction_surveys',
    `id=eq.${encodeURIComponent(row.id)}&customer_id=eq.${encodeURIComponent(customerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&responded_at=is.null`,
    {
      rating,
      comment: comment || null,
      responded_at: now,
    }
  );
  if (updated && updated.length > 0) {
    return { ...mapFeedback(updated[0]), duplicate: false, persistenceStatus: 'updated_pending' };
  }

  // Another request may have completed the pending row after our read but
  // before the conditional PATCH. Re-read and return the winner without ever
  // overwriting its rating or comment.
  return completedFeedback(await getSurveyRowsForBooking(customerId, bookingId));
}

async function findCustomerByPhone(phone) {
  const existing = await db.get('customers', `phone=eq.${encodeURIComponent(phone)}&select=*`);
  if (existing && existing.length > 0) return { ...mapCustomer(existing[0]), returningCustomer: true };
  // A WhatsApp phone number is enough identification for a home-services
  // customer — auto-register on first contact rather than forcing a signup step.
  const created = await db.upsert('customers', { phone }, { onConflict: 'phone' });
  return { ...mapCustomer(Array.isArray(created) ? created[0] : created), returningCustomer: false };
}

async function getCustomerProperties(customerId) {
  const rows = await db.get('properties', `customer_id=eq.${customerId}&select=*&order=is_default.desc,created_at.asc`);
  return (rows || []).map(mapProperty);
}

async function getCustomerPreferences(customerId) {
  const [customers, properties] = await Promise.all([
    db.get('customers', `id=eq.${encodeURIComponent(customerId)}&select=id,preferred_language&limit=1`),
    getCustomerProperties(customerId),
  ]);
  const customer = customers && customers[0];
  if (!customer) return null;
  const defaultProperty = properties.find((property) => property.isDefault) || null;
  return {
    customerId,
    preferredLanguage: customer.preferred_language || 'en',
    defaultPropertyId: defaultProperty ? defaultProperty.id : null,
  };
}

async function updateCustomerPreferences(customerId, { preferredLanguage, defaultPropertyId } = {}) {
  if (preferredLanguage) {
    if (!PREFERENCE_LANGUAGES.has(preferredLanguage)) {
      const error = new Error('Unsupported preferred language');
      error.code = 'INVALID_PREFERRED_LANGUAGE';
      throw error;
    }
    await db.patch('customers', `id=eq.${encodeURIComponent(customerId)}`, {
      preferred_language: preferredLanguage,
      updated_at: new Date().toISOString(),
    });
  }

  if (defaultPropertyId) {
    const owned = await db.get(
      'properties',
      `id=eq.${encodeURIComponent(defaultPropertyId)}&customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`
    );
    if (!owned || owned.length === 0) {
      const error = new Error('The selected property does not belong to this customer');
      error.code = 'INVALID_DEFAULT_PROPERTY';
      throw error;
    }
    // Mark the requested property first so a partial provider failure never
    // leaves the customer without any usable default.
    await db.patch(
      'properties',
      `id=eq.${encodeURIComponent(defaultPropertyId)}&customer_id=eq.${encodeURIComponent(customerId)}`,
      { is_default: true }
    );
    await db.patch(
      'properties',
      `customer_id=eq.${encodeURIComponent(customerId)}&id=neq.${encodeURIComponent(defaultPropertyId)}&is_default=eq.true`,
      { is_default: false }
    );
  }

  return getCustomerPreferences(customerId);
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

// The current Supabase CRM schema has no service-area table or coordinate
// coverage rules. Returning an explicit capability result keeps the booking
// sequence correct without inventing unsupported areas. A future CRM adapter
// can replace this with a real service/location check before availability.
async function checkServiceability(_serviceId, _location) {
  return { serviceable: true, source: 'crm_not_configured' };
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

async function getBookingById(bookingId) {
  const rows = await db.get('bookings', `id=eq.${encodeURIComponent(bookingId)}&select=*`);
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

async function getOpenComplaintForBooking(customerId, bookingId) {
  const rows = await db.get(
    'complaints',
    `customer_id=eq.${encodeURIComponent(customerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&status=in.(open,in_progress,escalated)&select=*&order=created_at.desc&limit=1`
  );
  return rows && rows.length > 0 ? mapComplaint(rows[0]) : null;
}

async function getActiveComplaints(customerId, { limit = 5 } = {}) {
  const rows = await db.get(
    'complaints',
    `customer_id=eq.${encodeURIComponent(customerId)}&status=in.(open,in_progress,escalated)&select=*&order=created_at.desc&limit=${limit}`
  );
  return (rows || []).map(mapComplaint);
}

async function createFeedback({ customerId, bookingId, phone, rating, comment }) {
  const now = new Date().toISOString();
  const existingRows = await getSurveyRowsForBooking(customerId, bookingId);
  const completed = completedFeedback(existingRows);
  if (completed) return completed;

  const pending = existingRows.find((row) => !row.responded_at);
  if (pending) {
    const result = await completePendingFeedback(pending, { customerId, bookingId, rating, comment }, now);
    if (result) return result;
    const error = new Error('The pending feedback row changed before it could be completed');
    error.code = 'FEEDBACK_CONCURRENT_UPDATE';
    throw error;
  }

  try {
    const created = await db.insert('satisfaction_surveys', {
      customer_id: customerId,
      booking_id: bookingId,
      phone,
      rating,
      comment: comment || null,
      asked_at: now,
      sent_at: now,
      responded_at: now,
    });
    const row = Array.isArray(created) ? created[0] : created;
    return { ...mapFeedback(row), duplicate: false, persistenceStatus: 'inserted' };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Once UNIQUE(customer_id, booking_id) exists, a concurrent creator may
    // win between our read and insert. Resolve the conflict by returning the
    // completed winner or atomically completing its pending row.
    const conflictRows = await getSurveyRowsForBooking(customerId, bookingId);
    const conflictCompleted = completedFeedback(conflictRows);
    if (conflictCompleted) return conflictCompleted;
    const conflictPending = conflictRows.find((row) => !row.responded_at);
    if (conflictPending) {
      const result = await completePendingFeedback(
        conflictPending,
        { customerId, bookingId, rating, comment },
        now
      );
      if (result) return result;
    }
    throw error;
  }
}

async function getFeedbackForBooking(customerId, bookingId) {
  const rows = await db.get(
    'satisfaction_surveys',
    `customer_id=eq.${encodeURIComponent(customerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&responded_at=not.is.null&select=*&order=responded_at.desc&limit=1`
  );
  return rows && rows.length > 0 ? mapFeedback(rows[0]) : null;
}

async function markFeedbackFollowUp(feedbackId, { complaintId } = {}) {
  if (!complaintId) return null;
  const updated = await db.patch('satisfaction_surveys', `id=eq.${encodeURIComponent(feedbackId)}`, {
    complaint_id: complaintId,
  });
  return mapFeedback(Array.isArray(updated) ? updated[0] : updated);
}

async function escalateToHuman({ customerId, phone, reason, summary, handoff }) {
  const conversationSummary = handoff
    ? `${summary || 'Human support requested.'}\n\nStructured handoff:\n${JSON.stringify(handoff)}`
    : (summary || null);
  const created = await db.insert('escalations', {
    customer_id: customerId || null,
    phone,
    reason,
    conversation_summary: conversationSummary,
    status: 'open',
  });
  const row = Array.isArray(created) ? created[0] : created;
  return { id: row.id };
}

module.exports = {
  findCustomerByPhone,
  getCustomerProperties,
  getCustomerPreferences,
  updateCustomerPreferences,
  addProperty,
  getServices,
  getServiceDetails,
  checkServiceability,
  getAvailability,
  createBooking,
  getBookings,
  getBookingStatus,
  getBookingById,
  rescheduleBooking,
  cancelBooking,
  createComplaint,
  getComplaintStatus,
  getOpenComplaintForBooking,
  getActiveComplaints,
  createFeedback,
  getFeedbackForBooking,
  markFeedbackFollowUp,
  escalateToHuman,
};
