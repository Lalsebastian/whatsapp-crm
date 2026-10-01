import { fetchRows, insertRow, select, unwrap, updateRow } from '@/lib/api/client';

/*
 * Technicians, jobs and field-ops media.
 *
 * The technician view is mobile-first and offline-ish: a technician on a roof
 * has one bar of signal. Every write here is scoped to a single booking so a
 * failed upload never rolls back the job status change that preceded it.
 */

export async function listTechnicians({ activeOnly = true } = {}) {
  const rows = await fetchRows('technicians', {
    filters: activeOnly ? { active: true } : {},
    order: { column: 'name', ascending: true },
  });
  return rows ?? [];
}

export async function createTechnician(values) {
  return insertRow('technicians', values);
}

export async function updateTechnician(id, patch) {
  return updateRow('technicians', patch, { id });
}

/**
 * Jobs assigned to one technician. `start`/`end` are inclusive ISO dates; the
 * schedule view passes a range and "My Jobs" passes today.
 */
export async function listTechnicianJobs({ technicianId, start, end, statuses } = {}) {
  let query = select(
    'bookings',
    '*, service:services(id, name, category, duration_minutes), customer:customers(id, name, phone), property:properties(id, label, address_line, area, city), technician:technicians(id, name, phone)'
  ).eq('technician_id', technicianId);

  if (Array.isArray(statuses) && statuses.length) query = query.in('status', statuses);
  if (start) query = query.gte('scheduled_date', start);
  if (end) query = query.lte('scheduled_date', end);

  return unwrap(await query.order('scheduled_date', { ascending: true }), 'list technician jobs');
}

export async function getJob(bookingId) {
  return unwrap(
    await select(
      'bookings',
      '*, service:services(id, name, category, duration_minutes), customer:customers(id, name, phone), property:properties(id, label, address_line, area, city), technician:technicians(id, name, phone)'
    )
      .eq('id', bookingId)
      .maybeSingle(),
    'get job'
  );
}

export async function updateJobStatus(bookingId, status, extra = {}) {
  const patch = { status, ...extra };
  if (status === 'in_progress' && !extra.started_at) patch.started_at = new Date().toISOString();
  if (status === 'completed' && !extra.completed_at) patch.completed_at = new Date().toISOString();

  return updateRow('bookings', patch, { id: bookingId });
}

/*
 * Assignment
 */

export async function assignTechnician(bookingId, technicianId, assignedBy) {
  // Updating both bookings and job_assignments cannot be atomic from two
  // browser PostgREST requests. Until a database RPC exists, update only the
  // canonical booking field so a failed second request cannot leave assignment
  // history disagreeing with the job. `assignedBy` is accepted for API parity.
  void assignedBy;
  return updateRow('bookings', { technician_id: technicianId }, { id: bookingId });
}

export async function listAssignments(bookingId) {
  const rows = await fetchRows('job_assignments', {
    columns: '*, technician:technicians(id, name)',
    filters: { booking_id: bookingId },
    order: { column: 'assigned_at', ascending: false },
  });
  return rows ?? [];
}

/*
 * Field media
 */

export async function listJobPhotos(bookingId) {
  const rows = await fetchRows('job_photos', {
    filters: { booking_id: bookingId },
    order: { column: 'created_at', ascending: false },
  });
  return rows ?? [];
}

/**
 * Records the photo after the browser has uploaded the bytes to the
 * `job-media` bucket. Storage is handled separately in `uploadJobPhoto` so the
 * rollback can delete the orphaned object when the row insert fails.
 */
export async function addJobPhoto({ bookingId, technicianId, storagePath, caption }) {
  return insertRow('job_photos', {
    booking_id: bookingId,
    technician_id: technicianId ?? null,
    storage_path: storagePath,
    caption: caption ?? null,
  });
}

export async function listJobSignatures(bookingId) {
  const rows = await fetchRows('job_signatures', {
    filters: { booking_id: bookingId },
    order: { column: 'created_at', ascending: false },
  });
  return rows ?? [];
}

export async function addJobSignature({ bookingId, technicianId, signerName, signatureData }) {
  return insertRow('job_signatures', {
    booking_id: bookingId,
    technician_id: technicianId ?? null,
    signer_name: signerName ?? null,
    signature_data: signatureData,
  });
}
