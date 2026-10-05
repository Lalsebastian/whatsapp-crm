// Targeted quick-reply actions ("RESCHEDULE_BOOKING:<id>", "BOOK_AGAIN:<serviceId>",
// …) work from anywhere in the conversation: a tap on an earlier message is
// an explicit request and takes priority over whatever step is active.
//
// The id in a payload is never trusted: every action re-reads the record from
// the CRM and checks it belongs to this customer before doing anything.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { ACTIONS, parseActionId } = require('../flows/quickActions');
const myBookings = require('../flows/myBookings');
const complaintStatus = require('../flows/complaintStatus');
const complaintUpdate = require('../flows/complaintUpdate');
const complaint = require('../flows/complaint');
const attachments = require('../flows/attachments');
const booking = require('../flows/booking');
const recovery = require('./bookingRecovery');

const crm = getCrmAdapter();

async function notFound(session, what) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(session.phone, `I couldn't find that ${what} on your account anymore. Here's what I can help with:`, [
    { id: 'MY_BOOKINGS', title: 'My Bookings' },
    { id: 'MAIN_MENU', title: 'Main Menu' },
  ]);
}

async function ownedBooking(customer, bookingId) {
  const record = await crm.getBookingById(bookingId);
  return record && myBookings.ownedBy(record, customer) ? record : null;
}

async function ownedComplaint(customer, complaintId) {
  const active = await crm.getActiveComplaints(customer.id, { limit: 10 });
  const found = (active || []).find((item) => String(item.id) === String(complaintId));
  return found && complaintStatus.ownedBy(found, customer) ? found : null;
}

// ADD_SERVICE:<serviceId|*>~<propertyId>~<date>
function parseAddService(id) {
  const [serviceId, propertyId, date] = String(id).split('~');
  return { serviceId: serviceId === '*' ? null : serviceId, propertyId: propertyId || null, date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null };
}

async function addServicePrefill(customer, propertyId, date) {
  if (!propertyId) return {};
  const properties = await crm.getCustomerProperties(customer.id);
  const property = (properties || []).find((item) => String(item.id) === String(propertyId));
  if (!property) return {};
  const place = [property.area, property.city].filter(Boolean).join(', ');
  return {
    propertyId: property.id,
    propertyLabel: property.label ? `${property.label}${place ? ` — ${place}` : ''}` : property.addressLine,
    ...(date ? { date } : {}),
  };
}

/**
 * @returns {Promise<object|null>} a router result, or null when the button is
 *   not a targeted action
 */
async function handleGlobalAction(session, customer, inbound) {
  const action = parseActionId(inbound.buttonId);
  if (!action || !customer) return null;
  logger.audit('QUICK_ACTION_SELECTED', { phone: session.phone, customerId: customer.id, action: action.kind, result: 'selected' });

  switch (action.kind) {
    case ACTIONS.VIEW_BOOKING: {
      const record = await ownedBooking(customer, action.id);
      if (!record) { await notFound(session, 'booking'); break; }
      await myBookings.showBookingDetails(session, customer, record);
      break;
    }
    case ACTIONS.RESCHEDULE_BOOKING: {
      const record = await ownedBooking(customer, action.id);
      if (!record) { await notFound(session, 'booking'); break; }
      await myBookings.startRescheduleForBooking(session, customer, record);
      break;
    }
    case ACTIONS.CANCEL_BOOKING: {
      const record = await ownedBooking(customer, action.id);
      if (!record) { await notFound(session, 'booking'); break; }
      await myBookings.startCancelForBooking(session, customer, record);
      break;
    }
    case ACTIONS.COMPLAINT_STATUS: {
      const record = await ownedComplaint(customer, action.id);
      if (!record) {
        // Closed complaints are no longer "active"; fall back to the normal lookup.
        await complaintStatus.promptForReference(session, customer);
        break;
      }
      await complaintStatus.showComplaintStatusFor(session, customer, record);
      break;
    }
    case ACTIONS.ADD_COMPLAINT_DETAILS: {
      const record = await ownedComplaint(customer, action.id);
      if (!record) { await notFound(session, 'open complaint'); break; }
      await complaintUpdate.startComplaintUpdate(session, customer, record);
      break;
    }
    case ACTIONS.BOOK_AGAIN:
      await booking.startBookingForService(session, customer, action.id, { source: 'book_again' });
      break;
    case ACTIONS.ADD_SERVICE: {
      const { serviceId, propertyId, date } = parseAddService(action.id);
      const prefill = await addServicePrefill(customer, propertyId, date);
      if (serviceId) {
        await booking.startBookingForService(session, customer, serviceId, { ...prefill, source: 'add_service' });
      } else {
        await booking.startBooking(session, customer, { buttonId: inbound.buttonId, prefill });
      }
      break;
    }
    case ACTIONS.ATTACH_MEDIA: {
      const media = attachments.parseMediaAction(action.id);
      const record = media && media.recordId ? await ownedComplaint(customer, media.recordId) : null;
      if (!record) { await notFound(session, 'open complaint'); break; }
      await complaintUpdate.startComplaintUpdate(session, customer, record, {
        attachments: [{ waMediaId: media.mediaId, mediaType: media.mediaType }],
      });
      break;
    }
    case ACTIONS.REPORT_WITH_MEDIA: {
      const media = attachments.parseMediaAction(action.id);
      if (!media) { await notFound(session, 'photo'); break; }
      const bookingRecord = media.recordId ? await ownedBooking(customer, media.recordId) : null;
      await complaint.startComplaintWithMedia(session, customer, {
        bookingId: bookingRecord ? bookingRecord.id : null,
        attachments: [{ waMediaId: media.mediaId, mediaType: media.mediaType }],
      });
      break;
    }
    case ACTIONS.RESUME_DRAFT:
      return recovery.resumeDraft(session, customer);
    case ACTIONS.DISCARD_DRAFT:
      return recovery.discardDraft(session, customer);
    default:
      return null;
  }
  return { reply: 'quick_action', action: action.kind };
}

module.exports = { handleGlobalAction, parseAddService };
