// Minimal, dependency-free date parsing for booking/reschedule steps.
// Returns 'YYYY-MM-DD' or null if the input isn't recognized.
function formatDate(d) {
  return d.toISOString().slice(0, 10);
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

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return null;
}

module.exports = { parseDateInput, formatDate };
