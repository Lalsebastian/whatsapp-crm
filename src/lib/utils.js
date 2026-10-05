import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

/** Tailwind-aware class merge. Later classes win over earlier conflicting ones. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function toDate(value) {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  return isValid(date) ? date : null;
}

const AED = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  maximumFractionDigits: 0,
});

/**
 * Local calendar date as YYYY-MM-DD, `offsetDays` from `date`. Use this for
 * "today" comparisons against scheduled_date: toISOString() returns the UTC
 * date, which in Dubai is still yesterday until 04:00.
 */
export function localDateKey(date = new Date(), offsetDays = 0) {
  const day = new Date(date);
  day.setDate(day.getDate() + offsetDays);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return AED.format(n);
}

/** Compact money for KPI tiles: 12.4k / 1.2M rather than 1,240,000. */
export function formatCompactCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `AED ${(n / 1_000).toFixed(1)}k`;
  return AED.format(n);
}

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-AE').format(n);
}

export function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDate(value, pattern = 'dd MMM yyyy') {
  const date = toDate(value);
  return date ? format(date, pattern) : '—';
}

export function formatDateTime(value) {
  return formatDate(value, 'dd MMM yyyy, HH:mm');
}

/** "5m ago" style. Used across tables and the inbox. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function toDateInput(value) {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}

export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** `+971501234567` -> `+971 50 123 4567`, for readable phone display. */
export function formatPhone(phone) {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 8) return phone;
  return `+${digits.slice(0, digits.length - 8)} ${digits.slice(-8, -6)} ${digits.slice(-6, -4)} ${digits.slice(-4)}`;
}
