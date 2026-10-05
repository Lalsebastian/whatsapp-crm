import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listBookings, updateBooking, updateBookingStatuses } from '@/lib/api';
import { assignTechnician, listTechnicians } from '@/lib/api/technicians';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { formatDate, formatPhone } from '@/lib/utils';
import { BOOKING_STATUS } from '@/lib/status';
import { downloadCsv, stamp } from '@/lib/csv';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { Tag } from '@/components/data/StatusBadge';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { FilterBar } from '@/components/data/FilterBar';
import { ErrorState } from '@/components/data/EmptyState';
import { DataTable } from '@/components/data/DataTable';
import { StatusSelect } from '@/components/data/RecordActions';
import { TableViewControls } from '@/components/data/TableViewControls';
import { useTableView } from '@/hooks/useTableView';
import { Button } from '@/components/ui/button';
import { BookingDetail } from '@/views/agent/AgentRecordDetails';
import { BOOKING_STATUS_OPTIONS, recordNavigation } from '@/views/agent/agentRecordUtils';

export function AgentBookings() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [bulkTechnician, setBulkTechnician] = useState('');
  const [detail, setDetail] = useState(null);

  useLiveUpdates(['bookings']);

  const bookings = useQuery({
    queryKey: ['bookings', 'agent'],
    queryFn: () => listBookings({}),
  });

  const technicians = useQuery({
    queryKey: ['technicians', 'list'],
    queryFn: () => listTechnicians(),
    retry: false,
  });

  const single = useMutation({
    mutationFn: ({ id, patch }) => updateBooking(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  });

  const assignment = useMutation({
    mutationFn: ({ id, technicianId }) => assignTechnician(id, technicianId, null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  });

  const bulk = useMutation({
    mutationFn: ({ ids, patch }) => updateBookingStatuses(ids, patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setSelectedIds([]);
    },
  });

  const bulkAssignment = useMutation({
    mutationFn: ({ ids, technicianId }) =>
      Promise.all(ids.map((id) => assignTechnician(id, technicianId || null, null))),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setSelectedIds([]);
      setBulkTechnician('');
    },
  });

  const rows = (bookings.data ?? []).filter((b) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      b.reference?.toLowerCase().includes(needle) ||
      b.service?.name?.toLowerCase().includes(needle) ||
      b.customer?.phone?.includes(needle)
    );
  });

  const techName = (id) =>
    (technicians.data ?? []).find((t) => t.id === id)?.name ?? 'Unassigned';

  const supportsTechnicians =
    !technicians.isError && (bookings.data ?? []).some((item) =>
      Object.prototype.hasOwnProperty.call(item, 'technician_id')
    );
  const supportsBookingPriority = (bookings.data ?? []).some((item) =>
    Object.prototype.hasOwnProperty.call(item, 'priority')
  );

  const columns = [
    { key: 'reference', header: 'Reference', required: true, cell: (booking) => <span className="tabular text-xs">{booking.reference}</span> },
    { key: 'service', header: 'Service', sortValue: (booking) => booking.service?.name, cell: (booking) => booking.service?.name ?? '—' },
    { key: 'customer', header: 'Customer', sortValue: (booking) => booking.customer?.name ?? booking.customer?.phone, cell: (booking) => booking.customer?.name ?? formatPhone(booking.customer?.phone) },
    { key: 'scheduled_date', header: 'Scheduled', cell: (booking) => <span className="text-xs">{formatDate(booking.scheduled_date)}</span> },
    ...(supportsTechnicians ? [{
      key: 'technician_id',
      header: 'Technician',
      sortValue: (booking) => techName(booking.technician_id),
      cell: (booking) => (
        <select
          value={booking.technician_id ?? ''}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => assignment.mutate({ id: booking.id, technicianId: event.target.value || null })}
          className="bg-background max-w-[10rem] rounded border px-1.5 py-1 text-xs"
          aria-label={`Assign technician for ${booking.reference}`}
        >
          <option value="">Unassigned</option>
          {(technicians.data ?? []).map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
        </select>
      ),
    }] : []),
    {
      key: 'status',
      header: 'Status',
      required: true,
      cell: (booking) => <StatusSelect compact value={booking.status} options={BOOKING_STATUS} disabled={single.isPending && single.variables?.id === booking.id} ariaLabel={`Change status for ${booking.reference}`} onChange={(status) => single.mutate({ id: booking.id, patch: { status } })} />,
    },
    ...(supportsBookingPriority
      ? [{ key: 'priority', header: 'Priority', cell: (booking) => <Tag>{booking.priority ?? 'normal'}</Tag> }]
      : []),
  ];
  const tableView = useTableView('joboy.table.agent.bookings', columns);

  if (bookings.isError) {
    return (
      <ViewShell title="Bookings">
        <ErrorState error={bookings.error} onRetry={bookings.refetch} />
      </ViewShell>
    );
  }

  return (
    <ViewShell title="Bookings" description="Assign technicians and change status in bulk.">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search reference, service or phone"
        onReset={() => setSearch('')}
      />

      {technicians.isError ? (
        <div className="border-info/20 bg-info/5 text-info rounded-xl border px-3 py-2 text-xs">
          Booking records are available. Technician assignment is hidden because field-operations setup is not installed in the database.
        </div>
      ) : null}

      <Panel className="min-h-[24rem]">
        <PanelHeader>
          <PanelTitle>{rows.length} bookings</PanelTitle>
          <TableViewControls columns={columns} density={tableView.density} hidden={tableView.hidden} onDensityChange={tableView.setDensity} onToggleColumn={tableView.toggleColumn} onReset={tableView.reset} />
        </PanelHeader>
        <PanelBody scroll={false}>
          <DataTable
            columns={tableView.visibleColumns}
            rows={rows}
            loading={bookings.isLoading}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={setDetail}
            density={tableView.density}
            emptyTitle="No bookings found"
            hasFilters={Boolean(search)}
            onClearFilters={() => setSearch('')}
          />
        </PanelBody>
      </Panel>

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
        {supportsTechnicians ? (
          <select
            value={bulkTechnician}
            disabled={bulkAssignment.isPending}
            onChange={(event) => {
              const technicianId = event.target.value;
              setBulkTechnician(technicianId);
              if (technicianId) bulkAssignment.mutate({ ids: selectedIds, technicianId });
            }}
            className="bg-background h-8 max-w-40 rounded-md border px-2 text-xs"
            aria-label="Assign selected bookings to a technician"
          >
            <option value="">Assign technician</option>
            {(technicians.data ?? []).map((tech) => (
              <option key={tech.id} value={tech.id}>{tech.name}</option>
            ))}
          </select>
        ) : null}
        {Object.entries(BOOKING_STATUS_OPTIONS).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant="outline"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ ids: selectedIds, patch: { status: value } })}
          >
            {label}
          </Button>
        ))}
        {supportsBookingPriority ? (
          <select
            defaultValue=""
            disabled={bulk.isPending}
            onChange={(event) => {
              if (!event.target.value) return;
              bulk.mutate({ ids: selectedIds, patch: { priority: event.target.value } });
              event.target.value = '';
            }}
            className="bg-background h-8 rounded-md border px-2 text-xs"
            aria-label="Set priority for selected bookings"
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
              stamp('bookings'),
              (bookings.data ?? []).filter((b) => selectedIds.includes(b.id)),
              [
                { header: 'Reference', value: (b) => b.reference },
                { header: 'Service', value: (b) => b.service?.name ?? '' },
                { header: 'Customer', value: (b) => b.customer?.name ?? '' },
                { header: 'Phone', value: (b) => b.customer?.phone ?? '' },
                { header: 'Scheduled', value: (b) => b.scheduled_date },
                { header: 'Technician', value: (b) => techName(b.technician_id) },
                { header: 'Status', value: (b) => b.status },
                { header: 'Price', value: (b) => b.price },
              ]
            )
          }
        >
          Export CSV
        </Button>
      </BulkActionBar>

      <BookingDetail booking={detail} onOpenChange={(open) => !open && setDetail(null)} navigation={recordNavigation(rows, detail, setDetail)} />
    </ViewShell>
  );
}
