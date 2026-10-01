import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ContactRound,
  MessageSquareWarning,
  Receipt,
  UsersRound,
} from 'lucide-react';
import { listBookings, listComplaints, listCustomers, listEscalations, queryKeys, updateBooking, updateCustomer } from '@/lib/api';
import { BOOKING_STATUS, complaintStatus } from '@/lib/status';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPhone } from '@/lib/utils';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatusBadge } from '@/components/data/StatusBadge';
import { ErrorState } from '@/components/data/EmptyState';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { OpenRecordButton, RecordActionBar, StatusSelect } from '@/components/data/RecordActions';
import { BookingWorkflow } from '@/components/data/BookingWorkflow';
import { TableViewControls } from '@/components/data/TableViewControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModule } from '@/hooks/useModule';
import { useTableView } from '@/hooks/useTableView';

const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'in_progress', 'rescheduled'];

export function TodayCommandCentre({ onNavigate }) {
  const bookings = useQuery({ queryKey: ['bookings', 'owner-records'], queryFn: () => listBookings({}) });
  const complaints = useQuery({ queryKey: ['complaints', 'owner-records'], queryFn: () => listComplaints({}) });
  const escalations = useQuery({ queryKey: ['escalations', 'owner'], queryFn: () => listEscalations({}) });
  const today = new Date().toISOString().slice(0, 10);
  const todayBookings = (bookings.data ?? []).filter((item) => item.scheduled_date === today);
  const overdue = (bookings.data ?? []).filter(
    (item) => item.scheduled_date && item.scheduled_date < today && ACTIVE_BOOKING_STATUSES.includes(item.status)
  );
  const openComplaints = (complaints.data ?? []).filter((item) => !['resolved', 'closed'].includes(item.status));
  const openEscalations = (escalations.data ?? []).filter((item) => item.status !== 'resolved');
  const loading = bookings.isLoading || complaints.isLoading || escalations.isLoading;

  const signals = [
    { label: "Today's schedule", value: todayBookings.length, detail: 'Bookings planned today', icon: CalendarCheck, tone: 'info', module: 'calendar' },
    { label: 'Potentially overdue', value: overdue.length, detail: 'Past date, still active', icon: CalendarClock, tone: overdue.length ? 'warning' : 'success', module: 'bookings', params: { status: 'active' } },
    { label: 'Customer care', value: openComplaints.length, detail: 'Open complaint cases', icon: MessageSquareWarning, tone: openComplaints.length ? 'warning' : 'success', module: 'complaints', params: { status: 'open' } },
    { label: 'Human handoffs', value: openEscalations.length, detail: 'Escalations unresolved', icon: AlertTriangle, tone: openEscalations.length ? 'destructive' : 'success', module: 'escalations', params: { status: 'open' } },
  ];

  return (
    <section className="today-command rounded-[1.5rem] border border-primary/15 p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-info dark:text-primary text-[10px] font-bold tracking-[0.2em] uppercase">Today · {format(new Date(), 'EEEE, d MMMM')}</div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Live operating picture</h2>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate('calendar')}>Open calendar <ArrowRight /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {signals.map((signal) => {
          const Icon = signal.icon;
          return (
            <button
              key={signal.label}
              type="button"
              disabled={loading}
              onClick={() => onNavigate(signal.module, signal.params)}
              className="today-signal group flex items-center gap-3 rounded-2xl border border-border/70 bg-background/65 p-3 text-left shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className={`notification-icon notification-icon-${signal.tone}`}><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground block truncate text-[11px]">{signal.label}</span>
                <span className="tabular block text-xl font-semibold">{loading ? '—' : formatNumber(signal.value)}</span>
                <span className="text-muted-foreground block truncate text-[10px]">{signal.detail}</span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-1" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function OwnerCalendar() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState('month');
  const [draggedBooking, setDraggedBooking] = useState(null);
  const [detail, setDetail] = useState(null);
  const bookings = useQuery({ queryKey: ['bookings', 'owner-records'], queryFn: () => listBookings({}) });
  const bookingMutation = useMutation({
    mutationFn: ({ id, patch }) => updateBooking(id, patch),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      setDetail((current) => current?.id === variables.id ? { ...current, ...(updated ?? {}), ...variables.patch } : current);
    },
  });

  if (bookings.isError) {
    return <ViewShell title="Calendar"><ErrorState error={bookings.error} onRetry={bookings.refetch} /></ViewShell>;
  }

  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const days = Array.from({ length: view === 'day' ? 1 : view === 'week' ? 7 : 42 }, (_, index) => addDays(view === 'day' ? cursor : view === 'week' ? startOfWeek(cursor, { weekStartsOn: 1 }) : gridStart, index));
  const byDate = new Map();
  for (const booking of bookings.data ?? []) {
    if (!booking.scheduled_date) continue;
    const bucket = byDate.get(booking.scheduled_date) ?? [];
    bucket.push(booking);
    byDate.set(booking.scheduled_date, bucket);
  }
  const monthBookings = (bookings.data ?? []).filter((item) => item.scheduled_date?.startsWith(format(cursor, 'yyyy-MM')));

  return (
    <ViewShell
      title="Operations calendar"
      description="A visual agenda for every scheduled service"
      actions={
        <div className="flex items-center gap-1 rounded-xl border bg-background/70 p-1 shadow-sm">
          <Button variant="ghost" size="icon-sm" onClick={() => setCursor((value) => view === 'day' ? addDays(value, -1) : view === 'week' ? addDays(value, -7) : addMonths(value, -1))} aria-label="Previous period"><ArrowLeft /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setCursor((value) => view === 'day' ? addDays(value, 1) : view === 'week' ? addDays(value, 7) : addMonths(value, 1))} aria-label="Next period"><ArrowRight /></Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <CalendarMetric label="Scheduled this month" value={monthBookings.length} icon={CalendarCheck} />
        <CalendarMetric label="Completed" value={monthBookings.filter((item) => item.status === 'completed').length} icon={CheckCircle2} />
        <CalendarMetric label="Active pipeline" value={monthBookings.filter((item) => ACTIVE_BOOKING_STATUSES.includes(item.status)).length} icon={Clock3} />
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader className="justify-between">
          <div><PanelTitle className="text-base">{view === 'day' ? format(cursor, 'EEEE, d MMMM yyyy') : view === 'week' ? `Week of ${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'd MMMM yyyy')}` : format(cursor, 'MMMM yyyy')}</PanelTitle><div className="text-muted-foreground text-xs">Select a booking to inspect details · drag to reschedule</div></div>
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">{['month', 'week', 'day', 'agenda'].map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-all ${view === item ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}>{item}</button>)}</div>
        </PanelHeader>
        <PanelBody scroll={false}>
          <div className={`${view === 'agenda' || view === 'day' ? 'hidden' : 'hidden sm:grid'} grid-cols-7 border-b bg-muted/30 text-center text-[10px] font-semibold tracking-wide text-muted-foreground uppercase`}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="py-2">{day}</div>)}
          </div>
          <div className={`${view === 'agenda' ? 'hidden' : 'hidden sm:grid'} ${view === 'day' ? 'grid-cols-1' : 'grid-cols-7'}`}>
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const items = byDate.get(key) ?? [];
              return (
                <div key={key} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedBooking && draggedBooking.scheduled_date !== key) bookingMutation.mutate({ id: draggedBooking.id, patch: { scheduled_date: key, status: draggedBooking.status === 'completed' ? 'completed' : 'rescheduled' } }); setDraggedBooking(null); }} className={`calendar-cell min-h-28 border-r border-b p-2 ${isSameMonth(day, cursor) || view === 'week' ? '' : 'bg-muted/20 opacity-45'} ${draggedBooking ? 'calendar-drop-zone' : ''}`}>
                  <div className={`mb-1 grid size-6 place-items-center rounded-full text-xs ${isToday(day) ? 'bg-primary font-bold text-primary-foreground' : 'text-muted-foreground'}`}>{format(day, 'd')}</div>
                  <div className="space-y-1">
                    {items.slice(0, 3).map((booking) => (
                      <button key={booking.id} type="button" draggable onDragStart={() => setDraggedBooking(booking)} onDragEnd={() => setDraggedBooking(null)} onClick={() => setDetail(booking)} className={`block w-full cursor-grab truncate rounded-md border-l-2 px-1.5 py-1 text-left text-[10px] transition-transform hover:translate-x-0.5 active:cursor-grabbing ${booking.status === 'completed' ? 'border-success bg-success/8' : 'border-info bg-info/7'}`}>
                        {booking.scheduled_time?.slice(0, 5)} {booking.service?.name ?? booking.reference}
                      </button>
                    ))}
                    {items.length > 3 ? <div className="text-muted-foreground px-1 text-[9px]">+{items.length - 3} more</div> : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`divide-y ${view === 'agenda' ? '' : 'sm:hidden'}`}>
            {monthBookings.length ? monthBookings.map((booking) => (
              <button key={booking.id} type="button" onClick={() => setDetail(booking)} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="grid size-10 place-items-center rounded-xl bg-info/10 text-info"><span className="text-xs font-bold">{format(parseISO(booking.scheduled_date), 'dd')}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{booking.service?.name ?? booking.reference}</span><span className="text-muted-foreground text-xs">{formatDate(booking.scheduled_date)} · {booking.scheduled_time?.slice(0, 5) ?? 'Time pending'}</span></span>
                <StatusBadge tone={BOOKING_STATUS[booking.status]?.tone ?? 'neutral'}>{BOOKING_STATUS[booking.status]?.label ?? booking.status}</StatusBadge>
              </button>
            )) : <div className="text-muted-foreground p-10 text-center text-sm">No bookings scheduled this month.</div>}
          </div>
        </PanelBody>
      </Panel>

      <RecordDrawer
        record={detail}
        activityEntity="booking"
        title={detail?.reference ?? 'Booking details'}
        description="Schedule and customer information"
        onClose={() => setDetail(null)}
        navigation={recordNavigation(monthBookings, detail, setDetail)}
        summary={detail ? <BookingWorkflow status={detail.status} /> : null}
        actions={detail ? (
          <RecordActionBar label="Booking actions" error={bookingMutation.error?.message} success={bookingMutation.isSuccess && bookingMutation.variables?.id === detail.id ? 'Booking updated' : null}>
            <StatusSelect
              value={detail.status}
              options={BOOKING_STATUS}
              disabled={bookingMutation.isPending}
              ariaLabel={`Change status for ${detail.reference}`}
              onChange={(status) => bookingMutation.mutate({ id: detail.id, patch: { status } })}
            />
            {detail.customer?.phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${detail.customer.phone}`}>Call customer</a></Button> : null}
          </RecordActionBar>
        ) : null}
        fields={detail ? [
          ['Service', detail.service?.name], ['Customer', detail.customer?.name], ['Phone', formatPhone(detail.customer?.phone)],
          ['Scheduled', `${formatDate(detail.scheduled_date)} ${detail.scheduled_time?.slice(0, 5) ?? ''}`],
          ['Status', BOOKING_STATUS[detail.status]?.label ?? detail.status], ['Value', formatCurrency(detail.price)], ['Notes', detail.notes],
        ] : []}
        timeline={detail ? [{ label: 'Booking created', value: formatDateTime(detail.created_at) }, { label: 'Scheduled visit', value: `${formatDate(detail.scheduled_date)} ${detail.scheduled_time?.slice(0, 5) ?? ''}` }] : []}
      />
    </ViewShell>
  );
}

function CalendarMetric({ label, value, icon: Icon }) {
  return <div className="flex items-center gap-3 rounded-2xl border bg-card/80 p-4 shadow-sm"><span className="surreal-icon grid size-10 place-items-center bg-info/10 text-info dark:bg-primary/10 dark:text-primary"><Icon /></span><span><span className="text-muted-foreground block text-xs">{label}</span><span className="tabular text-2xl font-semibold">{formatNumber(value)}</span></span></div>;
}

export function OwnerCustomers() {
  const queryClient = useQueryClient();
  const { setModule } = useModule('customers');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const directory = useQuery({
    queryKey: ['customers', 'owner-360'],
    queryFn: async () => {
      const [customers, bookings, complaints] = await Promise.all([listCustomers(), listBookings({}), listComplaints({})]);
      return customers.map((customer) => {
        const customerBookings = bookings.filter((item) => item.customer_id === customer.id);
        const customerComplaints = complaints.filter((item) => item.customer_id === customer.id);
        return {
          ...customer,
          bookings: customerBookings,
          complaints: customerComplaints,
          lifetimeValue: customerBookings.filter((item) => item.status === 'completed').reduce((total, item) => total + (Number(item.price) || 0), 0),
          lastActivity: [...customerBookings.map((item) => item.created_at), ...customerComplaints.map((item) => item.created_at)].filter(Boolean).sort().at(-1) ?? customer.created_at,
        };
      });
    },
  });
  const profileMutation = useMutation({
    mutationFn: ({ id, patch }) => updateCustomer(id, patch),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      setDetail((current) => current?.id === variables.id ? { ...current, ...(updated ?? {}), ...variables.patch } : current);
    },
  });

  const rows = (directory.data ?? []).filter((customer) => !search || [customer.name, customer.phone].some((value) => String(value ?? '').toLowerCase().includes(search.toLowerCase())));
  const columns = [
    { key: 'name', header: 'Customer', required: true, cell: (row) => <span className="font-medium">{row.name ?? 'Unnamed customer'}</span> },
    { key: 'phone', header: 'Phone', cell: (row) => <span className="tabular text-xs">{formatPhone(row.phone)}</span> },
    { key: 'bookings', header: 'Bookings', sortValue: (row) => row.bookings.length, cell: (row) => formatNumber(row.bookings.length) },
    { key: 'complaints', header: 'Complaints', sortValue: (row) => row.complaints.length, cell: (row) => formatNumber(row.complaints.length) },
    { key: 'lifetimeValue', header: 'Lifetime value', sortValue: (row) => row.lifetimeValue, cell: (row) => <span className="tabular">{formatCurrency(row.lifetimeValue)}</span> },
    { key: 'lastActivity', header: 'Last activity', cell: (row) => <span className="text-xs">{formatDate(row.lastActivity)}</span> },
    { key: 'actions', header: 'Actions', required: true, sortable: false, cell: (row) => <OpenRecordButton onClick={() => setDetail(row)} /> },
  ];
  const tableView = useTableView('joboy.table.owner.customers', columns);

  if (directory.isError) return <ViewShell title="Customers"><ErrorState error={directory.error} onRetry={directory.refetch} /></ViewShell>;

  const totalValue = (directory.data ?? []).reduce((total, customer) => total + customer.lifetimeValue, 0);

  return (
    <ViewShell title="Customer 360°" description="Every relationship, booking and service issue in one place">
      <div className="customer-hero grid gap-3 rounded-[1.5rem] border border-primary/15 p-4 sm:grid-cols-3 md:p-5">
        <CustomerMetric label="Customers" value={formatNumber((directory.data ?? []).length)} icon={UsersRound} />
        <CustomerMetric label="Lifetime revenue" value={formatCurrency(totalValue)} icon={Receipt} />
        <CustomerMetric label="Customers with complaints" value={formatNumber((directory.data ?? []).filter((item) => item.complaints.length).length)} icon={MessageSquareWarning} />
      </div>
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search customer name or phone" onReset={() => setSearch('')} />
      <Panel className="min-h-[32rem]">
        <PanelHeader><div><PanelTitle>Customer directory</PanelTitle><div className="text-muted-foreground text-xs">{rows.length} customer profiles</div></div><TableViewControls columns={columns} density={tableView.density} hidden={tableView.hidden} onDensityChange={tableView.setDensity} onToggleColumn={tableView.toggleColumn} onReset={tableView.reset} /></PanelHeader>
        <PanelBody scroll={false}><DataTable columns={tableView.visibleColumns} density={tableView.density} rows={rows} loading={directory.isLoading} onRowClick={setDetail} pageSize={20} emptyTitle="No customers found" hasFilters={Boolean(search)} onClearFilters={() => setSearch('')} /></PanelBody>
      </Panel>
      <RecordDrawer
        record={detail}
        title={detail?.name ?? formatPhone(detail?.phone)}
        description="Customer relationship overview"
        onClose={() => setDetail(null)}
        navigation={recordNavigation(rows, detail, setDetail)}
        summary={detail ? <CustomerIntelligence key={detail.id} customer={detail} mutation={profileMutation} /> : null}
        actions={detail ? (
          <RecordActionBar label="Customer actions">
            {detail.phone ? <Button asChild size="sm"><a href={`tel:${detail.phone}`}>Call customer</a></Button> : null}
            <Button variant="outline" size="sm" onClick={() => setModule('bookings', { search: detail.phone ?? detail.name })}>View bookings</Button>
            <Button variant="outline" size="sm" onClick={() => setModule('complaints', { search: detail.phone ?? detail.name })}>View complaints</Button>
          </RecordActionBar>
        ) : null}
        fields={detail ? [
          ['Phone', formatPhone(detail.phone)], ['Preferred language', detail.preferred_language?.toUpperCase()], ['Bookings', formatNumber(detail.bookings.length)],
          ['Complaints', formatNumber(detail.complaints.length)], ['Lifetime value', formatCurrency(detail.lifetimeValue)], ['Customer since', formatDate(detail.created_at)],
        ] : []}
        timeline={detail ? [...detail.bookings.map((item) => ({ label: `Booking · ${item.reference}`, value: `${formatDate(item.created_at)} · ${BOOKING_STATUS[item.status]?.label ?? item.status}` })), ...detail.complaints.map((item) => ({ label: `Complaint · ${item.reference}`, value: `${formatDate(item.created_at)} · ${complaintStatus(item.status).label}` }))].slice(0, 12) : []}
      />
    </ViewShell>
  );
}

function CustomerMetric({ label, value, icon: Icon }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-white/40 bg-background/65 p-3 backdrop-blur"><span className="surreal-icon grid size-10 place-items-center bg-primary/12 text-primary"><Icon /></span><span><span className="text-muted-foreground block text-xs">{label}</span><span className="tabular text-xl font-semibold">{value}</span></span></div>;
}

function CustomerIntelligence({ customer, mutation }) {
  const [notes, setNotes] = useState(customer.internal_notes ?? '');
  const [tags, setTags] = useState((customer.tags ?? []).join(', '));
  const upcoming = customer.bookings.filter((item) => item.scheduled_date >= new Date().toISOString().slice(0, 10) && !['completed', 'cancelled'].includes(item.status));
  const completed = customer.bookings.filter((item) => item.status === 'completed');
  const avgValue = completed.length ? customer.lifetimeValue / completed.length : 0;
  const supportsProfileFields = Object.prototype.hasOwnProperty.call(customer, 'tags') || Object.prototype.hasOwnProperty.call(customer, 'internal_notes');
  return (
    <section className="customer-intelligence rounded-2xl border border-primary/10 bg-primary/3 p-4">
      <div className="grid grid-cols-3 gap-2 text-center"><div><span className="text-muted-foreground block text-[10px] uppercase">Upcoming</span><strong className="tabular text-lg">{upcoming.length}</strong></div><div><span className="text-muted-foreground block text-[10px] uppercase">Completed</span><strong className="tabular text-lg">{completed.length}</strong></div><div><span className="text-muted-foreground block text-[10px] uppercase">Avg value</span><strong className="tabular text-lg">{formatCurrency(avgValue)}</strong></div></div>
      {supportsProfileFields ? <div className="mt-4 space-y-3 border-t border-primary/10 pt-4"><div><span className="text-muted-foreground mb-1 block text-[10px] font-bold tracking-wide uppercase">Tags</span><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="VIP, recurring, priority" /></div><div><span className="text-muted-foreground mb-1 block text-[10px] font-bold tracking-wide uppercase">Internal notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" className="bg-background w-full rounded-md border px-3 py-2 text-sm" placeholder="Private relationship notes" /></div><Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: customer.id, patch: { tags: tags.split(',').map((item) => item.trim()).filter(Boolean), internal_notes: notes || null } })}>{mutation.isPending ? 'Saving…' : 'Save profile'}</Button>{mutation.isSuccess && mutation.variables?.id === customer.id ? <span className="ml-2 text-xs font-medium text-success">Saved</span> : null}</div> : <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">Apply the CRM Operations migration to enable customer tags and internal notes.</p>}
    </section>
  );
}

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
