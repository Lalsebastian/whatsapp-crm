/*
 * Single source of truth for every status the app renders.
 *
 * StatusBadge, the Kanban column headers and the booking-volume chart all read
 * from here, so a status can't be amber in one view and blue in another. The
 * `tone` values resolve to the semantic CSS variables defined in index.css.
 */

export const TONE_CLASS = {
  neutral: 'bg-neutral-status/12 text-neutral-status ring-1 ring-inset ring-neutral-status/25',
  success: 'bg-success/12 text-success ring-1 ring-inset ring-success/25',
  warning: 'bg-warning/14 text-warning ring-1 ring-inset ring-warning/30',
  info: 'bg-info/12 text-info ring-1 ring-inset ring-info/25',
  accent: 'bg-accent/12 text-accent ring-1 ring-inset ring-accent/25',
  primary: 'bg-primary/14 text-primary ring-1 ring-inset ring-primary/30',
  destructive: 'bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/25',
};

export const BOOKING_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  in_progress: { label: 'In Progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'destructive' },
  rescheduled: { label: 'Rescheduled', tone: 'primary' },
};

export const COMPLAINT_STATUS = {
  open: { label: 'Open', tone: 'warning' },
  in_progress: { label: 'In Progress', tone: 'accent' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  escalated: { label: 'Escalated', tone: 'destructive' },
};

export const BOOKING_STATUSES = Object.keys(BOOKING_STATUS);
export const COMPLAINT_STATUSES = Object.keys(COMPLAINT_STATUS);

export const PRIORITY = {
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'destructive' },
};

export const PRIORITIES = Object.keys(PRIORITY);

/** Jobs with these statuses still count as active field work. */
export const ACTIVE_JOB_STATUSES = ['pending', 'confirmed', 'in_progress'];

export const JOB_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  in_progress: { label: 'In Progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'destructive' },
  rescheduled: { label: 'Rescheduled', tone: 'primary' },
};

export function bookingStatus(value) {
  return BOOKING_STATUS[value] ?? { label: value ?? 'Unknown', tone: 'neutral' };
}

export function complaintStatus(value) {
  return COMPLAINT_STATUS[value] ?? { label: value ?? 'Unknown', tone: 'neutral' };
}

export function priorityStatus(value) {
  return PRIORITY[value] ?? PRIORITY.normal;
}

export function jobStatus(value) {
  return JOB_STATUS[value] ?? { label: value ?? 'Unknown', tone: 'neutral' };
}
