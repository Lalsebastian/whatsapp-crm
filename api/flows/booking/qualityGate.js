// Final booking gate: re-validates every item against the CRM immediately
// before the booking is written, because minutes can pass between choosing a
// slot and tapping Confirm.
//
//   customer identified · date valid (not past) · service still offered ·
//   address belongs to the customer · location serviceable · slot still
//   free · not a duplicate of an existing booking · required fields present
//
// A check is only failed on positive evidence. If a CRM read itself fails,
// that check is skipped and logged: the CRM's own create call validates again,
// and a flaky read must not stop a valid booking.
const logger = require('../../utils/logger');
const { todayInTimeZone, minutesNowInTimeZone } = require('../dateUtils');
const { normalizeSlots, findSlot, minutesOf } = require('../../crm/slots');

const ACTIVE = new Set(['pending', 'confirmed', 'rescheduled', 'technician_assigned', 'technician_on_the_way', 'in_progress']);

async function safely(check, phone, read) {
  try {
    return { value: await read() };
  } catch (error) {
    logger.warn('BOOKING_GATE', `${check} check skipped:`, error.code || error.message);
    logger.audit('BOOKING_GATE_CHECK_SKIPPED', { phone, check, reason: error.code || 'read_failed', result: 'skipped' });
    return { skipped: true };
  }
}

function fail(problem, index, extra = {}) {
  return { ok: false, problem, index, ...extra };
}

/**
 * @returns {Promise<{ok: true} | {ok: false, problem: string, index: number, existing?: object}>}
 */
async function checkBooking(crm, customer, cart, { phone, allowDuplicate = false } = {}) {
  if (!customer || !customer.id) return fail('customer_unidentified', 0);
  const today = todayInTimeZone();
  const nowMinutes = minutesNowInTimeZone();

  for (let index = 0; index < cart.length; index += 1) {
    const item = cart[index];
    if (!item.serviceId || !item.propertyId || !item.date || !item.time) return fail('missing_fields', index);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date < today) return fail('date_past', index);
    if (item.date === today && minutesOf(String(item.time).slice(0, 5)) <= nowMinutes) return fail('slot_passed', index);
    const twin = cart.findIndex((other, otherIndex) => otherIndex < index
      && other.serviceId === item.serviceId && other.date === item.date && other.time === item.time);
    if (twin >= 0) return fail('duplicate_in_cart', index);
  }

  const [services, properties, bookings] = await Promise.all([
    safely('service', phone, () => Promise.all(cart.map((item) => crm.getServiceDetails(item.serviceId)))),
    safely('property', phone, () => crm.getCustomerProperties(customer.id)),
    safely('duplicate', phone, () => crm.getBookings(customer.id, { limit: 10 })),
  ]);

  for (let index = 0; index < cart.length; index += 1) {
    const item = cart[index];
    if (!services.skipped && !services.value[index]) return fail('service_unavailable', index);
    if (!properties.skipped && !(properties.value || []).some((property) => String(property.id) === String(item.propertyId))) {
      return fail('property_not_found', index);
    }
    if (typeof crm.checkServiceability === 'function') {
      const serviceability = await safely('serviceability', phone, () => crm.checkServiceability(item.serviceId, { propertyId: item.propertyId, source: 'saved_property' }));
      if (!serviceability.skipped && serviceability.value && serviceability.value.serviceable === false) return fail('not_serviceable', index);
    }
    const availability = await safely('slot', phone, () => crm.getAvailability(item.serviceId, item.date));
    if (!availability.skipped) {
      const slots = normalizeSlots(availability.value, { date: item.date });
      // Match the CRM slot id when there is one, otherwise the start time
      // (some CRMs return plain times without ids).
      if (!(item.slotId && findSlot(slots, item.slotId)) && !findSlot(slots, item.time)) return fail('slot_unavailable', index);
    }
    if (!allowDuplicate && !bookings.skipped) {
      const existing = (bookings.value || []).find((booking) => ACTIVE.has(String(booking.status || '').toLowerCase())
        && String(booking.serviceId) === String(item.serviceId)
        && booking.scheduledDate === item.date);
      if (existing) return fail('duplicate_booking', index, { existing });
    }
  }
  return { ok: true };
}

module.exports = { checkBooking };
