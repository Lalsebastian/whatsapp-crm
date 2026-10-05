import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mutateRows } from '../../src/lib/api/mutations.js';

function fakeClient(result = { data: [{ id: 'row-1' }], error: null }) {
  const calls = [];
  const builder = {
    update(values) { calls.push(['update', values]); return this; },
    eq(key, value) { calls.push(['eq', key, value]); return this; },
    in(key, value) { calls.push(['in', key, value]); return this; },
    is(key, value) { calls.push(['is', key, value]); return this; },
    select() { calls.push(['select']); return this; },
    single() { calls.push(['single']); return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return {
    calls,
    client: { from(table) { calls.push(['from', table]); return builder; } },
  };
}

for (const scenario of [
  ['booking status mutation', 'bookings', { status: 'confirmed' }],
  ['complaint status mutation', 'complaints', { status: 'resolved' }],
  ['escalation status mutation', 'escalations', { status: 'resolved' }],
  ['technician job mutation', 'bookings', { status: 'in_progress' }],
  ['safe assignment mutation', 'bookings', { technician_id: 'tech-1' }],
]) {
  test(scenario[0], async () => {
    const { client, calls } = fakeClient({ data: { id: 'row-1' }, error: null });
    await mutateRows(client, scenario[1], scenario[2], { id: 'row-1' }, { single: true });
    assert.deepEqual(calls, [
      ['from', scenario[1]],
      ['update', scenario[2]],
      ['eq', 'id', 'row-1'],
      ['select'],
      ['single'],
    ]);
  });
}

test('bulk status mutation uses one update with an IN filter', async () => {
  const { client, calls } = fakeClient();
  await mutateRows(client, 'bookings', { status: 'completed' }, { id: ['a', 'b'] });
  assert.deepEqual(calls, [
    ['from', 'bookings'],
    ['update', { status: 'completed' }],
    ['in', 'id', ['a', 'b']],
    ['select'],
  ]);
});

test('null mutation filters use IS rather than equality', async () => {
  const { client, calls } = fakeClient();
  await mutateRows(client, 'job_assignments', { unassigned_at: 'now' }, { unassigned_at: null });
  assert.deepEqual(calls[2], ['is', 'unassigned_at', null]);
});
