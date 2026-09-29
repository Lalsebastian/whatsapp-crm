import { supabase } from '@/lib/supabase';
import { addJobPhoto } from '@/lib/api/technicians';

/*
 * Field media uploads.
 *
 * Uploads are two-phase — bytes to Storage, then a row in job_photos — and the
 * failure mode that matters is a half-finished upload. A stored object with no
 * row is invisible but still costs storage and, worse, could later attach
 * itself to the wrong booking. So a failed row insert removes the object.
 */

const BUCKET = 'job-media';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export function buildPhotoPath(bookingId, technicianId, file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const safeBooking = String(bookingId).slice(0, 8);
  const safeTech = technicianId ? String(technicianId).slice(0, 8) : 'unassigned';
  return `bookings/${safeBooking}/${safeTech}/${stamp}.${ext}`;
}

export function validatePhoto(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Unsupported image type "${file.type || 'unknown'}". Use JPEG, PNG or WebP.`;
  }
  if (file.size > MAX_BYTES) {
    return `Photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 10MB.`;
  }
  return null;
}

/**
 * Uploads one photo and returns the created row. Throws on either half failing,
 * having cleaned up the stored object if the row insert is what failed.
 */
export async function uploadJobPhoto({ bookingId, technicianId, file, caption }) {
  const invalid = validatePhoto(file);
  if (invalid) throw new Error(invalid);

  const path = buildPhotoPath(bookingId, technicianId, file);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (uploadError) {
    throw new Error(`Photo upload failed: ${uploadError.message}`);
  }

  try {
    return await addJobPhoto({ bookingId, technicianId, storagePath: path, caption });
  } catch (error) {
    // Best-effort cleanup. If this also fails the object is orphaned, but it is
    // unreachable and costs nothing but storage, which beats failing the upload
    // the technician is waiting on.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
}

/** Public URL for a stored photo. The bucket is public, so no signing needed. */
export function photoUrl(storagePath) {
  if (!storagePath) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl ?? null;
}
