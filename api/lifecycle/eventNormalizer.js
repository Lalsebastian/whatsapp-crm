// Normalizes booking lifecycle events into one internal shape:
//
//   { id, type, bookingId, bookingReference, occurredAt, technicianName, eta, etaMinutes }
//
// type is one of booking.assigned | booking.on_the_way | booking.completed.
//
// Accepted inputs:
//   1. The documented CRM event (see crm/HTTP_CRM_CONTRACT.md):
//      { id, type, occurredAt, booking: { id, reference }, technician: { name }, eta, etaMinutes }
//   2. Common aliases (event/eventType/status names, flat bookingId fields).
//   3. A Supabase Database Webhook for UPDATEs on public.bookings, so the
//      bundled dashboard can drive lifecycle events today: a newly set
//      technician_id means "assigned", status -> completed means "completed".
const crypto = require('node:crypto');

const TYPE_ALIASES = {
  'booking.assigned': 'booking.assigned',
  'booking.technician_assigned': 'booking.assigned',
  technician_assigned: 'booking.assigned',
  assigned: 'booking.assigned',
  'booking.on_the_way': 'booking.on_the_way',
  'booking.en_route': 'booking.on_the_way',
  'booking.technician_on_the_way': 'booking.on_the_way',
  technician_on_the_way: 'booking.on_the_way',
  on_the_way: 'booking.on_the_way',
  en_route: 'booking.on_the_way',
  'booking.completed': 'booking.completed',
  completed: 'booking.completed',
};

const SUPPORTED_TYPES = new Set(['booking.assigned', 'booking.on_the_way', 'booking.completed']);

function canonicalType(value) {
  return TYPE_ALIASES[String(value || '').trim().toLowerCase()] || null;
}

function stableId(parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 32);
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function validIso(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function normalizeCrmEvent(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'event_not_an_object' };
  const type = canonicalType(raw.type || raw.event || raw.eventType || raw.status);
  if (!type) return { error: 'unsupported_event_type' };

  const booking = raw.booking && typeof raw.booking === 'object' ? raw.booking : {};
  const bookingId = booking.id || raw.bookingId || raw.booking_id || null;
  const bookingReference = booking.reference || raw.bookingReference || raw.reference || null;
  if (!bookingId && !bookingReference) return { error: 'booking_identifier_missing' };

  const technician = raw.technician && typeof raw.technician === 'object' ? raw.technician : {};
  const occurredAt = validIso(raw.occurredAt || raw.occurred_at || raw.timestamp) || null;
  return {
    id: String(raw.id || raw.eventId || raw.event_id || stableId([type, bookingId, bookingReference, occurredAt])),
    type,
    bookingId: bookingId ? String(bookingId) : null,
    bookingReference: bookingReference ? String(bookingReference) : null,
    occurredAt,
    technicianName: technician.name || raw.technicianName || raw.technician_name || null,
    eta: validIso(raw.eta || raw.estimatedArrival || raw.estimated_arrival),
    etaMinutes: positiveNumber(raw.etaMinutes || raw.eta_minutes),
  };
}

function isSupabaseBookingWebhook(body) {
  return !!body && body.table === 'bookings' && body.type === 'UPDATE' && body.record && typeof body.record === 'object';
}

// Translates one Supabase Database Webhook payload into zero or more events.
function eventsFromSupabaseWebhook(body) {
  const record = body.record;
  const previous = body.old_record || {};
  const events = [];
  const stamp = record.updated_at || record.completed_at || '';
  if (record.technician_id && record.technician_id !== previous.technician_id) {
    events.push({
      id: `supabase:${record.id}:assigned:${record.technician_id}`,
      type: 'booking.assigned',
      bookingId: String(record.id),
      bookingReference: record.reference || null,
      occurredAt: validIso(stamp),
      technicianId: String(record.technician_id),
      technicianName: null,
      eta: null,
      etaMinutes: null,
    });
  }
  if (record.status === 'completed' && previous.status !== 'completed') {
    events.push({
      id: `supabase:${record.id}:completed`,
      type: 'booking.completed',
      bookingId: String(record.id),
      bookingReference: record.reference || null,
      occurredAt: validIso(record.completed_at || stamp),
      technicianName: null,
      eta: null,
      etaMinutes: null,
    });
  }
  return events;
}

/**
 * @returns {{ events: object[], rejected: Array<{index: number, error: string}> }}
 */
function parseCrmEventBody(body) {
  if (isSupabaseBookingWebhook(body)) return { events: eventsFromSupabaseWebhook(body), rejected: [] };
  const list = Array.isArray(body) ? body : (body && Array.isArray(body.events) ? body.events : [body]);
  const events = [];
  const rejected = [];
  list.forEach((raw, index) => {
    const normalized = normalizeCrmEvent(raw);
    if (normalized.error) rejected.push({ index, error: normalized.error });
    else events.push(normalized);
  });
  return { events, rejected };
}

module.exports = { normalizeCrmEvent, parseCrmEventBody, SUPPORTED_TYPES };
