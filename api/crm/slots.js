// Structured appointment slots.
//
// Adapters may return availability either as legacy strings ("09:00",
// "09:00-11:00") or as slot objects. Everything downstream works on the
// normalized object below, so the booking flow never has to care which CRM
// produced it.
//
// @typedef {Object} Slot
// @property {string} id         Stable id used in button payloads (CRM slot id, or "HH:MM")
// @property {string} start      Local business start time, "HH:MM"
// @property {string|null} end   Local business end time, "HH:MM"
// @property {string|null} startsAt  ISO-8601 instant with offset
// @property {string|null} endsAt
// @property {string|null} timezone  IANA zone the local times are expressed in
// @property {string} label      Customer-facing text, e.g. "9:00 AM – 11:00 AM"
const env = require('../config/env');
const { formatSlotForCustomer } = require('../flows/dateUtils');

const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

function toHHMM(value) {
  const match = String(value || '').trim().match(TIME_RE);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function minutesOf(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

function addMinutes(hhmm, minutes) {
  const total = minutesOf(hhmm) + minutes;
  if (total >= 24 * 60) return null; // a slot never spills past midnight
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// "+04:00" for the zone's UTC offset on that calendar date.
function offsetFor(date, timeZone) {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day, 12));
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((item) => item.type === 'timeZoneName');
    const match = part && part.value.match(/GMT([+-]\d{2}:\d{2})?/);
    if (!match) return null;
    return match[1] || '+00:00';
  } catch {
    return null;
  }
}

function isoAt(date, hhmm, timeZone) {
  if (!date || !hhmm || !timeZone) return null;
  const offset = offsetFor(date, timeZone);
  return offset ? `${date}T${hhmm}:00${offset}` : null;
}

function labelFor(start, end) {
  return formatSlotForCustomer(end ? `${start}-${end}` : start);
}

/**
 * @param {string|object} raw
 * @param {{date?: string, timeZone?: string, durationMinutes?: number}} [context]
 * @returns {import('./slots').Slot|null}
 */
function normalizeSlot(raw, { date, timeZone = env.BUSINESS_TIMEZONE, durationMinutes } = {}) {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'string' || typeof raw === 'number') {
    const text = String(raw).trim();
    const range = text.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—)\s*(\d{1,2}:\d{2}(?::\d{2})?)$/);
    const start = toHHMM(range ? range[1] : text);
    if (!start) return null;
    const end = range ? toHHMM(range[2]) : (durationMinutes ? addMinutes(start, durationMinutes) : null);
    return {
      id: start,
      start,
      end,
      startsAt: isoAt(date, start, timeZone),
      endsAt: end ? isoAt(date, end, timeZone) : null,
      timezone: date ? timeZone : null,
      label: labelFor(start, end),
    };
  }

  if (typeof raw === 'object') {
    const zone = raw.timezone || raw.timeZone || timeZone;
    const start = toHHMM(raw.start || raw.startTime || raw.time);
    if (!start) return null;
    const end = toHHMM(raw.end || raw.endTime)
      || (durationMinutes ? addMinutes(start, durationMinutes) : null);
    return {
      id: String(raw.id || raw.slotId || start),
      start,
      end,
      startsAt: raw.startsAt || isoAt(raw.date || date, start, zone),
      endsAt: raw.endsAt || (end ? isoAt(raw.date || date, end, zone) : null),
      timezone: zone || null,
      label: raw.label || labelFor(start, end),
    };
  }
  return null;
}

function normalizeSlots(rawSlots, context) {
  const seen = new Set();
  const slots = [];
  for (const raw of Array.isArray(rawSlots) ? rawSlots : []) {
    const slot = normalizeSlot(raw, context);
    if (slot && !seen.has(slot.id)) {
      seen.add(slot.id);
      slots.push(slot);
    }
  }
  return slots.sort((left, right) => minutesOf(left.start) - minutesOf(right.start));
}

// Finds the slot a button id ("SLOT_<id>") or a stored time refers to.
function findSlot(slots, idOrTime) {
  const wanted = String(idOrTime || '');
  return (slots || []).find((slot) => slot.id === wanted)
    || (slots || []).find((slot) => slot.start === toHHMM(wanted))
    || null;
}

module.exports = { normalizeSlot, normalizeSlots, findSlot, toHHMM, addMinutes, minutesOf, isoAt };
