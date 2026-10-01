import { Timer } from 'lucide-react';
import { slaState } from '@/lib/sla';
import { StatusBadge } from '@/components/data/StatusBadge';

export function SlaBadge({ record, entityType, showIcon = true }) {
  const sla = slaState(record, entityType);
  return <StatusBadge tone={sla.tone}>{showIcon ? <Timer className="size-3" /> : null}{sla.label}</StatusBadge>;
}
