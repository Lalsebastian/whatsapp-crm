import { fetchRows } from '@/lib/api/client';
import { buildDailySeries, startOfRange } from '@/lib/analytics-range';

/*
 * Owner-dashboard metrics.
 *
 * Every KPI is computed from rows the anon key can already read, rather than
 * from a Postgres view or RPC. That is deliberate: a view would need its own
 * migration, its own RLS story and a service-role key to expose, and the row
 * counts here are small enough that fetching and reducing in JS is not the
 * bottleneck. If these tables ever grow past a few hundred thousand rows this is
 * the file to move server-side — which is why it is isolated.
 */

function inRange(value, from) {
  if (!from) return true;
  return new Date(value) >= new Date(from);
}

function sum(rows, pick) {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

function groupCount(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] ?? 'unknown';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getOverview({ range = '30d' } = {}) {
  const from = startOfRange(range);

  const [bookings, complaints, surveysResult, eventsResult, techniciansResult] = await Promise.all([
    fetchRows('bookings', { columns: '*, service:services(id, duration_minutes)', order: { column: 'created_at', ascending: false } }),
    fetchRows('complaints', { columns: '*', order: { column: 'created_at', ascending: false } }),
    optionalRows('satisfaction_surveys', { columns: '*', order: { column: 'asked_at', ascending: false } }),
    optionalRows('conversation_events', { columns: '*', order: { column: 'created_at', ascending: false } }),
    optionalRows('technicians', { columns: '*' }),
  ]);

  const surveys = surveysResult.rows;
  const events = eventsResult.rows;
  const technicians = techniciansResult.rows;
  const warnings = [surveysResult, eventsResult, techniciansResult]
    .filter((result) => result.error)
    .map((result) => result.error);

  const scopedBookings = (bookings ?? []).filter((b) => inRange(b.created_at, from));
  const scopedComplaints = (complaints ?? []).filter((c) => inRange(c.created_at, from));
  const scopedEvents = (events ?? []).filter((e) => inRange(e.created_at, from));
  const scopedSurveys = (surveys ?? []).filter((s) => inRange(s.asked_at, from));

  const completed = scopedBookings.filter((b) => b.status === 'completed');
  const cancelled = scopedBookings.filter((b) => b.status === 'cancelled');
  const revenue = sum(completed, (b) => b.price);

  // Conversion is distinct phones, not event counts: one customer who taps
  // through five screens still counts as one conversion, otherwise the rate is
  // inflated by the most engaged customers.
  const distinctPhones = (event) =>
    new Set(scopedEvents.filter((e) => e.event === event).map((e) => e.phone)).size;

  const started = distinctPhones('conversation_started');
  const confirmed = distinctPhones('booking_confirmed');

  const answered = scopedSurveys.filter((s) => s.rating != null);
  const unanswered = scopedSurveys.filter((s) => s.rating == null && s.sent_at);

  return {
    range,
    from,
    warnings,
    kpis: {
      revenue,
      bookings: scopedBookings.length,
      completed: completed.length,
      cancelled: cancelled.length,
      avgTicket: completed.length ? revenue / completed.length : 0,
      completionRate: scopedBookings.length ? completed.length / scopedBookings.length : 0,
      complaints: scopedComplaints.length,
      openComplaints: scopedComplaints.filter((c) => c.status === 'open').length,
      escalatedComplaints: scopedComplaints.filter((c) => c.status === 'escalated').length,
      conversionRate: started ? confirmed / started : null,
      conversations: started,
      csat: answered.length ? sum(answered, (s) => s.rating) / answered.length : null,
      csatResponses: answered.length,
      csatPending: unanswered.length,
    },
    series: {
      bookingsByStatus: groupCount(scopedBookings, 'status'),
      complaintsByStatus: groupCount(scopedComplaints, 'status'),
      complaintsByCategory: groupCount(scopedComplaints, 'category'),
      funnel: {
        conversation_started: started,
        service_selected: distinctPhones('service_selected'),
        booking_confirmed: confirmed,
        complaint_submitted: distinctPhones('complaint_submitted'),
      },
    },
    utilisation: await getUtilisation({ from, technicians: technicians ?? [], bookings: bookings ?? [] }),
    daily: buildDailySeries(scopedBookings, range),
  };
}

async function optionalRows(table, options) {
  try {
    return { rows: (await fetchRows(table, options)) ?? [], error: null };
  } catch (error) {
    return { rows: [], error: `${table}: ${error.message}` };
  }
}

/**
 * Revenue over time. Bookings with no scheduled date are bucketed by creation
 * date instead of being dropped, otherwise unscheduled work silently vanishes
 * from the chart and revenue stops reconciling with the KPI tile.
 */
/**
 * Technician utilisation = assigned job minutes / available shift minutes.
 *
 * Denominator is each technician's weekly capacity scaled to the range, so the
 * number means the same thing whether the user is looking at 7 days or 90.
 */
export async function getUtilisation({ from, technicians, bookings }) {
  const active = technicians.filter((t) => t.active !== false);
  if (!active.length) return { technicians: [], overall: null };

  const days = from ? Math.max(1, Math.ceil((Date.now() - new Date(from)) / 864e5)) : 30;
  const weeks = days / 7;

  const rows = active.map((tech) => {
    const assigned = (bookings ?? []).filter(
      (b) => b.technician_id === tech.id && inRange(b.created_at ?? b.scheduled_date, from)
    );

    const capacity = (tech.weekly_capacity_minutes ?? 2400) * weeks;
    const booked = sum(assigned, (b) => {
      if (b.status === 'cancelled') return 0;
      const minutes = b.service?.duration_minutes ?? 60;
      return minutes;
    });

    return {
      technicianId: tech.id,
      name: tech.name,
      jobs: assigned.length,
      completed: assigned.filter((b) => b.status === 'completed').length,
      bookedMinutes: Math.round(booked),
      capacityMinutes: Math.round(capacity),
      utilisation: capacity ? booked / capacity : null,
    };
  });

  const totalBooked = sum(rows, (r) => r.bookedMinutes);
  const totalCapacity = sum(rows, (r) => r.capacityMinutes);

  return {
    technicians: rows.sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0)),
    overall: totalCapacity ? totalBooked / totalCapacity : null,
  };
}

export async function getServiceMix({ range = '30d' } = {}) {
  const from = startOfRange(range);
  const bookings = await fetchRows('bookings', {
    columns: '*, service:services(id, name, category)',
    order: { column: 'created_at', ascending: false },
  });

  const scoped = (bookings ?? []).filter((b) => inRange(b.created_at, from) && b.status === 'completed');
  const byService = new Map();

  for (const booking of scoped) {
    const name = booking.service?.name ?? 'Unassigned';
    const entry = byService.get(name) ?? { label: name, count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += Number(booking.price) || 0;
    byService.set(name, entry);
  }

  return [...byService.values()].sort((a, b) => b.count - a.count);
}
