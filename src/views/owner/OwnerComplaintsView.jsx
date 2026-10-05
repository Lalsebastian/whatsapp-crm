import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { listComplaints, queryKeys, updateComplaint, updateComplaintStatuses } from '@/lib/api';
import { formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import { COMPLAINT_STATUS, complaintStatus } from '@/lib/status';
import { ChartPanel, ViewShell } from '@/components/layout/ViewShell';
import { StatusBadge, StatusDot } from '@/components/data/StatusBadge';
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
import { ComplaintCategoryList } from '@/views/owner/OwnerOverviewParts';
import { humanise, complaintAgeDays, recordNavigation } from '@/views/owner/ownerRecordUtils';
import { RecordBulkActions, QueueMetric } from '@/views/owner/OwnerRecordParts';

export function OwnerComplaints({ overview }) {
  const { series } = overview;

  return (
    <ViewShell title="Complaints" description="What is going wrong, by category and status">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="By category">
          <ComplaintCategoryList data={series.complaintsByCategory} />
        </ChartPanel>
        <ChartPanel title="By status">
          <ul className="space-y-3">
            {series.complaintsByStatus.map((row) => {
              const meta = complaintStatus(row.label);
              return (
                <li key={row.label} className="flex items-center gap-3">
                  <StatusDot tone={meta.tone} />
                  <span className="flex-1 text-sm">{meta.label}</span>
                  <span className="tabular text-sm font-medium">{row.count}</span>
                </li>
              );
            })}
          </ul>
        </ChartPanel>
      </div>
      <OwnerComplaintRecords />
    </ViewShell>
  );
}

function OwnerComplaintRecords() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? 'all');
  const [selectedIds, setSelectedIds] = useState([]);
  const complaints = useQuery({
    queryKey: ['complaints', 'owner-records'],
    queryFn: () => listComplaints({}),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status: nextStatus }) => updateComplaint(id, { status: nextStatus }),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.complaints.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      queryClient.setQueryData(['complaints', 'owner-records'], (current = []) => current.map((row) => row.id === variables.id ? { ...row, ...(updated ?? {}), status: variables.status } : row));
      toast({ title: 'Complaint status updated', description: `${variables.reference ?? 'Complaint'} is now ${humanise(variables.status)}.`, action: variables.previousStatus ? { label: 'Undo', onClick: async () => { await updateComplaint(variables.id, { status: variables.previousStatus }); queryClient.invalidateQueries({ queryKey: queryKeys.complaints.all }); queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all }); toast({ title: 'Complaint change undone', tone: 'info' }); } } : null });
    },
    onError: (error) => toast({ title: 'Complaint update failed', description: error.message, tone: 'error' }),
  });
  const bulkMutation = useMutation({
    mutationFn: (nextStatus) => updateComplaintStatuses(selectedIds, { status: nextStatus }),
    onSuccess: (_updated, nextStatus) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.complaints.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      toast({ title: `${selectedIds.length} complaints updated`, description: `Status changed to ${COMPLAINT_STATUS[nextStatus]?.label ?? humanise(nextStatus)}.` });
      setSelectedIds([]);
    },
    onError: (error) => toast({ title: 'Bulk update failed', description: error.message, tone: 'error' }),
  });

  const rows = (complaints.data ?? []).filter((complaint) => {
    if (status !== 'all' && complaint.status !== status) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return [complaint.reference, complaint.category, complaint.description, complaint.customer?.name, complaint.customer?.phone]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  });
  const detail = (complaints.data ?? []).find((row) => row.id === searchParams.get('record')) ?? null;
  const openDetail = (record) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (record?.id) next.set('record', record.id); else next.delete('record');
    return next;
  }, { replace: true });

  const columns = [
    { key: 'reference', header: 'Reference', required: true, cell: (row) => <span className="tabular font-medium">{row.reference}</span> },
    { key: 'category', header: 'Category', cell: (row) => humanise(row.category) },
    { key: 'customer', header: 'Customer', sortValue: (row) => row.customer?.name ?? row.customer?.phone, cell: (row) => row.customer?.name ?? formatPhone(row.customer?.phone) },
    { key: 'created_at', header: 'Created', cell: (row) => <span className="text-xs">{formatDate(row.created_at)}</span> },
    { key: 'age', header: 'Age', sortValue: (row) => complaintAgeDays(row), cell: (row) => { const days = complaintAgeDays(row); const closed = ['resolved', 'closed'].includes(row.status); return <StatusBadge tone={closed ? 'success' : days >= 3 ? 'destructive' : days >= 1 ? 'warning' : 'info'}>{closed ? 'Closed' : days === 0 ? 'Today' : `${days}d open`}</StatusBadge>; } },
    { key: 'sla', header: 'SLA', cell: (row) => <SlaBadge record={row} entityType="complaint" /> },
    { key: 'status', header: 'Status', required: true, sortValue: (row) => row.status, cell: (row) => <StatusSelect compact value={row.status} options={COMPLAINT_STATUS} disabled={statusMutation.isPending && statusMutation.variables?.id === row.id} ariaLabel={`Change status for ${row.reference}`} onChange={(nextStatus) => statusMutation.mutate({ id: row.id, status: nextStatus, previousStatus: row.status, reference: row.reference })} /> },
    { key: 'actions', header: 'Actions', required: true, sortable: false, cell: (row) => <OpenRecordButton onClick={() => openDetail(row)} /> },
  ];
  const tableView = useTableView('joboy.table.owner.complaints', columns);

  if (complaints.isError) return <ErrorState error={complaints.error} onRetry={complaints.refetch} />;

  const activeCases = (complaints.data ?? []).filter((item) => !['resolved', 'closed'].includes(item.status));
  const agingCases = activeCases.filter((item) => complaintAgeDays(item) >= 3).length;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <QueueMetric label="Open workload" value={activeCases.length} tone={activeCases.length ? 'warning' : 'success'} />
        <QueueMetric label="3+ days open" value={agingCases} tone={agingCases ? 'warning' : 'success'} />
        <QueueMetric label="Resolved / closed" value={(complaints.data ?? []).length - activeCases.length} tone="success" />
      </div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search complaint, category or customer"
        onReset={() => { setSearch(''); setStatus('all'); }}
      >
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Filter complaints by status"
        >
          <option value="all">All statuses</option>
          {['open', 'in_progress', 'resolved', 'closed', 'escalated'].map((value) => (
            <option key={value} value={value}>{complaintStatus(value).label}</option>
          ))}
        </select>
      </FilterBar>
      <SavedViews
        storageKey="joboy.views.owner.complaints"
        value={{ search, status }}
        onApply={(filters) => { setSearch(filters.search ?? ''); setStatus(filters.status ?? 'all'); }}
        presets={[
          { name: 'All complaints', filters: { search: '', status: 'all' } },
          { name: 'Open', filters: { search: '', status: 'open' } },
          { name: 'Escalated', filters: { search: '', status: 'escalated' } },
        ]}
      />
      <Panel className="min-h-[26rem]">
        <PanelHeader>
          <div>
            <PanelTitle>Complaint records</PanelTitle>
            <div className="text-muted-foreground text-xs">{rows.length} of {(complaints.data ?? []).length} records</div>
          </div>
          <TableViewControls columns={columns} density={tableView.density} hidden={tableView.hidden} onDensityChange={tableView.setDensity} onToggleColumn={tableView.toggleColumn} onReset={tableView.reset} />
        </PanelHeader>
        <PanelBody scroll={false}>
          <DataTable
            columns={tableView.visibleColumns}
            rows={rows}
            loading={complaints.isLoading}
            onRowClick={openDetail}
            pageSize={15}
            density={tableView.density}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyTitle="No complaints found"
            emptyDescription={status !== 'all' || search ? 'Try a broader search or clear the current status filter.' : 'There are no customer complaints in the CRM.'}
            emptyAction={!search && status === 'all' ? <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('joboy:quick-create', { detail: 'complaint' }))}>Log complaint</Button> : null}
            hasFilters={Boolean(search) || status !== 'all'}
            onClearFilters={() => { setSearch(''); setStatus('all'); }}
          />
        </PanelBody>
      </Panel>
      <RecordBulkActions
        selectedIds={selectedIds}
        rows={rows}
        statusOptions={COMPLAINT_STATUS}
        pending={bulkMutation.isPending}
        onApply={(nextStatus) => bulkMutation.mutate(nextStatus)}
        onClear={() => setSelectedIds([])}
        exportName="complaints"
        exportColumns={[
          { header: 'Reference', value: (row) => row.reference },
          { header: 'Customer', value: (row) => row.customer?.name ?? row.customer?.phone },
          { header: 'Category', value: (row) => row.category },
          { header: 'Status', value: (row) => row.status },
          { header: 'Created', value: (row) => row.created_at },
          { header: 'Description', value: (row) => row.description },
        ]}
      />
      <RecordDrawer
        record={detail}
        activityEntity="complaint"
        title={detail?.reference ?? 'Complaint details'}
        description="Customer complaint and linked booking information"
        onClose={() => openDetail(null)}
        navigation={recordNavigation(rows, detail, openDetail)}
        actions={detail ? (
          <RecordActionBar label="Complaint actions" error={statusMutation.error?.message} success={statusMutation.isSuccess && statusMutation.variables?.id === detail.id ? 'Complaint status updated' : null}>
            <StatusSelect
              value={detail.status}
              options={COMPLAINT_STATUS}
              disabled={statusMutation.isPending && statusMutation.variables?.id === detail.id}
              ariaLabel={`Change status for ${detail.reference}`}
              onChange={(nextStatus) => statusMutation.mutate({ id: detail.id, status: nextStatus, previousStatus: detail.status, reference: detail.reference })}
            />
            {detail.customer?.phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${detail.customer.phone}`}>Call customer</a></Button> : null}
          </RecordActionBar>
        ) : null}
        fields={detail ? [
          ['Category', humanise(detail.category)],
          ['Status', complaintStatus(detail.status).label],
          ['Customer', detail.customer?.name],
          ['Phone', formatPhone(detail.customer?.phone)],
          ['Linked booking', detail.booking?.reference ?? 'Not linked'],
          ['Description', detail.description],
          ['Created', formatDateTime(detail.created_at)],
        ] : []}
        timeline={detail ? [
          { label: 'Complaint reported', value: formatDateTime(detail.created_at) },
          { label: `Current status · ${complaintStatus(detail.status).label}`, value: formatDateTime(detail.updated_at) },
        ] : []}
      />
    </>
  );
}
