import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSession,
  listBookings,
  listComplaints,
  listConversationPhones,
  listEscalations,
  listMessages,
  updateBooking,
  updateBookingStatuses,
  updateComplaint,
  updateComplaintStatuses,
  updateEscalation,
} from '@/lib/api';
import { assignTechnician, listTechnicians } from '@/lib/api/technicians';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { useModule } from '@/hooks/useModule';
import {
  formatDate,
  formatDateTime,
  formatPhone,
  formatRelative,
} from '@/lib/utils';
import { BOOKING_STATUS, COMPLAINT_STATUSES, complaintStatus } from '@/lib/status';
import { downloadCsv, stamp } from '@/lib/csv';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { StatusBadge, Tag } from '@/components/data/StatusBadge';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { FilterBar } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { KanbanBoard } from '@/components/data/KanbanBoard';
import { DataTable } from '@/components/data/DataTable';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { StatusSelect } from '@/components/data/RecordActions';
import { BookingWorkflow } from '@/components/data/BookingWorkflow';
import { TableViewControls } from '@/components/data/TableViewControls';
import { useTableView } from '@/hooks/useTableView';
import { Button } from '@/components/ui/button';
import { MessageSquareOff, MessagesSquare } from 'lucide-react';

/*
 * Operations Agent.
 *
 * Read-only by design. There is no backend endpoint that sends a WhatsApp
 * message on an operator's behalf — the only outbound path lives inside the bot
 * flow handlers — so the Inbox deliberately offers no reply control rather than
 * a button that would need to be disabled forever. Replies happen in the
 * WhatsApp Business app until that API exists.
 */
export function AgentDashboard() {
  const { active } = useModule('inbox');

  if (active === 'board') return <AgentBoard />;
  if (active === 'bookings') return <AgentBookings />;
  if (active === 'escalations') return <AgentEscalations />;
  return <AgentInbox />;
}

/* ── Inbox ─────────────────────────────────────────────────────────────── */

