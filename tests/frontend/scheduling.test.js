import { test } from 'vitest';
import assert from 'node:assert/strict';
import { findScheduleConflicts, recommendTechnicians } from '../../src/lib/scheduling.js';

const service = { duration_minutes: 60 };

test('dispatch conflict detection flags overlapping technician bookings', () => {
  const rows = [
    { id: 'a', technician_id: 'tech-1', scheduled_date: '2026-10-01', scheduled_time: '09:00', status: 'confirmed', service },
    { id: 'b', technician_id: 'tech-1', scheduled_date: '2026-10-01', scheduled_time: '09:30', status: 'pending', service },
    { id: 'c', technician_id: 'tech-2', scheduled_date: '2026-10-01', scheduled_time: '09:30', status: 'confirmed', service },
  ];
  const conflicts = findScheduleConflicts(rows);
  assert.equal(conflicts.get('a'), 'b');
  assert.equal(conflicts.get('b'), 'a');
  assert.equal(conflicts.has('c'), false);
});

test('technician recommendations prefer available lower-load technicians', () => {
  const target = { id: 'target', scheduled_date: '2026-10-01', scheduled_time: '09:00', status: 'pending', service };
  const existing = [{ id: 'busy', technician_id: 'tech-1', scheduled_date: '2026-10-01', scheduled_time: '09:00', status: 'confirmed', service }];
  const result = recommendTechnicians(target, [{ id: 'tech-1', name: 'Busy', active: true }, { id: 'tech-2', name: 'Available', active: true }], existing);
  assert.equal(result[0].id, 'tech-2');
  assert.equal(result[1].overlap, true);
});
