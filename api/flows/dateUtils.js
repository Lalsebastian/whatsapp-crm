// Minimal, dependency-free date parsing for booking/reschedule steps.
// Returns 'YYYY-MM-DD' or null if the input isn't recognized.
//
// Relative dates ("today", "tomorrow", "friday") are resolved in the
// business timezone, not the server's: Render runs in UTC, so between
// 00:00 and 04:00 in Dubai a UTC "today" would still be yesterday.
const env = require('../config/env');

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// 'YYYY-MM-DD' for the calendar day `now` falls on in `timeZone`.
function todayInTimeZone(now = new Date(), timeZone = env.BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Minutes since local midnight for `now` in `timeZone`.
function minutesNowInTimeZone(now = new Date(), timeZone = env.BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return get('hour') * 60 + get('minute');
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return formatDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function weekdayIndex(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function parseDateInput(text, { now = new Date(), timeZone = env.BUSINESS_TIMEZONE } = {}) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const today = todayInTimeZone(now, timeZone);

  if (t === 'today') return today;
  if (t === 'tomorrow') return addDays(today, 1);
  if (t === 'day after tomorrow' || t === 'the day after tomorrow') return addDays(today, 2);

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const requestedWeekday = weekdays.findIndex((weekday) => t === weekday || t === `next ${weekday}`);
  if (requestedWeekday >= 0) {
    const daysAhead = (requestedWeekday - weekdayIndex(today) + 7) % 7 || 7;
    return addDays(today, daysAhead);
  }

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidDateParts(year, month, day)
      ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      : null;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidDateParts(year, month, day)
      ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
      : null;
  }

  return null;
}

function formatDateForCustomer(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || 'Date not available';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const formatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  return formatted.replace(/^(\S+)\s/, '$1, ');
}

// Accepts "HH:MM" and Postgres-style "HH:MM:SS".
function formatClockTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return String(value || '');
  const hours = Number(match[1]);
  const minutes = match[2];
  if (hours > 23) return String(value);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

function formatSlotForCustomer(slot) {
  const raw = String(slot || '').trim();
  const range = raw.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—)\s*(\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (range) return `${formatClockTime(range[1])} – ${formatClockTime(range[2])}`;
  return formatClockTime(raw);
}

module.exports = {
  parseDateInput,
  formatDate,
  formatDateForCustomer,
  formatSlotForCustomer,
  todayInTimeZone,
  minutesNowInTimeZone,
  addDays,
};
