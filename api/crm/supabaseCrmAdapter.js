// Default CrmAdapter implementation, backed by the Supabase tables in
// api/db/schema.sql. This is what makes the chatbot end-to-end testable today,
// ahead of the client's real CRM API being documented (see httpCrmAdapter.js).
const db = require('../db/supabaseClient');
const { generateReference } = require('../utils/reference');
const { todayInTimeZone, minutesNowInTimeZone, addDays } = require('../flows/dateUtils');
const { normalizeSlots, minutesOf } = require('./slots');

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
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
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

async function getCustomerById(customerId) {
  const rows = await db.get('customers', `id=eq.${encodeURIComponent(customerId)}&select=*&limit=1`);
  return rows && rows.length > 0 ? mapCustomer(rows[0]) : null;
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
  const row = {
    customer_id: customerId,
    label: property.label || null,
    address_line: property.addressLine,
    area: property.area || null,
    city: property.city || 'Dubai',
  };
  const hasCoordinates = Number.isFinite(property.latitude) && Number.isFinite(property.longitude);
  const located = hasCoordinates
    ? {
      ...row,
      latitude: property.latitude,
      longitude: property.longitude,
      location_source: property.locationSource || null,
      place_id: property.placeId || null,
    }
    : row;
  let created;
  try {
    created = await db.insert('properties', located);
  } catch (error) {
    // Coordinates are an enhancement: if the columns from the geocoding
    // migration are not there yet, still save the address itself.
    if (!hasCoordinates || !db.isMissingColumn(error)) throw error;
    created = await db.insert('properties', row);
  }
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

// Builds structured slots for one day from the fixed slot grid: removes
// times already booked for the service and, for today, times that have
// already started in the business timezone.
function slotsForDate(date, takenTimes, durationMinutes, now = new Date()) {
  const today = todayInTimeZone(now);
  if (date < today) return [];
  const nowMinutes = date === today ? minutesNowInTimeZone(now) : -1;
  return normalizeSlots(
    DEFAULT_SLOTS.filter((slot) => !takenTimes.has(slot) && minutesOf(slot) > nowMinutes),
    { date, durationMinutes: durationMinutes || null }
  );
}

async function serviceDuration(serviceId) {
  const service = await getServiceDetails(serviceId);
  return service ? service.durationMinutes : null;
}

async function getAvailability(serviceId, date) {
  const [bookedRows, durationMinutes] = await Promise.all([
    db.get(
      'bookings',
      `service_id=eq.${encodeURIComponent(serviceId)}&scheduled_date=eq.${encodeURIComponent(date)}&status=neq.cancelled&select=scheduled_time`
    ),
    serviceDuration(serviceId),
  ]);
  const taken = new Set((bookedRows || []).map((r) => (r.scheduled_time || '').slice(0, 5)));
  return slotsForDate(date, taken, durationMinutes);
}

// One query for the whole window instead of one per day.
async function getAvailabilityRange(serviceId, { fromDate, days = 7 } = {}) {
  const start = fromDate || todayInTimeZone();
  const window = Math.min(Math.max(Number(days) || 7, 1), 31);
  const end = addDays(start, window - 1);
  const [bookedRows, durationMinutes] = await Promise.all([
    db.get(
      'bookings',
      `service_id=eq.${encodeURIComponent(serviceId)}&scheduled_date=gte.${start}&scheduled_date=lte.${end}&status=neq.cancelled&select=scheduled_date,scheduled_time`
    ),
    serviceDuration(serviceId),
  ]);
  const takenByDate = new Map();
  for (const row of bookedRows || []) {
    if (!takenByDate.has(row.scheduled_date)) takenByDate.set(row.scheduled_date, new Set());
    takenByDate.get(row.scheduled_date).add((row.scheduled_time || '').slice(0, 5));
  }
  const result = [];
  for (let offset = 0; offset < window; offset += 1) {
    const date = addDays(start, offset);
    result.push({ date, slots: slotsForDate(date, takenByDate.get(date) || new Set(), durationMinutes) });
  }
  return result;
}

function slotUnavailableError(cause) {
  const error = new Error('The selected time is no longer available');
  error.code = 'SLOT_UNAVAILABLE';
  error.cause = cause;
  return error;
}

// Maps a PostgREST error raised by chatbot_create_bookings to a definitive
// (non-retryable, non-uncertain) error code the booking flow understands.
function mapBookingRpcError(error) {
  const data = error && error.response && error.response.data;
  const message = String((data && data.message) || '');
  if (message.startsWith('SLOT_UNAVAILABLE')) return slotUnavailableError(error);
  if (message.startsWith('INVALID_PROPERTY') || message.startsWith('INVALID_SERVICE')) {
    const mapped = new Error(message);
    mapped.code = message.split(':')[0];
    mapped.cause = error;
    return mapped;
  }
  return error;
}

async function insertBookingRow({ customerId, propertyId, serviceId, date, time, notes }) {
  const service = await getServiceDetails(serviceId);
  const created = await db.insert('bookings', {
    reference: generateReference('BK'),
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

// Used only when the atomic function has not been deployed yet: creates the
// bookings one by one and cancels the ones already created if a later one
// fails, so the customer never ends up with half a multi-service booking.
async function createBookingsSequentially(customerId, items) {
  const created = [];
  try {
    for (const item of items) {
      created.push(await insertBookingRow({ customerId, ...item }));
    }
    return created;
  } catch (error) {
    for (const booking of created) {
      try {
        await cancelBooking(booking.id);
      } catch {
        // Compensation is best effort; the uncertain-outcome path escalates.
        error.uncertain = true;
      }
    }
    throw error;
  }
}

/**
 * All-or-nothing creation of one or more bookings for the same customer.
 * Idempotent per idempotencyKey: repeating a key returns the bookings the
 * first call created instead of creating new ones.
 */
async function createBookings({ customerId, items, idempotencyKey }) {
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    throw new Error('createBookings requires customerId and at least one item');
  }
  try {
    const rows = await db.rpc('chatbot_create_bookings', {
      p_customer_id: customerId,
      p_items: items.map((item) => ({
        property_id: item.propertyId,
        service_id: item.serviceId,
        scheduled_date: item.date,
        scheduled_time: item.time,
        notes: item.notes || null,
      })),
      p_idempotency_key: idempotencyKey || null,
    });
    return (rows || []).map(mapBooking);
  } catch (error) {
    if (db.isMissingFunction(error)) return createBookingsSequentially(customerId, items);
    throw mapBookingRpcError(error);
  }
}

async function createBooking({ customerId, propertyId, serviceId, date, time, notes, idempotencyKey }) {
  const [booking] = await createBookings({
    customerId,
    items: [{ propertyId, serviceId, date, time, notes }],
    idempotencyKey,
  });
  return booking;
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

const COMPLAINT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

async function createComplaint({ customerId, bookingId, category, description, priority, attachments }) {
  const reference = generateReference('CM');
  const row = {
    reference,
    customer_id: customerId,
    booking_id: bookingId || null,
    category,
    description: description || null,
    status: 'open',
  };
  let created;
  if (COMPLAINT_PRIORITIES.has(priority)) {
    try {
      created = await db.insert('complaints', { ...row, priority });
    } catch (error) {
      // The priority column comes from the dashboard migration; without it
      // the complaint is still recorded.
      if (!db.isMissingColumn(error)) throw error;
      created = await db.insert('complaints', row);
    }
  } else {
    created = await db.insert('complaints', row);
  }
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

// Appends a customer update (text and/or media) to an existing complaint
// instead of opening a duplicate one.
async function addComplaintDetails(complaintId, { customerId, text, attachments = [] } = {}) {
  const rows = await db.get('complaints', `id=eq.${encodeURIComponent(complaintId)}&select=*&limit=1`);
  const existing = rows && rows[0];
  if (!existing || (customerId && existing.customer_id && String(existing.customer_id) !== String(customerId))) {
    const error = new Error('Complaint not found for this customer');
    error.code = 'COMPLAINT_NOT_FOUND';
    throw error;
  }
  let updated = existing;
  if (text && text.trim()) {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const description = [existing.description, `[Customer update ${stamp} UTC] ${text.trim()}`].filter(Boolean).join('\n\n');
    const patched = await db.patch('complaints', `id=eq.${encodeURIComponent(complaintId)}`, {
      description,
      updated_at: new Date().toISOString(),
    });
    updated = (Array.isArray(patched) ? patched[0] : patched) || existing;
  }
  for (const attachment of attachments) {
    await db.insert('media_attachments', {
      complaint_id: complaintId,
      customer_id: existing.customer_id,
      wa_media_id: attachment.waMediaId,
      media_type: attachment.mediaType,
    }, { returnRepresentation: false });
  }
  return mapComplaint(updated);
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
  getCustomerById,
  getCustomerProperties,
  getCustomerPreferences,
  updateCustomerPreferences,
  addProperty,
  getServices,
  getServiceDetails,
  checkServiceability,
  getAvailability,
  getAvailabilityRange,
  createBooking,
  createBookings,
  getBookings,
  getBookingStatus,
  getBookingById,
  rescheduleBooking,
  cancelBooking,
  createComplaint,
  addComplaintDetails,
  getComplaintStatus,
  getOpenComplaintForBooking,
  getActiveComplaints,
  createFeedback,
  getFeedbackForBooking,
  markFeedbackFollowUp,
  escalateToHuman,
};
