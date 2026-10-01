export const CHATBOT_ANALYTICS_RANGES = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export function analyticsContentState({ data, isLoading, error, hasCredential }) {
  if (!hasCredential) return 'locked';
  if (isLoading) return 'loading';
  if (error) return 'error';
  if (!data || data.totals?.events === 0) return 'empty';
  return 'ready';
}

export function humaniseAnalyticsLabel(value) {
  if (!value) return 'Unknown';
  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatLatency(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(milliseconds >= 10000 ? 1 : 2)}s`;
  return `${Math.round(milliseconds)}ms`;
}
