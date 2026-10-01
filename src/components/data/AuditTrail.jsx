import { useQuery } from '@tanstack/react-query';
import { History, UserRound } from 'lucide-react';
import { listActivityLog } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export function AuditTrail({ entityType, entityId }) {
  const activity = useQuery({
    queryKey: ['activity-log', entityType, entityId],
    queryFn: () => listActivityLog(entityType, entityId),
    enabled: Boolean(entityType && entityId),
    retry: false,
  });
  if (!activity.data?.available || !activity.data.rows.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><History className="size-4 text-info dark:text-primary" /> Verified activity</div>
      <ol className="space-y-2">
        {activity.data.rows.map((item) => (
          <li key={item.id} className="rounded-xl border border-border/70 bg-muted/25 p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize">{item.action} {item.entity_type}</span><span className="text-muted-foreground text-[10px]">{formatDateTime(item.created_at)}</span></div>
            <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs"><UserRound className="size-3" />{item.actor_label ?? 'System automation'}</div>
            {Object.keys(item.changed_fields ?? {}).length ? <div className="mt-2 flex flex-wrap gap-1">{Object.keys(item.changed_fields).slice(0, 6).map((field) => <span key={field} className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">{field.replaceAll('_', ' ')}</span>)}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
