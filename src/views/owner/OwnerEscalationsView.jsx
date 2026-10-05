import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { listEscalations, queryKeys, updateEscalation, updateEscalationStatuses } from '@/lib/api';
import { formatDateTime, formatPhone } from '@/lib/utils';
import { ViewShell } from '@/components/layout/ViewShell';
import { FilterBar } from '@/components/data/FilterBar';
import { ErrorState } from '@/components/data/EmptyState';
import { DataTable } from '@/components/data/DataTable';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { OpenRecordButton, RecordActionBar, StatusSelect } from '@/components/data/RecordActions';
import { SavedViews } from '@/components/data/SavedViews';
import { TableViewControls } from '@/components/data/TableViewControls';
import { SlaBadge } from '@/components/data/SlaBadge';
import { useTableView } from '@/hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { toast } from '@/lib/toast';
import { ESCALATION_STATUS, humanise, recordNavigation } from '@/views/owner/ownerRecordUtils';
import { RecordBulkActions, QueueMetric } from '@/views/owner/OwnerRecordParts';
import { parseHandoff } from '@/lib/handoff';

export function OwnerEscalations() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? 'all');
  const [selectedIds, setSelectedIds] = useState([]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['escalations', 'owner'],
    queryFn: () => listEscalations({}),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status: nextStatus }) => updateEscalation(id, {
      status: nextStatus,
      resolved_at: nextStatus === 'resolved' ? new Date().toISOString() : null,
    }),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
      queryClient.setQueryData(['escalations', 'owner'], (current = []) => current.map((row) => row.id === variables.id ? { ...row, ...(updated ?? {}), status: variables.status } : row));
      toast({ title: 'Escalation status updated', description: `Case is now ${humanise(variables.status)}.`, action: variables.previousStatus ? { label: 'Undo', onClick: async () => { await updateEscalation(variables.id, { status: variables.previousStatus, resolved_at: variables.previousStatus === 'resolved' ? variables.previousResolvedAt : null }); queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all }); toast({ title: 'Escalation change undone', tone: 'info' }); } } : null });
    },
    onError: (mutationError) => toast({ title: 'Escalation update failed', description: mutationError.message, tone: 'error' }),
  });
  const bulkMutation = useMutation({
    mutationFn: (nextStatus) => updateEscalationStatuses(selectedIds, {
      status: nextStatus,
      resolved_at: nextStatus === 'resolved' ? new Date().toISOString() : null,
    }),
    onSuccess: (_updated, nextStatus) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
      toast({ title: `${selectedIds.length} escalations updated`, description: `Status changed to ${ESCALATION_STATUS[nextStatus]?.label ?? humanise(nextStatus)}.` });
      setSelectedIds([]);
    },
    onError: (mutationError) => toast({ title: 'Bulk update failed', description: mutationError.message, tone: 'error' }),
  });

  const rows = (data ?? []).filter((escalation) => {
    if (status !== 'all' && escalation.status !== status) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return [escalation.phone, escalation.customer?.name, escalation.reason, escalation.conversation_summary]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  });
  const detail = (data ?? []).find((row) => row.id === searchParams.get('record')) ?? null;
  const openDetail = (record) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (record?.id) next.set('record', record.id); else next.delete('record');
    return next;
  }, { replace: true });

  const columns = [
    { key: 'customer', header: 'Customer', required: true, sortValue: (row) => row.customer?.name ?? row.phone, cell: (row) => row.customer?.name ?? formatPhone(row.phone) },
    { key: 'phone', header: 'Phone', cell: (row) => <span className="tabular text-xs">{formatPhone(row.phone)}</span> },
    { key: 'reason', header: 'Reason', cell: (row) => <span className="line-clamp-1 max-w-md">{row.reason ?? '—'}</span> },
    { key: 'created_at', header: 'Created', cell: (row) => <span className="text-xs">{formatDateTime(row.created_at)}</span> },
    { key: 'sla', header: 'SLA', cell: (row) => <SlaBadge record={row} entityType="escalation" /> },
    { key: 'status', header: 'Status', required: true, sortValue: (row) => row.status, cell: (row) => <StatusSelect compact value={row.status} options={ESCALATION_STATUS} disabled={statusMutation.isPending && statusMutation.variables?.id === row.id} ariaLabel={`Change escalation status for ${row.customer?.name ?? row.phone}`} onChange={(nextStatus) => statusMutation.mutate({ id: row.id, status: nextStatus, previousStatus: row.status, previousResolvedAt: row.resolved_at })} /> },
    { key: 'actions', header: 'Actions', required: true, sortable: false, cell: (row) => <OpenRecordButton onClick={() => openDetail(row)} /> },
  ];
  const tableView = useTableView('joboy.table.owner.escalations', columns);

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const openCount = (data ?? []).filter((row) => row.status !== 'resolved').length;

  return (
    <ViewShell title="Escalations" description="Conversations handed off to a human">
      <div className="grid gap-3 sm:grid-cols-3">
        <QueueMetric label="Total escalations" value={(data ?? []).length} tone="info" />
        <QueueMetric label="Needs attention" value={openCount} tone={openCount ? 'warning' : 'success'} />
        <QueueMetric label="Resolved" value={(data ?? []).length - openCount} tone="success" />
      </div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search customer, phone, reason or summary"
        onReset={() => { setSearch(''); setStatus('all'); }}
      >
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Filter escalations by status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </FilterBar>
      <SavedViews
        storageKey="joboy.views.owner.escalations"
        value={{ search, status }}
        onApply={(filters) => { setSearch(filters.search ?? ''); setStatus(filters.status ?? 'all'); }}
        presets={[
          { name: 'All escalations', filters: { search: '', status: 'all' } },
          { name: 'Open', filters: { search: '', status: 'open' } },
          { name: 'Resolved', filters: { search: '', status: 'resolved' } },
        ]}
      />
      <Panel className="min-h-[30rem]">
        <PanelHeader>
          <div>
            <PanelTitle>Escalation queue</PanelTitle>
            <div className="text-muted-foreground text-xs">{rows.length} of {(data ?? []).length} records</div>
          </div>
          <TableViewControls columns={columns} density={tableView.density} hidden={tableView.hidden} onDensityChange={tableView.setDensity} onToggleColumn={tableView.toggleColumn} onReset={tableView.reset} />
        </PanelHeader>
        <PanelBody scroll={false}>
          <DataTable
            columns={tableView.visibleColumns}
            rows={rows}
            loading={isLoading}
            onRowClick={openDetail}
            pageSize={15}
            density={tableView.density}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyTitle="No escalations found"
            emptyDescription={status !== 'all' || search ? 'Try a broader search or clear the current status filter.' : 'No conversations currently require a human handoff.'}
            hasFilters={Boolean(search) || status !== 'all'}
            onClearFilters={() => { setSearch(''); setStatus('all'); }}
          />
        </PanelBody>
      </Panel>
      <RecordBulkActions
        selectedIds={selectedIds}
        rows={rows}
        statusOptions={ESCALATION_STATUS}
        pending={bulkMutation.isPending}
        onApply={(nextStatus) => bulkMutation.mutate(nextStatus)}
        onClear={() => setSelectedIds([])}
        exportName="escalations"
        exportColumns={[
          { header: 'Customer', value: (row) => row.customer?.name ?? row.phone },
          { header: 'Phone', value: (row) => row.phone },
          { header: 'Reason', value: (row) => row.reason },
          { header: 'Status', value: (row) => row.status },
          { header: 'Created', value: (row) => row.created_at },
          { header: 'Summary', value: (row) => parseHandoff(row.conversation_summary).summary },
        ]}
      />
      <RecordDrawer
        record={detail}
        activityEntity="escalation"
        title={detail?.customer?.name ?? formatPhone(detail?.phone)}
        description="Escalation context and current handling status"
        onClose={() => openDetail(null)}
        navigation={recordNavigation(rows, detail, openDetail)}
        actions={detail ? (
          <RecordActionBar label="Escalation actions" error={statusMutation.error?.message} success={statusMutation.isSuccess && statusMutation.variables?.id === detail.id ? 'Escalation status updated' : null}>
            <StatusSelect
              value={detail.status}
              options={ESCALATION_STATUS}
              disabled={statusMutation.isPending && statusMutation.variables?.id === detail.id}
              ariaLabel={`Change escalation status for ${detail.customer?.name ?? detail.phone}`}
              onChange={(nextStatus) => statusMutation.mutate({ id: detail.id, status: nextStatus, previousStatus: detail.status, previousResolvedAt: detail.resolved_at })}
            />
            {detail.phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${detail.phone}`}>Call customer</a></Button> : null}
          </RecordActionBar>
        ) : null}
        fields={detail ? [
          ['Phone', formatPhone(detail.phone)],
          ['Status', humanise(detail.status)],
          ['Reason', detail.reason],
          ['Conversation summary', parseHandoff(detail.conversation_summary).summary],
          ['Recommended next step', parseHandoff(detail.conversation_summary).assist?.recommendedNextAction ?? '—'],
          ['Created', formatDateTime(detail.created_at)],
          ['Resolved', detail.resolved_at ? formatDateTime(detail.resolved_at) : 'Not resolved'],
        ] : []}
        timeline={detail ? [
          { label: 'Escalation created', value: formatDateTime(detail.created_at) },
          { label: `Current status · ${humanise(detail.status)}`, value: detail.resolved_at ? formatDateTime(detail.resolved_at) : 'Awaiting resolution' },
        ] : []}
      />
    </ViewShell>
  );
}
