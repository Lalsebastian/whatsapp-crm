/*
 * CSV export.
 *
 * Values are quoted and internal quotes doubled per RFC 4180, because these
 * exports contain customer-entered complaint descriptions and addresses that
 * will contain commas, quotes and newlines. An unescaped description silently
 * shifts every column after it, which is the failure mode that makes people
 * distrust an export and go back to copy-pasting from the UI.
 */
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

/** Triggers a browser download. Synchronous so it works outside React events. */
export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  // A BOM makes Excel read the file as UTF-8; without it, non-ASCII customer
  // names open as mojibake. Written as an escape rather than a literal U+FEFF,
  // which is invisible in an editor and trips no-irregular-whitespace.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Filesystem-safe, sortable filename: bookings-2026-09-29.csv */
export function stamp(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}
