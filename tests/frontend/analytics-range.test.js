import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySeries, startOfRange } from '../../src/lib/analytics-range.js';

const NOW = new Date('2026-09-29T18:30:00.000Z');

for (const [range, days, expectedStart] of [
  ['7d', 7, '2026-09-23'],
  ['30d', 30, '2026-08-31'],
  ['90d', 90, '2026-07-02'],
]) {
  test(`${range} analytics covers exactly ${days} days without future buckets`, () => {
    assert.equal(startOfRange(range, NOW).slice(0, 10), expectedStart);
    const series = buildDailySeries([], range, NOW);
    assert.equal(series.length, days);
    assert.equal(series[0].date, expectedStart);
    assert.equal(series.at(-1).date, '2026-09-29');
  });
}

test('daily analytics preserves booking counts and completed revenue', () => {
  const series = buildDailySeries([
    { scheduled_date: '2026-09-29', status: 'completed', price: 250 },
    { created_at: '2026-09-29T10:00:00Z', status: 'pending', price: 100 },
  ], '7d', NOW);
  assert.deepEqual(series.at(-1), {
    date: '2026-09-29', revenue: 250, bookings: 2, completed: 1,
  });
});
