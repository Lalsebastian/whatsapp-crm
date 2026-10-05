import { test } from 'vitest';
import assert from 'node:assert/strict';
import { localDateKey } from '../../src/lib/utils.js';

test('localDateKey uses the local calendar day, not the UTC one', () => {
  // 01:30 local time on 5 October: toISOString() would still say 4 October
  // in any timezone ahead of UTC (e.g. Dubai, UTC+4).
  const earlyMorning = new Date(2026, 9, 5, 1, 30);
  assert.equal(localDateKey(earlyMorning), '2026-10-05');
});

test('localDateKey offsets across month and year boundaries', () => {
  assert.equal(localDateKey(new Date(2026, 9, 31, 12), 1), '2026-11-01');
  assert.equal(localDateKey(new Date(2026, 0, 1, 12), -1), '2025-12-31');
  assert.equal(localDateKey(new Date(2026, 1, 28, 12), 6), '2026-03-06');
});
