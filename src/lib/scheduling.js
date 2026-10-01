const ACTIVE = new Set(['pending', 'confirmed', 'in_progress', 'rescheduled']);

export function bookingWindow(booking) {
  if (!booking?.scheduled_date) return null;
  const time = booking.scheduled_time?.slice(0, 5) ?? '09:00';
  const start = new Date(`${booking.scheduled_date}T${time}:00`).getTime();
  if (!Number.isFinite(start)) return null;
  const duration = Number(booking.service?.duration_minutes) || 60;
  return { start, end: start + duration * 60000, duration };
}

export function findScheduleConflicts(bookings) {
  const groups = new Map();
  for (const booking of bookings.filter((item) => item.technician_id && ACTIVE.has(item.status))) {
    const list = groups.get(booking.technician_id) ?? [];
    list.push(booking);
    groups.set(booking.technician_id, list);
  }
  const conflicts = new Map();
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (bookingWindow(a)?.start ?? 0) - (bookingWindow(b)?.start ?? 0));
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = bookingWindow(sorted[index]);
      const next = bookingWindow(sorted[index + 1]);
      if (current && next && current.end > next.start) {
        conflicts.set(sorted[index].id, sorted[index + 1].id);
        conflicts.set(sorted[index + 1].id, sorted[index].id);
      }
    }
  }
  return conflicts;
}

export function recommendTechnicians(booking, technicians, bookings) {
  const target = bookingWindow(booking);
  return technicians.filter((tech) => tech.active !== false).map((tech) => {
    const assigned = bookings.filter((item) => item.technician_id === tech.id && item.scheduled_date === booking.scheduled_date && item.id !== booking.id && ACTIVE.has(item.status));
    const overlap = target && assigned.some((item) => { const window = bookingWindow(item); return window && window.start < target.end && window.end > target.start; });
    const minutes = assigned.reduce((total, item) => total + (bookingWindow(item)?.duration ?? 60), 0);
    const score = Math.max(0, 100 - assigned.length * 12 - Math.round(minutes / 30) - (overlap ? 60 : 0));
    return { ...tech, score, assigned: assigned.length, overlap, bookedMinutes: minutes };
  }).sort((a, b) => b.score - a.score);
}

export function addressLabel(property) {
  return property ? [property.label, property.address_line, property.area, property.city].filter(Boolean).join(', ') : 'Address pending';
}
