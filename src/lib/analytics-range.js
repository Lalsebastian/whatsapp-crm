export function rangeDays(range) {
  if (range === 'all') return null;
  return { '7d': 7, '30d': 30, '90d': 90 }[range] ?? 30;
}

export function startOfRange(range, nowValue = new Date()) {
  const now = new Date(nowValue);
  if (range === 'all') return null;
  const days = rangeDays(range);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);
  return from.toISOString();
}

export function buildDailySeries(bookings, range, nowValue = new Date()) {
  const days = rangeDays(range) ?? 30;
  const buckets = new Map();
  const start = new Date(startOfRange(`${days}d`, nowValue));

  for (let index = 0; index < days; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    buckets.set(date, { date, revenue: 0, bookings: 0, completed: 0 });
  }

  for (const booking of bookings) {
    const raw = booking.scheduled_date ?? booking.created_at;
    if (!raw) continue;
    const bucket = buckets.get(String(raw).slice(0, 10));
    if (!bucket) continue;
    bucket.bookings += 1;
    if (booking.status === 'completed') {
      bucket.completed += 1;
      bucket.revenue += Number(booking.price) || 0;
    }
  }

  return [...buckets.values()];
}
