// Minimal, dependency-free date parsing for booking/reschedule steps.
// Returns 'YYYY-MM-DD' or null if the input isn't recognized.
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDateInput(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const today = new Date();

  if (t === 'today') return formatDate(today);
  if (t === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (t === 'day after tomorrow' || t === 'the day after tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const requestedWeekday = weekdays.findIndex((weekday) => t === weekday || t === `next ${weekday}`);
  if (requestedWeekday >= 0) {
    const daysAhead = (requestedWeekday - today.getDay() + 7) % 7 || 7;
    const d = new Date(today);
    d.setDate(d.getDate() + daysAhead);
    return formatDate(d);
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

function formatClockTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
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
  const range = raw.match(/^(\d{1,2}:\d{2})\s*(?:-|–|—)\s*(\d{1,2}:\d{2})$/);
  if (range) return `${formatClockTime(range[1])} – ${formatClockTime(range[2])}`;
  return formatClockTime(raw);
}

module.exports = { parseDateInput, formatDate, formatDateForCustomer, formatSlotForCustomer };
