const DEFAULTS = {
  complaint: { normal: [1440, 4320], high: [480, 1440], urgent: [120, 480] },
  escalation: { normal: [60, 240], high: [30, 120], urgent: [15, 60] },
};

export function slaState(record, entityType, now = Date.now()) {
  if (!record?.created_at) return { state: 'unknown', label: 'No SLA', tone: 'neutral', elapsedMinutes: 0 };
  if (['resolved', 'closed', 'completed', 'cancelled'].includes(record.status)) {
    return { state: 'complete', label: 'SLA complete', tone: 'success', elapsedMinutes: 0 };
  }
  const priority = record.priority ?? 'normal';
  const [warning, breach] = DEFAULTS[entityType]?.[priority] ?? DEFAULTS[entityType]?.normal ?? [1440, 4320];
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(record.created_at).getTime()) / 60000));
  const remaining = breach - elapsedMinutes;
  if (remaining <= 0) return { state: 'breached', label: `${formatDuration(Math.abs(remaining))} overdue`, tone: 'destructive', elapsedMinutes };
  if (elapsedMinutes >= warning) return { state: 'warning', label: `${formatDuration(remaining)} remaining`, tone: 'warning', elapsedMinutes };
  return { state: 'healthy', label: `${formatDuration(remaining)} remaining`, tone: 'success', elapsedMinutes };
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)}h`;
  return `${Math.ceil(minutes / 1440)}d`;
}
