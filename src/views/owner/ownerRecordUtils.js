import { formatPercent } from '@/lib/utils';

// Formatting helpers and status maps shared by the owner record views.

export function comparisonDelta(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return {
    label: `${value > 0 ? '+' : ''}${formatPercent(value)} vs previous period`,
    tone: value < 0 ? 'negative' : 'positive',
  };
}

export const STATUS_BAR_COLOR = {
  pending: 'var(--warning)',
  confirmed: 'var(--info)',
  in_progress: 'var(--accent)',
  completed: 'var(--success)',
  cancelled: 'var(--destructive)',
  rescheduled: 'var(--primary)',
};

export const ESCALATION_STATUS = {
  open: { label: 'Open', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export function humanise(value) {
  return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/*
 * Owner sub-modules
 *
 * Owners can see bookings, complaints and escalations but not act on them —
 * that is the agent's job. These are read-only views of the same overview
 * query rather than separate fetches, so the numbers cannot disagree.
 */

export function complaintAgeDays(complaint) {
  const start = new Date(complaint.created_at).getTime();
  const end = ['resolved', 'closed'].includes(complaint.status) && complaint.updated_at
    ? new Date(complaint.updated_at).getTime()
    : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 864e5));
}

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
