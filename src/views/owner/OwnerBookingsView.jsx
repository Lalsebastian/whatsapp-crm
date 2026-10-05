import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { listBookings, queryKeys, updateBooking, updateBookingStatuses } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import { BOOKING_STATUS } from '@/lib/status';
import { ChartPanel, ViewShell } from '@/components/layout/ViewShell';
import { StatusBadge } from '@/components/data/StatusBadge';
import { FilterBar } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { DataTable } from '@/components/data/DataTable';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { OpenRecordButton, RecordActionBar, StatusSelect } from '@/components/data/RecordActions';
import { SavedViews } from '@/components/data/SavedViews';
import { BookingWorkflow } from '@/components/data/BookingWorkflow';
import { TableViewControls } from '@/components/data/TableViewControls';
import { useTableView } from '@/hooks/useTableView';
import { RevenueChart, VolumeChart } from '@/components/charts/LazyCharts';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { toast } from '@/lib/toast';
import { STATUS_BAR_COLOR, humanise, recordNavigation } from '@/views/owner/ownerRecordUtils';
import { RecordBulkActions } from '@/views/owner/OwnerRecordParts';

export function OwnerBookings({ overview }) {
  const { series, daily } = overview;

  return (
    <ViewShell title="Bookings" description="Monitor and manage the booking pipeline">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Bookings by status">
          <VolumeChart
            data={series.bookingsByStatus}
            colors={series.bookingsByStatus.map((s) => STATUS_BAR_COLOR[s.label] ?? undefined)}
          />
        </ChartPanel>
        <ChartPanel title="Daily volume">
          <RevenueChart data={daily} height={240} />
        </ChartPanel>
      </div>

      <OwnerBookingRecords />
    </ViewShell>
  );
}

