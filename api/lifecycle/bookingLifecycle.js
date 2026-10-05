// Booking lifecycle events from the CRM: technician assigned, technician on
// the way, job completed.
//
// Rules this module enforces:
//   * The CRM record is the source of truth. The event only says *which*
//     booking changed; booking, customer and phone are re-read from the CRM,
//     and "completed" is only acted on if the CRM booking says completed.
//   * Each event id is processed once (chatbot_crm_events), so CRM retries
//     never message a customer twice.
//   * Work runs under the same per-customer lock as inbound messages, so a
//     notification never interleaves with the customer's own conversation.
//   * Technician names and ETAs are only ever what the CRM sent.
//   * Outside WhatsApp's 24-hour window only approved templates are sent.
const env = require('../config/env');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const sessionStore = require('../session/sessionStore');
const whatsapp = require('../whatsapp/client');
const feedback = require('../flows/feedback');
const notifier = require('../notifications/customerNotifier');
const { withKeyLock } = require('../reliability/keyedLock');
const { runWithRequestContext } = require('../reliability/requestContext');
const { formatDateForCustomer, formatSlotForCustomer } = require('../flows/dateUtils');

const crm = getCrmAdapter();
const processedInMemory = new Map();
const MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueViolation(error) {
  const status = error && error.response && error.response.status;
  const code = error && error.response && error.response.data && error.response.data.code;
  return status === 409 || code === '23505';
}

