import { fetchRows, insertRow, select, unwrap, updateRow, updateRows } from '@/lib/api/client';

/*
 * Query keys live in one file so invalidation from Realtime can be exact.
 *
 * A key of ['bookings', 'list', { status: 'open' }] means an update to one
 * booking can invalidate ['bookings', 'list'] (the board), ['bookings', 'detail',
 * id] (the open record) and ['bookings', 'kpis'] (the tiles) without any of
 * them knowing the other exists.
 */

export const queryKeys = {
  bookings: {
    all: ['bookings'],
    lists: () => ['bookings', 'list'],
    list: (filters) => ['bookings', 'list', filters ?? {}],
    details: () => ['bookings', 'detail'],
    detail: (id) => ['bookings', 'detail', id],
    kpis: (range) => ['bookings', 'kpis', range ?? null],
  },
  complaints: {
    all: ['complaints'],
    lists: () => ['complaints', 'list'],
    list: (filters) => ['complaints', 'list', filters ?? {}],
    detail: (id) => ['complaints', 'detail', id],
  },
  messages: {
    all: ['messages'],
    lists: () => ['messages', 'list'],
    list: (filters) => ['messages', 'list', filters ?? {}],
  },
  escalations: {
    all: ['escalations'],
    list: (filters) => ['escalations', 'list', filters ?? {}],
  },
  sessions: {
    all: ['sessions'],
    list: (phone) => ['sessions', phone ?? null],
  },
  services: {
    all: ['services'],
    list: (activeOnly) => ['services', activeOnly ?? null],
  },
  customers: {
    all: ['customers'],
    list: () => ['customers', 'list'],
  },
  technicians: {
    all: ['technicians'],
    list: () => ['technicians', 'list'],
  },
  jobs: {
    all: ['jobs'],
    photos: (bookingId) => ['jobs', 'photos', bookingId ?? null],
    signatures: (bookingId) => ['jobs', 'signatures', bookingId ?? null],
  },
  analytics: {
    all: ['analytics'],
    overview: (range) => ['analytics', 'overview', range ?? null],
  },
  surveys: {
    all: ['surveys'],
    list: (filters) => ['surveys', 'list', filters ?? {}],
  },
};

/*
 * Bookings
 *
 * Joins pull in the service name and customer phone because every booking list
 * shows them; fetching them separately would turn one query into N+1 per row.
 */

const BOOKING_COLUMNS =
  '*, service:services(id, name, category), customer:customers(id, name, phone)';

export async function listBookings(filters = {}) {
  const { orderBy = 'scheduled_date', ascending = false, ...where } = filters;
  const rows = await fetchRows('bookings', {
    columns: BOOKING_COLUMNS,
    filters: where,
    order: { column: orderBy, ascending },
  });
  return rows ?? [];
}

export async function getBooking(id) {
  return unwrap(await select('bookings', BOOKING_COLUMNS).eq('id', id).maybeSingle(), 'get booking');
}

export async function getBookingsByIds(ids) {
  if (!ids?.length) return [];
  const rows = await fetchRows('bookings', { columns: BOOKING_COLUMNS, filters: { id: ids } });
  return rows ?? [];
}

/**
 * Bulk status change. Returns the updated rows so React Query can seed the
 * cache without a round trip; the invalidate still runs so anything filtered
 * out of this response refetches.
 */
export async function updateBookingStatuses(ids, patch) {
  if (!ids?.length) return [];
  return updateRows('bookings', patch, { id: ids });
}

export async function createBookingRecord(values) {
  return insertRow('bookings', values);
}

export async function updateBooking(id, patch) {
  return updateRow('bookings', patch, { id });
}

/*
 * Complaints
 */

const COMPLAINT_COLUMNS =
  '*, customer:customers(id, name, phone), booking:bookings(id, reference, scheduled_date)';

export async function listComplaints(filters = {}) {
  const { orderBy = 'created_at', ascending = false, ...where } = filters;
  const rows = await fetchRows('complaints', {
    columns: COMPLAINT_COLUMNS,
    filters: where,
    order: { column: orderBy, ascending },
  });
  return rows ?? [];
}

export async function getComplaint(id) {
  return unwrap(await select('complaints', COMPLAINT_COLUMNS).eq('id', id).maybeSingle(), 'get complaint');
}

export async function updateComplaint(id, patch) {
  return updateRow('complaints', patch, { id });
}

export async function updateComplaintStatuses(ids, patch) {
  if (!ids?.length) return [];
  return updateRows('complaints', patch, { id: ids });
}

/*
 * Messages — the Inbox is read-only, so there is deliberately no write path.
 * Replies happen in the WhatsApp Business app until an authenticated send API
 * exists; adding a POST here without one would be a dead control.
 */

export async function listMessages({ phone, since, limit = 200 } = {}) {
  const filters = {};
  if (phone) filters.phone = phone;
  if (since) filters.created_at = since;

  const rows = await fetchRows('messages', {
    columns: '*',
    filters,
    order: { column: 'created_at', ascending: false },
    limit,
  });
  return rows ?? [];
}

export async function listRecentMessages(limit = 50) {
  const rows = await fetchRows('messages', {
    columns: '*',
    order: { column: 'created_at', ascending: false },
    limit,
  });
  return rows ?? [];
}

/** Phone numbers with at least one message, most recent first. */
export async function listConversationPhones(limit = 200) {
  const rows = await fetchRows('messages', {
    columns: 'phone, created_at',
    order: { column: 'created_at', ascending: false },
    limit,
  });
  const latest = new Map();
  for (const row of rows ?? []) {
    if (!latest.has(row.phone)) latest.set(row.phone, row.created_at);
  }
  return [...latest.entries()]
    .map(([phone, lastActivityAt]) => ({ phone, lastActivityAt }))
    .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
}

/*
 * Sessions — conversation state per phone.
 */

export async function getSession(phone) {
  return unwrap(await select('sessions').eq('phone', phone).maybeSingle(), 'get session');
}

export async function listSessions() {
  const rows = await fetchRows('sessions', {
    order: { column: 'last_activity_at', ascending: false },
    limit: 200,
  });
  return rows ?? [];
}

/*
 * Escalations
 */

export async function listEscalations(filters = {}) {
  const rows = await fetchRows('escalations', {
    columns: '*, customer:customers(id, name, phone)',
    filters,
    order: { column: 'created_at', ascending: false },
  });
  return rows ?? [];
}

export async function updateEscalation(id, patch) {
  return updateRow('escalations', patch, { id });
}

/*
 * Reference data
 */

export async function listServices({ activeOnly = true } = {}) {
  const rows = await fetchRows('services', {
    filters: activeOnly ? { active: true } : {},
    order: { column: 'name', ascending: true },
  });
  return rows ?? [];
}

export async function listCustomers() {
  const rows = await fetchRows('customers', { order: { column: 'name', ascending: true } });
  return rows ?? [];
}