function OwnerBookingRecords() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? 'all');
  const [selectedIds, setSelectedIds] = useState([]);
  const bookings = useQuery({
    queryKey: ['bookings', 'owner-records'],
    queryFn: () => listBookings({}),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status: nextStatus }) => updateBooking(id, { status: nextStatus }),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      queryClient.setQueryData(['bookings', 'owner-records'], (current = []) => current.map((row) => row.id === variables.id ? { ...row, ...(updated ?? {}), status: variables.status } : row));
      toast({ title: 'Booking status updated', description: `${variables.reference ?? 'Booking'} is now ${humanise(variables.status)}.`, action: variables.previousStatus ? { label: 'Undo', onClick: async () => { await updateBooking(variables.id, { status: variables.previousStatus }); queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all }); queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all }); toast({ title: 'Booking change undone', tone: 'info' }); } } : null });
    },
    onError: (error) => toast({ title: 'Booking update failed', description: error.message, tone: 'error' }),
  });
  const bulkMutation = useMutation({
    mutationFn: (nextStatus) => updateBookingStatuses(selectedIds, { status: nextStatus }),
    onSuccess: (_updated, nextStatus) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      toast({ title: `${selectedIds.length} bookings updated`, description: `Status changed to ${BOOKING_STATUS[nextStatus]?.label ?? humanise(nextStatus)}.` });
      setSelectedIds([]);
    },
    onError: (error) => toast({ title: 'Bulk update failed', description: error.message, tone: 'error' }),
  });

  const rows = (bookings.data ?? []).filter((booking) => {
    if (status === 'active' && !['pending', 'confirmed', 'in_progress', 'rescheduled'].includes(booking.status)) return false;
    if (status !== 'all' && status !== 'active' && booking.status !== status) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return [booking.reference, booking.service?.name, booking.customer?.name, booking.customer?.phone]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  });
  const detail = (bookings.data ?? []).find((row) => row.id === searchParams.get('record')) ?? null;
  const openDetail = (record) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (record?.id) next.set('record', record.id); else next.delete('record');
    return next;
  }, { replace: true });

  const columns = [
    { key: 'reference', header: 'Reference', required: true, cell: (row) => <span className="tabular font-medium">{row.reference}</span> },
    { key: 'service', header: 'Service', sortValue: (row) => row.service?.name, cell: (row) => row.service?.name ?? '—' },
    { key: 'customer', header: 'Customer', sortValue: (row) => row.customer?.name ?? row.customer?.phone, cell: (row) => row.customer?.name ?? formatPhone(row.customer?.phone) },
    { key: 'scheduled_date', header: 'Scheduled', cell: (row) => <span className="text-xs">{formatDate(row.scheduled_date)} {row.scheduled_time?.slice(0, 5) ?? ''}</span> },
    { key: 'price', header: 'Value', sortValue: (row) => Number(row.price) || 0, cell: (row) => <span className="tabular">{formatCurrency(row.price)}</span> },
    { key: 'status', header: 'Status', required: true, sortValue: (row) => row.status, cell: (row) => <StatusSelect compact value={row.status} options={BOOKING_STATUS} disabled={statusMutation.isPending && statusMutation.variables?.id === row.id} ariaLabel={`Change status for ${row.reference}`} onChange={(nextStatus) => statusMutation.mutate({ id: row.id, status: nextStatus, previousStatus: row.status, reference: row.reference })} /> },
    { key: 'actions', header: 'Actions', required: true, sortable: false, cell: (row) => <OpenRecordButton onClick={() => openDetail(row)} /> },
  ];
  const tableView = useTableView('joboy.table.owner.bookings', columns);

  if (bookings.isError) return <ErrorState error={bookings.error} onRetry={bookings.refetch} />;

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search booking, service or customer"
        onReset={() => { setSearch(''); setStatus('all'); }}
      >
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Filter bookings by status"
        >
          <option value="all">All statuses</option>
          <option value="active">All active</option>
          {Object.entries(BOOKING_STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
        </select>
      </FilterBar>
      <SavedViews
        storageKey="joboy.views.owner.bookings"
        value={{ search, status }}
        onApply={(filters) => { setSearch(filters.search ?? ''); setStatus(filters.status ?? 'all'); }}
        presets={[
          { name: 'All bookings', filters: { search: '', status: 'all' } },
          { name: 'Pending', filters: { search: '', status: 'pending' } },
          { name: 'In progress', filters: { search: '', status: 'in_progress' } },
        ]}
      />
      <Panel className="min-h-[30rem]">
        <PanelHeader>
          <div>
            <PanelTitle>Booking records</PanelTitle>
            <div className="text-muted-foreground text-xs">{rows.length} of {(bookings.data ?? []).length} records</div>
          </div>
          <TableViewControls columns={columns} density={tableView.density} hidden={tableView.hidden} onDensityChange={tableView.setDensity} onToggleColumn={tableView.toggleColumn} onReset={tableView.reset} />
        </PanelHeader>
        <PanelBody scroll={false}>
          <DataTable
            columns={tableView.visibleColumns}
            rows={rows}
            loading={bookings.isLoading}
            onRowClick={openDetail}
            pageSize={15}
            density={tableView.density}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyTitle="No bookings found"
            emptyDescription={status !== 'all' || search ? 'Try a broader search or clear the current status filter.' : 'Create the first booking to start building the service schedule.'}
            emptyAction={!search && status === 'all' ? <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('joboy:quick-create', { detail: 'booking' }))}>Create booking</Button> : null}
            hasFilters={Boolean(search) || status !== 'all'}
            onClearFilters={() => { setSearch(''); setStatus('all'); }}
          />
        </PanelBody>
      </Panel>
      <RecordBulkActions
        selectedIds={selectedIds}
        rows={rows}
        statusOptions={BOOKING_STATUS}
        pending={bulkMutation.isPending}
        onApply={(nextStatus) => bulkMutation.mutate(nextStatus)}
        onClear={() => setSelectedIds([])}
        exportName="bookings"
        exportColumns={[
          { header: 'Reference', value: (row) => row.reference },
          { header: 'Customer', value: (row) => row.customer?.name ?? row.customer?.phone },
          { header: 'Service', value: (row) => row.service?.name },
          { header: 'Scheduled', value: (row) => `${row.scheduled_date ?? ''} ${row.scheduled_time ?? ''}` },
          { header: 'Status', value: (row) => row.status },
          { header: 'Value', value: (row) => row.price },
        ]}
      />
      <RecordDrawer
        record={detail}
        activityEntity="booking"
        title={detail?.reference ?? 'Booking details'}
        description="Complete booking and customer information"
        onClose={() => openDetail(null)}
        navigation={recordNavigation(rows, detail, openDetail)}
        summary={detail ? <BookingWorkflow status={detail.status} /> : null}
        actions={detail ? (
          <RecordActionBar label="Booking actions" error={statusMutation.error?.message} success={statusMutation.isSuccess && statusMutation.variables?.id === detail.id ? 'Booking status updated' : null}>
            <StatusSelect
              value={detail.status}
              options={BOOKING_STATUS}
              disabled={statusMutation.isPending && statusMutation.variables?.id === detail.id}
              ariaLabel={`Change status for ${detail.reference}`}
              onChange={(nextStatus) => statusMutation.mutate({ id: detail.id, status: nextStatus, previousStatus: detail.status, reference: detail.reference })}
            />
            {detail.customer?.phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${detail.customer.phone}`}>Call customer</a></Button> : null}
          </RecordActionBar>
        ) : null}
        fields={detail ? [
          ['Service', detail.service?.name],
          ['Customer', detail.customer?.name],
          ['Phone', formatPhone(detail.customer?.phone)],
          ['Scheduled', `${formatDate(detail.scheduled_date)} ${detail.scheduled_time?.slice(0, 5) ?? ''}`],
          ['Status', BOOKING_STATUS[detail.status]?.label ?? humanise(detail.status)],
          ['Value', formatCurrency(detail.price)],
          ['Notes', detail.notes],
          ['Created', formatDateTime(detail.created_at)],
        ] : []}
        timeline={detail ? [
          { label: 'Booking created', value: formatDateTime(detail.created_at) },
          { label: 'Service scheduled', value: `${formatDate(detail.scheduled_date)} ${detail.scheduled_time?.slice(0, 5) ?? ''}` },
          { label: `Current status · ${BOOKING_STATUS[detail.status]?.label ?? humanise(detail.status)}`, value: formatDateTime(detail.updated_at) },
        ] : []}
      />
    </>
  );
}

export function RecentBookings({ limit = 15, compact = false }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['bookings', 'recent-owner'],
    queryFn: () => listBookings({}),
  });

  if (isLoading) return <PanelSkeleton rows={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} compact />;
  if (!data?.length) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No bookings yet.</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {data.slice(0, limit).map((booking) => {
        const status = BOOKING_STATUS[booking.status];
        return (
          <li key={booking.id} className="flex items-center gap-2.5 py-2.5 text-sm">
            <span className={`tabular text-muted-foreground shrink-0 truncate text-xs ${compact ? 'w-16' : 'w-24'}`}>
              {booking.reference}
            </span>
            <span className="min-w-0 flex-1 truncate">{booking.service?.name ?? '—'}</span>
            <span className={`text-muted-foreground hidden shrink-0 truncate text-xs sm:block ${compact ? 'w-24 xl:hidden' : 'w-32'}`}>
              {booking.customer?.name ?? booking.customer?.phone ?? '—'}
            </span>
            <span className={`tabular shrink-0 text-right text-xs ${compact ? 'w-16' : 'w-20'}`}>
              {formatCurrency(booking.price)}
            </span>
            {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
          </li>
        );
      })}
    </ul>
  );
}
