import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildCustomerSegments, findDataQualityIssues } from '../../src/lib/control-centre.js';

test('control centre derives useful customer segments from behaviour', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    const customers = [{ id: 'c1', name: 'Maya', created_at: '2026-09-20T00:00:00Z' }];
    const bookings = [
      { customer_id: 'c1', status: 'completed', price: 600, created_at: '2026-09-22T00:00:00Z' },
      { customer_id: 'c1', status: 'completed', price: 700, created_at: '2026-09-25T00:00:00Z' },
    ];
    const result = buildCustomerSegments(customers, bookings, [], now)[0];
    assert.deepEqual(result.segments, ['VIP', 'Recurring', 'New']);
    assert.equal(result.lifetimeValue, 1300);
});

test('control centre creates a repair queue without flagging finished work as unassigned', () => {
    const issues = findDataQualityIssues({
      customers: [{ id: 'c1', name: '', phone: '+971500000000' }],
      bookings: [
        { id: 'b1', reference: 'JB-1', status: 'pending', service_id: 's1', customer_id: 'c1', scheduled_date: null },
        { id: 'b2', reference: 'JB-2', status: 'completed', service_id: 's1', customer_id: 'c1', scheduled_date: '2026-09-20' },
      ],
    });
    assert.deepEqual(issues.map((issue) => issue.issue), ['Missing customer name', 'Missing schedule date', 'No technician assigned']);
});