function AgentInbox() {
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  useLiveUpdates(['messages']);

  const phones = useQuery({ queryKey: ['messages', 'phones'], queryFn: () => listConversationPhones() });

  if (phones.isError) {
    return (
      <ViewShell title="Inbox" scroll={false}>
        <ErrorState error={phones.error} onRetry={phones.refetch} />
      </ViewShell>
    );
  }

  if (phones.isLoading) {
    return (
      <ViewShell title="Inbox" scroll={false}>
        <PanelSkeleton rows={8} />
      </ViewShell>
    );
  }

  const list = phones.data ?? [];
  const activePhone = selectedPhone ?? list[0]?.phone ?? null;

  return (
    <ViewShell
      title="Inbox"
      description="Read-only. Reply in the WhatsApp Business app."
      scroll={false}
    >
      <Panel className="min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="border-border flex w-full shrink-0 flex-col border-b md:w-72 md:border-r md:border-b-0">
            <PanelHeader className="py-2.5">
              <PanelTitle>Conversations</PanelTitle>
              <span className="text-muted-foreground ml-auto text-xs">{list.length}</span>
            </PanelHeader>
            <PanelBody className="max-h-48 md:max-h-none">
              <ul className="divide-border divide-y">
                {list.map((conv) => (
                  <li key={conv.phone}>
                    <button
                      type="button"
                      onClick={() => setSelectedPhone(conv.phone)}
                      className={
                        conv.phone === activePhone
                          ? 'bg-accent/10 border-accent/40 w-full border-l-2 px-3 py-2.5 text-left'
                          : 'hover:bg-muted/50 w-full border-l-2 border-transparent px-3 py-2.5 text-left'
                      }
                    >
                      <div className="tabular truncate text-sm font-medium">
                        {formatPhone(conv.phone)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelative(conv.lastActivityAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </aside>

          <ConversationDetail phone={activePhone} />
        </div>
      </Panel>

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
        <Button size="sm" variant="outline" onClick={() => setSelectedIds([])}>
          Clear
        </Button>
      </BulkActionBar>
    </ViewShell>
  );
}

function ConversationDetail({ phone }) {
  const messages = useQuery({
    queryKey: ['messages', phone],
    queryFn: () => listMessages({ phone }),
    enabled: Boolean(phone),
  });

  const session = useQuery({
    queryKey: ['sessions', phone],
    queryFn: () => getSession(phone),
    enabled: Boolean(phone),
  });

  if (!phone) {
    return (
      <PanelBody className="text-muted-foreground flex items-center justify-center p-8 text-sm">
        <MessagesSquare className="mr-2 size-4" />
        No conversations yet.
      </PanelBody>
    );
  }

  const history = (messages.data ?? []).slice().reverse();
  const state = session.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader className="flex-wrap gap-y-1">
        <div className="min-w-0">
          <PanelTitle className="tabular">{formatPhone(phone)}</PanelTitle>
          {state?.state ? (
            <div className="text-muted-foreground text-xs">
              State <span className="font-medium">{state.state}</span>
              {state.current_flow ? ` · ${state.current_flow}` : ''}
              {state.human_takeover ? ' · human takeover' : ''}
            </div>
          ) : null}
        </div>
        <NoSendControl />
      </PanelHeader>

      <PanelBody className="p-4">
        {session.isError ? (
          <ErrorState error={session.error} onRetry={session.refetch} compact />
        ) : messages.isError ? (
          <ErrorState error={messages.error} onRetry={messages.refetch} compact />
        ) : (
          <ol className="space-y-3">
            {history.map((message) => {
              const outbound = message.direction === 'outbound';
              return (
                <li
                  key={message.id}
                  className={
                    outbound
                      ? 'bg-muted/60 ml-auto max-w-[85%] rounded-lg rounded-br-sm p-2.5'
                      : 'bg-accent/8 mr-auto max-w-[85%] rounded-lg rounded-bl-sm p-2.5'
                  }
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span>{formatDateTime(message.created_at)}</span>
                    {!outbound ? <span>· {message.direction}</span> : null}
                    {message.intent ? <Tag>{message.intent}</Tag> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </PanelBody>
    </div>
  );
}

/**
 * The disabled affordance, stated plainly rather than hidden. Omitting it
 * entirely leaves people typing into nothing, which reads as a broken app.
 */
function NoSendControl() {
  return (
    <div className="bg-muted/60 text-muted-foreground flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs">
      <MessageSquareOff className="size-3.5" />
      Reply from WhatsApp Business
    </div>
  );
}

function ComplaintDetail({ complaint, onOpenChange }) {
  return (
    <RecordDrawer
      record={complaint}
      activityEntity="complaint"
      title={complaint?.reference ?? 'Complaint details'}
      description="Complaint details and current workflow state."
      onClose={() => onOpenChange(false)}
      fields={complaint ? [
        ['Status', complaintStatus(complaint.status).label],
        ['Category', humanise(complaint.category)],
        ['Customer', complaint.customer?.name ?? formatPhone(complaint.customer?.phone)],
        ['Created', formatDateTime(complaint.created_at)],
        ['Description', complaint.description],
        ['Notes', complaint.agent_notes],
      ] : []}
      timeline={complaint ? [
        { label: 'Complaint reported', value: formatDateTime(complaint.created_at) },
        { label: `Current status · ${complaintStatus(complaint.status).label}`, value: formatDateTime(complaint.updated_at) },
      ] : []}
    />
  );
}

function BookingDetail({ booking, onOpenChange, navigation }) {
  return (
    <RecordDrawer
      record={booking}
      activityEntity="booking"
      title={booking?.reference ?? 'Booking details'}
      description="Booking schedule, customer and service details."
      onClose={() => onOpenChange(false)}
      navigation={navigation}
      summary={booking ? <BookingWorkflow status={booking.status} /> : null}
      fields={booking ? [
        ['Service', booking.service?.name],
        ['Status', BOOKING_STATUS_OPTIONS[booking.status] ?? booking.status],
        ['Customer', booking.customer?.name ?? formatPhone(booking.customer?.phone)],
        ['Phone', formatPhone(booking.customer?.phone)],
        ['Scheduled date', formatDate(booking.scheduled_date)],
        ['Scheduled time', booking.scheduled_time],
        ['Notes', booking.notes ?? booking.agent_notes],
      ] : []}
      timeline={booking ? [
        { label: 'Booking created', value: formatDateTime(booking.created_at) },
        { label: 'Service scheduled', value: `${formatDate(booking.scheduled_date)} ${booking.scheduled_time?.slice(0, 5) ?? ''}` },
        { label: `Current status · ${BOOKING_STATUS_OPTIONS[booking.status] ?? booking.status}`, value: formatDateTime(booking.updated_at) },
      ] : []}
    />
  );
}

function humanise(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

/* ── Board ─────────────────────────────────────────────────────────────── */

function AgentBoard() {
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

/* ── Bookings ──────────────────────────────────────────────────────────── */

function AgentBookings() {
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

const BOOKING_STATUS_OPTIONS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
};

/* ── Escalations ───────────────────────────────────────────────────────── */

function AgentEscalations() {
  const queryClient = useQueryClient();

  useLiveUpdates(['escalations']);

  const escalations = useQuery({
    queryKey: ['escalations', 'agent'],
    queryFn: () => listEscalations({}),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => updateEscalation(id, {
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['escalations'] }),
  });

  if (escalations.isError) {
    return (
      <ViewShell title="Escalations">
        <ErrorState error={escalations.error} onRetry={escalations.refetch} />
      </ViewShell>
    );
  }

  return (
    <ViewShell title="Escalations" description="Conversations handed off to a human">
      <Panel>
        <PanelHeader>
          <PanelTitle>{(escalations.data ?? []).length} escalations</PanelTitle>
        </PanelHeader>
        <PanelBody scroll={false}>
          {escalations.isLoading ? (
            <PanelSkeleton rows={5} />
          ) : (
            <ul className="divide-border divide-y">
              {(escalations.data ?? []).map((esc) => (
                <li key={esc.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="tabular w-28 shrink-0 text-xs">{formatPhone(esc.phone)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{esc.reason ?? '—'}</div>
                    {esc.conversation_summary ? (
                      <div className="text-muted-foreground line-clamp-1 text-xs">
                        {esc.conversation_summary}
                      </div>
                    ) : null}
                  </div>
                  <StatusSelect
                    compact
                    value={esc.status}
                    options={ESCALATION_STATUS_OPTIONS}
                    disabled={statusMutation.isPending && statusMutation.variables?.id === esc.id}
                    ariaLabel={`Change escalation status for ${esc.phone}`}
                    onChange={(status) => statusMutation.mutate({ id: esc.id, status })}
                  />
                  {esc.phone ? <Button asChild size="sm" variant="outline"><a href={`tel:${esc.phone}`}>Call</a></Button> : null}
                </li>
              ))}
              {(escalations.data ?? []).length === 0 ? (
                <li className="text-muted-foreground py-12 text-center text-sm">
                  No escalations.
                </li>
              ) : null}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </ViewShell>
  );
}

const ESCALATION_STATUS_OPTIONS = {
  open: { label: 'Open', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

function recordNavigation(rows, detail, setDetail) {
  if (!detail || rows.length < 2) return null;
  const index = rows.findIndex((row) => row.id === detail.id);
  if (index < 0) return null;
  return {
    label: `${index + 1} of ${rows.length}`,
    hasPrevious: index > 0,
    hasNext: index < rows.length - 1,
    onPrevious: () => index > 0 && setDetail(rows[index - 1]),
    onNext: () => index < rows.length - 1 && setDetail(rows[index + 1]),
  };
}
