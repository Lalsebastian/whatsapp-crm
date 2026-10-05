// Cross-instance coordination with the postgres backend. db.rpc is replaced
// with a tiny in-memory model of the SQL functions in the reliability
// migration, so two "instances" (owners) can be simulated in one process.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = require('../../db/supabaseClient');
const coordination = require('../../reliability/coordinationStore');
const keyedLock = require('../../reliability/keyedLock');
const messageOrder = require('../../router/messageOrder');
const actionGuard = require('../../reliability/actionGuard');

const originalRpc = db.rpc;
const originalGet = db.get;

function missingFunction() {
  return Object.assign(new Error('Not Found'), { response: { status: 404, data: { code: 'PGRST202' } } });
}

// In-memory stand-in for the database functions.
function fakeDatabase() {
  const locks = new Map();
  const order = new Map();
  const claims = new Map();
  return {
    locks,
    claims,
    rpc: vi.fn(async (fn, args) => {
      if (fn === 'chatbot_try_lock') {
        const held = locks.get(args.p_key);
        if (!held || held.expiresAt < Date.now() || held.owner === args.p_owner) {
          locks.set(args.p_key, { owner: args.p_owner, expiresAt: Date.now() + args.p_ttl_ms });
          return true;
        }
        return false;
      }
      if (fn === 'chatbot_release_lock') {
        if (locks.get(args.p_key) && locks.get(args.p_key).owner === args.p_owner) locks.delete(args.p_key);
        return null;
      }
      if (fn === 'chatbot_record_message_timestamp') {
        const newest = order.get(args.p_phone);
        if (newest !== undefined && args.p_timestamp < newest) return true;
        order.set(args.p_phone, Math.max(newest || 0, args.p_timestamp));
        return false;
      }
      if (fn === 'chatbot_claim_action') {
        const existing = claims.get(args.p_key);
        if (!existing) {
          claims.set(args.p_key, { state: 'pending', owner: args.p_owner, result: null });
          return [{ claimed: true, state: 'pending', result: null }];
        }
        return [{ claimed: false, state: existing.state, result: existing.result }];
      }
      if (fn === 'chatbot_complete_action') {
        const existing = claims.get(args.p_key);
        if (existing && existing.owner === args.p_owner) Object.assign(existing, { state: args.p_state, result: args.p_result });
        return null;
      }
      if (fn === 'chatbot_release_action') {
        const existing = claims.get(args.p_key);
        if (existing && existing.owner === args.p_owner && existing.state === 'pending') claims.delete(args.p_key);
        return null;
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
    get: vi.fn(async (table, query) => {
      const key = decodeURIComponent(query.match(/action_key=eq\.([^&]+)/)[1]);
      const claim = claims.get(key);
      return claim ? [{ state: claim.state, result: claim.result }] : [];
    }),
  };
}

let database;

beforeEach(() => {
  database = fakeDatabase();
  db.rpc = database.rpc;
  db.get = database.get;
  coordination.setBackendForTests('postgres');
  keyedLock.clearForTests();
  messageOrder.clearForTests();
  actionGuard.clearForTests();
});

afterEach(() => {
  db.rpc = originalRpc;
  db.get = originalGet;
  coordination.setBackendForTests(null);
});

describe('distributed conversation lock', () => {
  it('holds a lease while processing and releases it afterwards', async () => {
    let heldDuring = false;
    await keyedLock.withKeyLock('971500', async () => {
      heldDuring = database.locks.has('conversation:971500');
    });
    expect(heldDuring).toBe(true);
    expect(database.locks.has('conversation:971500')).toBe(false);
  });

  it('waits for another instance that holds the same customer, then proceeds', async () => {
    database.locks.set('conversation:971500', { owner: 'other-instance', expiresAt: Date.now() + 60000 });
    setTimeout(() => database.locks.delete('conversation:971500'), 200);

    const startedAt = Date.now();
    await keyedLock.withKeyLock('971500', async () => {});

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  });

  it('takes over a lease whose holder crashed (expired)', async () => {
    database.locks.set('conversation:971500', { owner: 'crashed-instance', expiresAt: Date.now() - 1 });
    const operation = vi.fn(async () => 'done');
    await expect(keyedLock.withKeyLock('971500', operation)).resolves.toBe('done');
  });

  it('still processes the message (in-process lock only) when the lock function is missing', async () => {
    database.rpc.mockImplementation(async () => { throw missingFunction(); });
    await expect(keyedLock.withKeyLock('971500', async () => 'ok')).resolves.toBe('ok');
  });

  it('serializes one customer\'s messages inside a single instance', async () => {
    const order = [];
    await Promise.all([
      keyedLock.withKeyLock('971500', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('first'); }),
      keyedLock.withKeyLock('971500', async () => { order.push('second'); }),
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('shared message ordering', () => {
  it('detects a stale message even when the newer one was handled by another instance', async () => {
    await messageOrder.isClearlyStale('971500', 200);
    messageOrder.clearForTests(); // a different instance has no local memory
    await expect(messageOrder.isClearlyStale('971500', 100)).resolves.toBe(true);
    await expect(messageOrder.isClearlyStale('971500', 300)).resolves.toBe(false);
  });

  it('falls back to local ordering when the database is unavailable', async () => {
    database.rpc.mockRejectedValue(new Error('network down'));
    await messageOrder.isClearlyStale('971500', 200);
    await expect(messageOrder.isClearlyStale('971500', 100)).resolves.toBe(true);
  });
});

describe('durable action idempotency', () => {
  it('returns the stored result when another instance already completed the action', async () => {
    const operation = vi.fn(async () => ({ id: 'b1', reference: 'BK-ONCE11' }));
    const first = await actionGuard.executeOnce('booking:c1:n1:a1', operation);
    actionGuard.clearForTests(); // simulate another instance / a restart

    const second = await actionGuard.executeOnce('booking:c1:n1:a1', operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: { id: 'b1', reference: 'BK-ONCE11' }, duplicate: false });
    expect(second).toEqual({ value: { id: 'b1', reference: 'BK-ONCE11' }, duplicate: true });
  });

  it('never re-runs an action whose outcome was recorded as uncertain', async () => {
    const timeout = Object.assign(new Error('timed out'), { uncertain: true });
    await expect(actionGuard.executeOnce('booking:c1:n2:a1', async () => { throw timeout; })).rejects.toBe(timeout);
    actionGuard.clearForTests();

    const retry = vi.fn();
    await expect(actionGuard.executeOnce('booking:c1:n2:a1', retry)).rejects.toMatchObject({ uncertain: true, duplicateBlocked: true });
    expect(retry).not.toHaveBeenCalled();
  });

  it('releases the claim after a definite failure so the customer can retry', async () => {
    await expect(actionGuard.executeOnce('booking:c1:n3:a1', async () => { throw new Error('400 invalid'); })).rejects.toThrow('400 invalid');
    actionGuard.clearForTests();

    await expect(actionGuard.executeOnce('booking:c1:n3:a1', async () => 'ok')).resolves.toEqual({ value: 'ok', duplicate: false });
  });

  it('blocks a duplicate while the first instance is still writing, without writing twice', async () => {
    database.claims.set('booking:c1:n4:a1', { state: 'pending', owner: 'other-instance', result: null });
    setTimeout(() => Object.assign(database.claims.get('booking:c1:n4:a1'), { state: 'succeeded', result: { id: 'b9' } }), 300);
    const operation = vi.fn();

    await expect(actionGuard.executeOnce('booking:c1:n4:a1', operation)).resolves.toEqual({ value: { id: 'b9' }, duplicate: true });
    expect(operation).not.toHaveBeenCalled();
  });

  it('degrades to in-process protection when the claim function is missing', async () => {
    database.rpc.mockImplementation(async () => { throw missingFunction(); });
    const operation = vi.fn(async () => 'created');
    const [first, second] = await Promise.all([
      actionGuard.executeOnce('booking:c1:n5:a1', operation),
      actionGuard.executeOnce('booking:c1:n5:a1', operation),
    ]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect([first.duplicate, second.duplicate]).toEqual([false, true]);
  });
});
