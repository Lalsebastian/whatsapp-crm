import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listComplaints, updateComplaint, updateComplaintStatuses } from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { formatDate, formatPhone } from '@/lib/utils';
import { COMPLAINT_STATUSES, complaintStatus } from '@/lib/status';
import { downloadCsv, stamp } from '@/lib/csv';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel } from '@/components/layout/Panel';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { FilterBar } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { KanbanBoard } from '@/components/data/KanbanBoard';
import { Button } from '@/components/ui/button';
import { ComplaintDetail } from '@/views/agent/AgentRecordDetails';
import { humanise } from '@/views/agent/agentRecordUtils';

export function AgentBoard() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [detail, setDetail] = useState(null);

  useLiveUpdates(['complaints']);

  const complaints = useQuery({
    queryKey: ['complaints', 'board'],
    queryFn: () => listComplaints({}),
  });

  const supportsComplaintPriority = (complaints.data ?? []).some((item) =>
    Object.prototype.hasOwnProperty.call(item, 'priority')
  );

  const move = useMutation({
    mutationFn: ({ id, status }) => updateComplaint(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['complaints'] });
      const previous = queryClient.getQueryData(['complaints', 'board']);
      queryClient.setQueryData(['complaints', 'board'], (old) =>
        (old ?? []).map((c) => (c.id === id ? { ...c, status } : c))
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(['complaints', 'board'], ctx?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['complaints'] }),
  });

  const bulk = useBulkComplaintAction(() => setSelectedIds([]));

  if (complaints.isError) {
    return (
      <ViewShell title="Board" scroll={false}>
        <ErrorState error={complaints.error} onRetry={complaints.refetch} />
      </ViewShell>
    );
  }

  const rows = (complaints.data ?? []).filter((c) => {
    if (category !== 'all' && c.category !== category) return false;
    if (supportsComplaintPriority && priority !== 'all' && (c.priority ?? 'normal') !== priority) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      c.reference?.toLowerCase().includes(needle) ||
      c.description?.toLowerCase().includes(needle) ||
      c.customer?.phone?.includes(needle)
    );
  });

  const cardsByColumn = {};
  for (const columnId of COMPLAINT_STATUSES) cardsByColumn[columnId] = [];
  for (const complaint of rows) {
    const bucket = cardsByColumn[complaint.status] ?? cardsByColumn.open;
    bucket.push({
      id: complaint.id,
      reference: complaint.reference,
      status: complaint.status,
      priority: complaint.priority,
      title: complaint.description || complaint.category,
      subtitle: complaint.customer?.name ?? formatPhone(complaint.customer?.phone),
      footer: `${formatDate(complaint.created_at)} · ${complaint.category}`,
    });
  }

  return (
    <ViewShell
      title="Board"
      description="Drag a card to change status, or use its move menu."
      scroll={false}
    >
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search reference, description or phone"
        hasFilters={Boolean(search) || category !== 'all' || priority !== 'all'}
        onReset={() => { setSearch(''); setCategory('all'); setPriority('all'); }}
        className="px-4 pt-4"
      >
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Filter complaints by category"
        >
          <option value="all">All categories</option>
          {[...new Set((complaints.data ?? []).map((item) => item.category).filter(Boolean))].map((value) => (
            <option key={value} value={value}>{humanise(value)}</option>
          ))}
        </select>
        {supportsComplaintPriority ? (
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="bg-background h-9 rounded-md border px-2 text-sm"
            aria-label="Filter complaints by priority"
          >
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        ) : null}
      </FilterBar>

      <Panel className="min-h-0 flex-1 overflow-hidden">
        {complaints.isLoading ? (
          <PanelSkeleton rows={8} />
        ) : (
          <KanbanBoard
            columns={COMPLAINT_STATUSES}
            cardsByColumn={cardsByColumn}
            onMove={(id, status) => move.mutate({ id, status })}
            onSelect={(id) =>
              setSelectedIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
            selectedIds={selectedIds}
            onCardClick={(id) => setDetail((complaints.data ?? []).find((item) => item.id === id) ?? null)}
          />
        )}
      </Panel>

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
        {COMPLAINT_STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            variant="outline"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ ids: selectedIds, patch: { status } })}
          >
            {complaintStatus(status).label}
          </Button>
        ))}
        {supportsComplaintPriority ? (
          <select
            defaultValue=""
            disabled={bulk.isPending}
            onChange={(event) => {
              if (!event.target.value) return;
              bulk.mutate({ ids: selectedIds, patch: { priority: event.target.value } });
              event.target.value = '';
            }}
            className="bg-background h-8 rounded-md border px-2 text-xs"
            aria-label="Set priority for selected complaints"
          >
            <option value="" disabled>Set priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsv(
              stamp('complaints'),
              (complaints.data ?? []).filter((c) => selectedIds.includes(c.id)),
              [
                { header: 'Reference', value: (c) => c.reference },
                { header: 'Status', value: (c) => c.status },
                { header: 'Priority', value: (c) => c.priority },
                { header: 'Category', value: (c) => c.category },
                { header: 'Customer', value: (c) => c.customer?.name ?? '' },
                { header: 'Phone', value: (c) => c.customer?.phone ?? '' },
                { header: 'Description', value: (c) => c.description ?? '' },
                { header: 'Created', value: (c) => c.created_at },
              ]
            )
          }
        >
          Export CSV
        </Button>
      </BulkActionBar>

      <ComplaintDetail complaint={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </ViewShell>
  );
}

/**
 * Shared by the board and the bookings table. Rolls the cache back on failure so
 * a rejected bulk update does not leave the UI claiming a status that Postgres
 * never accepted.
 */
function useBulkComplaintAction(onDone) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, patch }) => updateComplaintStatuses(ids, patch),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['complaints'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onDone?.();
    },
  });
}
