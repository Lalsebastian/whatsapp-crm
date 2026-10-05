

// Status maps and helpers shared by the agent workspace views.

export function humanise(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export const BOOKING_STATUS_OPTIONS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
};

export const ESCALATION_STATUS_OPTIONS = {
  open: { label: 'Open', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export function recordNavigation(rows, detail, setDetail) {
  if (!detail || rows.length < 2) return null;
  const index = rows.findIndex((row) => row.id === detail.id);
  if (index < 0) return null;
  return {
    label: `${index + 1} of ${rows.length}`,
    hasPrevious: index > 0,
    hasNext: index < rows.length - 1,
    onPrevious: () => index > 0 && setDetail(rows[index - 1]),
    onNext: () => index < rows.length - 1 && setDetail(rows[index + 1]),
  };
}
