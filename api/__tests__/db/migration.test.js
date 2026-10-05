// Applies api/db/schema.sql and the chatbot reliability migration to a real
// Postgres engine (PGlite, in-process) and exercises every database function
// the backend calls. Catches SQL errors and semantic regressions that the
// mocked unit tests cannot.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(__dirname, '../../..');
const schemaSql = readFileSync(path.join(root, 'api/db/schema.sql'), 'utf8')
  // gen_random_uuid() is built into Postgres 13+; PGlite ships without the
  // pgcrypto extension the script enables for older projects.
  .replace('create extension if not exists pgcrypto;', '');
const migrationSql = readFileSync(
  path.join(root, 'supabase/migrations/202610040001_chatbot_reliability_lifecycle.sql'),
  'utf8'
);

let db;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(schemaSql);
  await db.exec(migrationSql);
}, 60000);

describe('chatbot reliability migration (real Postgres)', () => {
  it('is idempotent: re-running it changes nothing and does not fail', async () => {
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
  });

  it('chatbot_try_lock grants one owner at a time, renews, releases and expires', async () => {
    const tryLock = async (owner) => (await one(`select public.chatbot_try_lock('lock-a', $1, 30000) as r`, [owner])).r;
    expect(await tryLock('A')).toBe(true);
    expect(await tryLock('B')).toBe(false);
    expect(await tryLock('A')).toBe(true);
    await db.query(`select public.chatbot_release_lock('lock-a', 'B')`);
    expect(await tryLock('B')).toBe(false);
    await db.query(`select public.chatbot_release_lock('lock-a', 'A')`);
    expect(await tryLock('B')).toBe(true);
    await db.query(`update public.chatbot_locks set expires_at = now() - interval '1 second' where lock_key = 'lock-a'`);
    expect(await tryLock('C')).toBe(true);
  });

  it('chatbot_record_message_timestamp flags only older messages', async () => {
    const stale = async (ts) => (await one(`select public.chatbot_record_message_timestamp('9715', $1) as r`, [ts])).r;
    expect([await stale(200), await stale(100), await stale(300), await stale(250)]).toEqual([false, true, false, true]);
  });

  it('chatbot_claim_action enforces single ownership and turns abandoned claims uncertain', async () => {
    const claim = (key, owner, staleMs = 120000) => one('select * from public.chatbot_claim_action($1, $2, $3)', [key, owner, staleMs]);
    expect(await claim('act-1', 'A')).toEqual({ claimed: true, state: 'pending', result: null });
    expect(await claim('act-1', 'B')).toEqual({ claimed: false, state: 'pending', result: null });
    await db.query(`select public.chatbot_complete_action('act-1', 'B', 'succeeded', '{"x":1}'::jsonb)`);
    expect((await claim('act-1', 'B')).state).toBe('pending');
    await db.query(`select public.chatbot_complete_action('act-1', 'A', 'succeeded', '{"id":"b1"}'::jsonb)`);
    expect(await claim('act-1', 'B')).toEqual({ claimed: false, state: 'succeeded', result: { id: 'b1' } });

    await claim('act-2', 'A');
    await db.query(`select public.chatbot_release_action('act-2', 'A')`);
    expect((await claim('act-2', 'B')).claimed).toBe(true);

    await claim('act-3', 'A');
    await db.query(`update public.chatbot_action_claims set updated_at = now() - interval '10 minutes' where action_key = 'act-3'`);
    expect((await claim('act-3', 'B', 60000)).state).toBe('uncertain');
  });

  describe('chatbot_create_bookings', () => {
    let customer;
    let otherCustomer;
    let property;
    let otherProperty;
    let services;

    const create = (customerId, items, key = null) => all(
      'select * from public.chatbot_create_bookings($1, $2::jsonb, $3)',
      [customerId, JSON.stringify(items), key]
    );
    const bookingCount = async () => (await one('select count(*)::int as n from public.bookings')).n;

    beforeAll(async () => {
      customer = (await one(`insert into public.customers (phone) values ('971500') returning id`)).id;
      otherCustomer = (await one(`insert into public.customers (phone) values ('971511') returning id`)).id;
      property = (await one(`insert into public.properties (customer_id, address_line) values ($1, 'Villa 1') returning id`, [customer])).id;
      otherProperty = (await one(`insert into public.properties (customer_id, address_line) values ($1, 'Villa 9') returning id`, [otherCustomer])).id;
      services = (await all('select id from public.services order by name')).map((row) => row.id);
    });

    it('creates every item in order with BK- references', async () => {
      const created = await create(customer, [
        { property_id: property, service_id: services[0], scheduled_date: '2030-01-10', scheduled_time: '09:00', notes: 'tap' },
        { property_id: property, service_id: services[1], scheduled_date: '2030-01-10', scheduled_time: '11:00' },
      ], 'key-1');
      expect(created.map((row) => row.service_id)).toEqual([services[0], services[1]]);
      expect(created[0].reference).toMatch(/^BK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(created.map((row) => [row.status, row.notes])).toEqual([['confirmed', 'tap'], ['confirmed', null]]);
    });

    it('replays an idempotency key instead of booking again', async () => {
      const before = await bookingCount();
      const replay = await create(customer, [
        { property_id: property, service_id: services[0], scheduled_date: '2030-01-10', scheduled_time: '09:00' },
      ], 'key-1');
      expect(replay).toHaveLength(2);
      expect(await bookingCount()).toBe(before);
    });

    it('is all-or-nothing: a conflict on the second item rolls back the first', async () => {
      const before = await bookingCount();
      await expect(create(customer, [
        { property_id: property, service_id: services[1], scheduled_date: '2030-01-11', scheduled_time: '09:00' },
        { property_id: property, service_id: services[0], scheduled_date: '2030-01-10', scheduled_time: '09:00' },
      ], 'key-2')).rejects.toThrow('SLOT_UNAVAILABLE:2');
      expect(await bookingCount()).toBe(before);
      expect((await one(`select count(*)::int as n from public.chatbot_booking_requests where idempotency_key = 'key-2'`)).n).toBe(0);
    });

    it('rejects another customer\'s property, inactive services, empty carts and duplicate slots in one cart', async () => {
      await expect(create(customer, [{ property_id: otherProperty, service_id: services[0], scheduled_date: '2030-01-12', scheduled_time: '09:00' }]))
        .rejects.toThrow('INVALID_PROPERTY:1');
      await db.query('update public.services set active = false where id = $1', [services[2]]);
      await expect(create(customer, [{ property_id: property, service_id: services[2], scheduled_date: '2030-01-12', scheduled_time: '09:00' }]))
        .rejects.toThrow('INVALID_SERVICE:1');
      await expect(create(customer, [])).rejects.toThrow('INVALID_ITEMS');
      await expect(create(customer, [
        { property_id: property, service_id: services[0], scheduled_date: '2030-01-13', scheduled_time: '09:00' },
        { property_id: property, service_id: services[0], scheduled_date: '2030-01-13', scheduled_time: '09:00' },
      ])).rejects.toThrow('SLOT_UNAVAILABLE:2');
    });

    it('frees a slot when its booking is cancelled', async () => {
      await db.query(`update public.bookings set status = 'cancelled' where scheduled_date = '2030-01-10' and scheduled_time = '09:00'`);
      await expect(create(customer, [{ property_id: property, service_id: services[0], scheduled_date: '2030-01-10', scheduled_time: '09:00' }]))
        .resolves.toHaveLength(1);
    });

    it('never returns another customer\'s bookings for a reused idempotency key', async () => {
      await expect(create(otherCustomer, [
        { property_id: otherProperty, service_id: services[0], scheduled_date: '2030-01-20', scheduled_time: '09:00' },
      ], 'key-1')).rejects.toThrow(/duplicate key/);
    });
  });

  it('stores geocoded coordinates on properties', async () => {
    const customer = (await one(`insert into public.customers (phone) values ('971522') returning id`)).id;
    await expect(db.query(
      `insert into public.properties (customer_id, address_line, latitude, longitude, location_source, place_id)
       values ($1, 'Pin', 25.08, 55.14, 'whatsapp_location', 'ChIJ')`,
      [customer]
    )).resolves.toBeDefined();
  });

  it('dedupes CRM events by id', async () => {
    await db.query(`insert into public.chatbot_crm_events (event_id, event_type) values ('evt-1', 'booking.completed')`);
    await expect(db.query(`insert into public.chatbot_crm_events (event_id, event_type) values ('evt-1', 'booking.completed')`))
      .rejects.toThrow(/duplicate key/);
  });

  it('chatbot_apply_retention removes only expired voice data and bookkeeping', async () => {
    const customer = (await one(`insert into public.customers (phone) values ('971533') returning id`)).id;
    await db.query(`insert into public.messages (phone, type, content, direction, created_at) values
      ('971533', 'audio', 'old transcript', 'inbound', now() - interval '100 days'),
      ('971533', 'audio', 'new transcript', 'inbound', now() - interval '1 day'),
      ('971533', 'text', 'old text', 'inbound', now() - interval '100 days')`);
    await db.query(`insert into public.media_attachments (customer_id, wa_media_id, media_type, created_at) values
      ($1, 'm-old', 'audio', now() - interval '40 days'),
      ($1, 'm-new', 'audio', now()),
      ($1, 'img-old', 'image', now() - interval '40 days')`, [customer]);

    const result = (await one('select public.chatbot_apply_retention(90, 30, 30) as r')).r;

    expect(result.transcriptsRedacted).toBe(1);
    expect(result.voiceMediaDeleted).toBe(1);
    const contents = (await all(`select content from public.messages where phone = '971533' order by created_at`)).map((row) => row.content);
    expect(contents).toEqual(['[voice note transcript removed under retention policy]', 'old text', 'new transcript']);
    const media = (await all('select wa_media_id from public.media_attachments where customer_id = $1 order by wa_media_id', [customer]))
      .map((row) => row.wa_media_id);
    expect(media).toEqual(['img-old', 'm-new']);
    expect((await one('select public.chatbot_apply_retention(90, 30, 30) as r')).r.transcriptsRedacted).toBe(0);
    await expect(db.query('select public.chatbot_apply_retention(0, 30, 30)')).rejects.toThrow('INVALID_RETENTION_WINDOW');
  });

  it('keeps the new tables and functions out of reach of the browser key', async () => {
    expect(await one(`select
      has_function_privilege('anon', 'public.chatbot_create_bookings(uuid, jsonb, text)', 'execute') as anon_exec,
      has_function_privilege('service_role', 'public.chatbot_create_bookings(uuid, jsonb, text)', 'execute') as service_exec,
      has_table_privilege('anon', 'public.chatbot_locks', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.chatbot_action_claims', 'insert') as authenticated_insert,
      has_table_privilege('service_role', 'public.chatbot_locks', 'delete') as service_delete`))
      .toEqual({ anon_exec: false, service_exec: true, anon_select: false, authenticated_insert: false, service_delete: true });
  });
});