// Durable once-only claim per event id; process-local fallback when the
// table is not deployed yet.
async function claimEvent(event) {
  try {
    await db.insert('chatbot_crm_events', {
      event_id: event.id,
      event_type: event.type,
      booking_id: event.bookingId || event.bookingReference,
      status: 'processing',
    }, { returnRepresentation: false });
    return { claimed: true, durable: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { claimed: false, durable: true };
    logger.warn('LIFECYCLE', 'Durable event claim unavailable; using process-local dedupe:', error.message);
    const now = Date.now();
    for (const [id, at] of processedInMemory) if (now - at > MEMORY_TTL_MS) processedInMemory.delete(id);
    if (processedInMemory.has(event.id)) return { claimed: false, durable: false };
    processedInMemory.set(event.id, now);
    return { claimed: true, durable: false };
  }
}

async function finishEvent(event, claim, outcome) {
  if (!claim.durable) return;
  try {
    await db.patch('chatbot_crm_events', `event_id=eq.${encodeURIComponent(event.id)}`, {
      status: outcome.status,
      reason: outcome.reason || null,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn('LIFECYCLE', 'Failed to record event outcome:', error.message);
  }
}

// A transient failure must let the CRM's retry through again.
async function releaseEvent(event, claim) {
  if (!claim.durable) {
    processedInMemory.delete(event.id);
    return;
  }
  try {
    await db.remove('chatbot_crm_events', `event_id=eq.${encodeURIComponent(event.id)}`);
  } catch (error) {
    logger.warn('LIFECYCLE', 'Failed to release event claim:', error.message);
  }
}

async function loadBooking(event) {
  if (event.bookingId) return crm.getBookingById(event.bookingId);
  return crm.getBookingStatus(event.bookingReference);
}

async function technicianNameFor(event) {
  if (event.technicianName) return event.technicianName;
  // Supabase dashboard events carry only technician_id; resolve it from the
  // same database. Other CRMs send the name in the event.
  if (!event.technicianId || env.CRM_PROVIDER !== 'supabase') return null;
  try {
    const rows = await db.get('technicians', `id=eq.${encodeURIComponent(event.technicianId)}&select=name&limit=1`);
    return (rows && rows[0] && rows[0].name) || null;
  } catch {
    return null;
  }
}

function etaText(event) {
  if (event.eta) {
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: env.BUSINESS_TIMEZONE, hour: 'numeric', minute: '2-digit',
    }).format(new Date(event.eta));
    return `around ${time}`;
  }
  if (event.etaMinutes) return `in about ${event.etaMinutes} minute${event.etaMinutes === 1 ? '' : 's'}`;
  return null;
}

function firstName(customer) {
  return customer && customer.name ? String(customer.name).trim().split(/\s+/)[0] : '';
}

async function notifyAssigned({ event, booking, customer, serviceName }) {
  const technician = await technicianNameFor(event);
  const date = formatDateForCustomer(booking.scheduledDate);
  const time = formatSlotForCustomer(String(booking.scheduledTime || '').slice(0, 5));
  const greeting = firstName(customer) ? `Good news, ${firstName(customer)}!` : 'Good news!';
  const text = `${greeting} ${technician ? `${technician} has been assigned` : 'A technician has been assigned'} to your ${serviceName} booking (${booking.reference}) on ${date} at ${time}. We'll message you here when they're on the way.`;
  return notifier.deliver({
    phone: customer.phone,
    kind: 'booking_assigned',
    sendSession: () => whatsapp.sendText(customer.phone, text),
    template: env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED ? {
      name: env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED,
      bodyParams: [firstName(customer) || 'there', technician || 'Our technician', serviceName, date, time, booking.reference],
      summary: text,
    } : null,
  });
}

async function notifyOnTheWay({ event, booking, customer, serviceName }) {
  const technician = await technicianNameFor(event);
  const eta = etaText(event);
  const text = `${technician || 'Your technician'} is on the way for your ${serviceName} booking (${booking.reference}).${eta ? ` Estimated arrival: ${eta}.` : ''}`;
  return notifier.deliver({
    phone: customer.phone,
    kind: 'technician_on_the_way',
    sendSession: () => whatsapp.sendText(customer.phone, text),
    template: env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY ? {
      name: env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY,
      bodyParams: [technician || 'Your technician', serviceName, booking.reference, eta || 'shortly'],
      summary: text,
    } : null,
  });
}

async function requestFeedback({ booking, customer }) {
  const session = await sessionStore.getOrCreateSession(customer.phone);
  if (session.humanTakeover) return { status: 'skipped', reason: 'human_takeover_active' };
  // Never hijack a conversation the customer is in the middle of (e.g. a new
  // booking). They can still rate the job later with "rate my service".
  if (session.currentFlow && session.currentStep && !sessionStore.isExpired(session)) {
    logger.audit('FEEDBACK_REQUEST_DEFERRED', { phone: customer.phone, bookingId: booking.id, flow: session.currentFlow, result: 'deferred' });
    return { status: 'skipped', reason: 'customer_in_active_flow' };
  }
  const outcome = await feedback.onBookingCompleted({
    session,
    customer,
    booking,
    flowTtlMinutes: env.FEEDBACK_REQUEST_TTL_HOURS * 60,
    deliver: (prompt) => notifier.deliver({
      phone: customer.phone,
      kind: 'feedback_request',
      sendSession: () => whatsapp.sendButtons(customer.phone, prompt.body, prompt.buttons),
      template: env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST ? {
        name: env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST,
        bodyParams: [prompt.customerName || 'there', prompt.serviceName || 'recent'],
        quickReplyPayloads: prompt.buttons.map((button) => button.id),
        summary: prompt.body,
      } : null,
    }),
  });
  return outcome && outcome.started
    ? { status: 'processed' }
    : { status: 'skipped', reason: (outcome && outcome.reason) || 'feedback_not_started' };
}

async function handleForCustomer(event, booking, customer) {
  const service = booking.serviceId ? await crm.getServiceDetails(booking.serviceId) : null;
  const serviceName = (service && service.name) || 'service';
  if (event.type === 'booking.assigned') {
    const result = await notifyAssigned({ event, booking, customer, serviceName });
    return result.delivered ? { status: 'processed' } : { status: 'skipped', reason: result.reason };
  }
  if (event.type === 'booking.on_the_way') {
    const result = await notifyOnTheWay({ event, booking, customer, serviceName });
    return result.delivered ? { status: 'processed' } : { status: 'skipped', reason: result.reason };
  }
  if (String(booking.status || '').toLowerCase() !== 'completed') {
    return { status: 'skipped', reason: 'crm_booking_not_completed' };
  }
  return requestFeedback({ booking, customer });
}

/**
 * @returns {Promise<{status: 'processed'|'skipped'|'duplicate', reason?: string}>}
 */
async function processLifecycleEvent(event) {
  const claim = await claimEvent(event);
  if (!claim.claimed) {
    logger.audit('CRM_EVENT_DUPLICATE', { eventType: event.type, result: 'ignored' });
    return { status: 'duplicate' };
  }
  try {
    const booking = await loadBooking(event);
    let outcome;
    if (!booking) {
      outcome = { status: 'skipped', reason: 'booking_not_found' };
    } else if (['cancelled', 'canceled'].includes(String(booking.status || '').toLowerCase())) {
      outcome = { status: 'skipped', reason: 'booking_cancelled' };
    } else {
      const customer = booking.customerId ? await crm.getCustomerById(booking.customerId) : null;
      if (!customer || !customer.phone) {
        outcome = { status: 'skipped', reason: 'customer_phone_unavailable' };
      } else {
        outcome = await runWithRequestContext(
          { correlationId: `crm-event:${event.id}`, phone: customer.phone },
          () => withKeyLock(customer.phone, () => handleForCustomer(event, booking, customer))
        );
      }
    }
    logger.audit('CRM_EVENT_PROCESSED', {
      eventType: event.type,
      bookingId: booking && booking.id,
      result: outcome.status,
      reason: outcome.reason,
    });
    await finishEvent(event, claim, outcome);
    return outcome;
  } catch (error) {
    logger.error('LIFECYCLE', `Failed to process ${event.type}:`, error.message);
    await releaseEvent(event, claim);
    throw error;
  }
}

function clearForTests() {
  processedInMemory.clear();
}

module.exports = { processLifecycleEvent, etaText, clearForTests };
