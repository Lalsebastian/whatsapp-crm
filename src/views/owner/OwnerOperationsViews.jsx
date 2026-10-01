import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Download, History, MapPin, Route, UserRoundCheck, UsersRound } from 'lucide-react';
import { getOverview } from '@/lib/api/analytics';
import { listAllActivityLog, listBookings, listComplaints, queryKeys } from '@/lib/api';
import { assignTechnician, listTechnicians } from '@/lib/api/technicians';
import { addressLabel, findScheduleConflicts, recommendTechnicians } from '@/lib/scheduling';
import { slaState } from '@/lib/sla';
import { downloadCsv, stamp } from '@/lib/csv';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/utils';
import { BOOKING_STATUS } from '@/lib/status';
import { ViewShell, ChartPanel } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge, Tag } from '@/components/data/StatusBadge';
import { FilterBar, RangePicker } from '@/components/data/FilterBar';
import { EmptyState, ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { RevenueChart, VolumeChart } from '@/components/charts/Charts';
import { Button } from '@/components/ui/button';

export function OwnerDispatch() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recommendFor, setRecommendFor] = useState(null);
  const queryClient = useQueryClient();
  const bookings = useQuery({ queryKey: ['bookings', 'dispatch'], queryFn: () => listBookings({}) });
  const technicians = useQuery({ queryKey: ['technicians', 'dispatch'], queryFn: () => listTechnicians(), retry: false });
  const assignment = useMutation({
    mutationFn: ({ bookingId, technicianId }) => assignTechnician(bookingId, technicianId, null),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all }); setRecommendFor(null); },
  });
  if (bookings.isError) return <ViewShell title="Dispatch board"><ErrorState error={bookings.error} onRetry={bookings.refetch} /></ViewShell>;
  const day = (bookings.data ?? []).filter((item) => item.scheduled_date === date && !['cancelled'].includes(item.status));
  const techs = technicians.data ?? [];
  const conflicts = findScheduleConflicts(day);
  const unassigned = day.filter((item) => !item.technician_id);
  const areas = Object.entries(day.reduce((grouped, item) => { const area = item.property?.area ?? item.property?.city ?? 'Location pending'; grouped[area] = (grouped[area] ?? 0) + 1; return grouped; }, {})).sort((a, b) => b[1] - a[1]);
  const recommendations = recommendFor ? recommendTechnicians(recommendFor, techs, day) : [];
  return (
    <ViewShell title="Dispatch board" description="Assign the day’s work, spot clashes and check team capacity" actions={<label className="flex items-center gap-2 text-xs text-muted-foreground">Service date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-card h-9 rounded-xl border px-3 text-sm text-foreground shadow-sm" /></label>}>
      <KpiGrid cols={4}><KpiCard label="Scheduled" value={day.length} icon={CalendarClock} tone="primary" hint={formatDate(date)} /><KpiCard label="Unassigned" value={unassigned.length} icon={UsersRound} tone={unassigned.length ? 'warning' : 'success'} hint="Needs a technician" /><KpiCard label="Conflicts" value={conflicts.size} icon={AlertTriangle} tone={conflicts.size ? 'destructive' : 'success'} hint="Overlapping technician slots" /><KpiCard label="Coverage" value={day.length ? formatPercent((day.length - unassigned.length) / day.length) : '—'} icon={UserRoundCheck} tone="info" hint="Jobs with an owner" /></KpiGrid>
      {technicians.isError ? <div className="rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-xs text-warning">Technician setup is not installed, so assignment recommendations are unavailable. The schedule and location workload remain visible.</div> : null}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Panel><PanelHeader><div><PanelTitle>Technician lanes</PanelTitle><p className="text-muted-foreground text-xs">Workload ordered by scheduled time</p></div></PanelHeader><PanelBody scroll={false}>{bookings.isLoading ? <PanelSkeleton rows={6} /> : day.length ? <div className="space-y-3">{techs.map((tech) => <TechnicianLane key={tech.id} technician={tech} bookings={day.filter((item) => item.technician_id === tech.id)} conflicts={conflicts} />)}{unassigned.length ? <TechnicianLane technician={{ id: null, name: 'Unassigned work' }} bookings={unassigned} conflicts={conflicts} onRecommend={setRecommendFor} /> : null}</div> : <EmptyState title="No work scheduled" description="Choose another date or create a booking." compact />}</PanelBody></Panel>
        <div className="space-y-4"><Panel><PanelHeader><PanelTitle>Area workload</PanelTitle></PanelHeader><PanelBody scroll={false}>{areas.length ? <ul className="space-y-3">{areas.map(([area, count]) => <li key={area} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="size-4" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{area}</span><strong className="tabular">{count}</strong></li>)}</ul> : <p className="text-muted-foreground py-8 text-center text-sm">No location workload.</p>}</PanelBody></Panel>{recommendFor ? <Panel className="border-primary/20"><PanelHeader><div><PanelTitle>Smart assignment</PanelTitle><p className="text-muted-foreground text-xs">Best capacity match for {recommendFor.reference}</p></div></PanelHeader><PanelBody scroll={false}><div className="space-y-2">{recommendations.slice(0, 4).map((tech, index) => <button key={tech.id} type="button" disabled={assignment.isPending || tech.overlap} onClick={() => assignment.mutate({ bookingId: recommendFor.id, technicianId: tech.id })} className="hover:border-primary/30 flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-50"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{tech.name}</span><span className="text-muted-foreground text-[11px]">{tech.assigned} jobs · {Math.round(tech.bookedMinutes / 60 * 10) / 10}h booked</span></span><StatusBadge tone={tech.overlap ? 'destructive' : tech.score > 75 ? 'success' : 'warning'}>{tech.overlap ? 'Conflict' : `${tech.score}% fit`}</StatusBadge></button>)}</div></PanelBody></Panel> : null}</div>
      </div>
    </ViewShell>
  );
}

function TechnicianLane({ technician, bookings, conflicts, onRecommend }) {
  const ordered = [...bookings].sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
  return <section className="dispatch-lane"><div className="flex items-center gap-3 border-b border-border/60 px-4 py-3"><span className="grid size-9 place-items-center rounded-xl bg-info/10 font-bold text-info">{technician.name?.slice(0, 1)}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{technician.name}</div><div className="text-muted-foreground text-[11px]">{ordered.length} scheduled jobs</div></div><span className="tabular text-xs text-muted-foreground">{ordered.reduce((total, item) => total + (Number(item.service?.duration_minutes) || 60), 0)} min</span></div><div className="grid gap-2 p-3 md:grid-cols-2">{ordered.map((booking) => <button key={booking.id} type="button" onClick={() => !booking.technician_id && onRecommend?.(booking)} className={`dispatch-job text-left ${conflicts.has(booking.id) ? 'is-conflict' : ''}`}><div className="flex items-center gap-2"><strong className="tabular text-xs">{booking.scheduled_time?.slice(0, 5) ?? 'TBC'}</strong><StatusBadge tone={BOOKING_STATUS[booking.status]?.tone ?? 'neutral'}>{BOOKING_STATUS[booking.status]?.label ?? booking.status}</StatusBadge></div><div className="mt-2 truncate text-sm font-semibold">{booking.service?.name ?? booking.reference}</div><div className="text-muted-foreground mt-1 flex items-center gap-1.5 truncate text-[11px]"><Route className="size-3" />{addressLabel(booking.property)}</div>{conflicts.has(booking.id) ? <div className="mt-2 text-[10px] font-bold text-destructive">Schedule conflict</div> : !booking.technician_id ? <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-primary"><UserRoundCheck className="size-3" />Suggest technician</div> : null}</button>)}</div></section>;
}

export function OwnerReports() {
  const [range, setRange] = useState('30d');
  const report = useQuery({ queryKey: queryKeys.analytics.overview(range), queryFn: () => getOverview({ range }) });
  const complaints = useQuery({ queryKey: ['complaints', 'report'], queryFn: () => listComplaints({}) });
  if (report.isError) return <ViewShell title="Management reports"><ErrorState error={report.error} onRetry={report.refetch} /></ViewShell>;
  if (report.isLoading) return <ViewShell title="Management reports"><PanelSkeleton rows={8} /></ViewShell>;
  const { kpis, daily, series, comparison } = report.data;
  const complaintRows = complaints.data ?? [];
  const slaCompliant = complaintRows.filter((item) => !['breached'].includes(slaState(item, 'complaint').state)).length;
  const exportReport = () => downloadCsv(stamp('joboy-management-report'), [
    { metric: 'Revenue', value: kpis.revenue }, { metric: 'Bookings', value: kpis.bookings }, { metric: 'Completed', value: kpis.completed }, { metric: 'Cancelled', value: kpis.cancelled }, { metric: 'Open complaints', value: kpis.openComplaints }, { metric: 'SLA compliance', value: complaintRows.length ? slaCompliant / complaintRows.length : 1 },
  ], [{ header: 'Metric', value: (row) => row.metric }, { header: 'Value', value: (row) => row.value }]);
  return <ViewShell title="Management reports" description="Commercial performance, service quality and operational control" actions={<><Button variant="outline" size="sm" onClick={exportReport}><Download />Export CSV</Button><RangePicker value={range} onChange={setRange} /></>}><KpiGrid cols={4}><KpiCard label="Revenue" value={formatCurrency(kpis.revenue)} icon={Download} tone="primary" hint="Completed service value" delta={comparison?.revenue == null ? null : { label: `${comparison.revenue >= 0 ? '+' : ''}${formatPercent(comparison.revenue)} vs prior`, tone: comparison.revenue >= 0 ? 'positive' : 'negative' }} /><KpiCard label="Completion" value={formatPercent(kpis.completionRate)} icon={CheckCircle2} tone="success" hint={`${kpis.completed} of ${kpis.bookings} bookings`} /><KpiCard label="SLA compliance" value={complaintRows.length ? formatPercent(slaCompliant / complaintRows.length) : '100%'} icon={Clock3} tone="info" hint="Complaints within policy" /><KpiCard label="Avg ticket" value={formatCurrency(kpis.avgTicket)} icon={UsersRound} tone="accent" hint="Per completed booking" /></KpiGrid><div className="grid gap-4 lg:grid-cols-2"><ChartPanel title="Revenue trend" description="Completed service value"><RevenueChart data={daily} height={280} /></ChartPanel><ChartPanel title="Booking outcomes" description="Pipeline distribution"><VolumeChart data={series.bookingsByStatus} /></ChartPanel></div><Panel><PanelHeader><PanelTitle>Executive summary</PanelTitle></PanelHeader><PanelBody scroll={false}><div className="grid gap-3 md:grid-cols-3"><Insight label="Delivery" value={`${kpis.completed} completed`} detail={`${kpis.cancelled} cancellations in period`} tone={kpis.cancelled ? 'warning' : 'success'} /><Insight label="Customer care" value={`${kpis.openComplaints} open`} detail={`${kpis.escalatedComplaints} escalated cases`} tone={kpis.openComplaints ? 'warning' : 'success'} /><Insight label="Feedback" value={kpis.csat == null ? 'No score yet' : `${kpis.csat.toFixed(2)} / 5`} detail={`${kpis.csatResponses} customer responses`} tone={kpis.csat != null && kpis.csat >= 4 ? 'success' : 'info'} /></div></PanelBody></Panel></ViewShell>;
}

function Insight({ label, value, detail, tone }) { return <div className={`report-insight report-insight-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }

export function OwnerAuditLog() {
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('all');
  const activity = useQuery({ queryKey: ['activity-log', 'all'], queryFn: () => listAllActivityLog(), retry: false });
  const rows = useMemo(() => (activity.data?.rows ?? []).filter((item) => (entity === 'all' || item.entity_type === entity) && (!search || [item.action, item.entity_type, item.actor_label, item.entity_id].some((value) => String(value ?? '').toLowerCase().includes(search.toLowerCase())))), [activity.data, entity, search]);
  const columns = [
    { key: 'created_at', header: 'Timestamp', cell: (row) => <span className="tabular text-xs">{formatDateTime(row.created_at)}</span> },
    { key: 'entity_type', header: 'Module', cell: (row) => <Tag>{row.entity_type}</Tag> },
    { key: 'action', header: 'Action', cell: (row) => <StatusBadge tone={row.action === 'delete' ? 'destructive' : row.action === 'insert' ? 'success' : 'info'}>{row.action}</StatusBadge> },
    { key: 'actor', header: 'Actor', cell: (row) => row.actor_label ?? 'System automation' },
    { key: 'changes', header: 'Changed fields', sortable: false, cell: (row) => <span className="text-muted-foreground line-clamp-1 max-w-sm text-xs">{Object.keys(row.changed_fields ?? {}).join(', ') || 'Record snapshot'}</span> },
  ];
  return <ViewShell title="Verified audit log" description="Immutable operational changes captured by database triggers" actions={<Button variant="outline" size="sm" onClick={() => downloadCsv(stamp('joboy-audit'), rows, [{ header: 'Timestamp', value: (row) => row.created_at }, { header: 'Module', value: (row) => row.entity_type }, { header: 'Action', value: (row) => row.action }, { header: 'Actor', value: (row) => row.actor_label }, { header: 'Entity ID', value: (row) => row.entity_id }])}><Download />Export audit</Button>}><FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search action, actor or record" onReset={() => { setSearch(''); setEntity('all'); }}><select value={entity} onChange={(event) => setEntity(event.target.value)} className="bg-background h-9 rounded-md border px-2 text-sm"><option value="all">All modules</option><option value="booking">Bookings</option><option value="complaint">Complaints</option><option value="escalation">Escalations</option><option value="assignment">Assignments</option></select></FilterBar><Panel className="min-h-[32rem]"><PanelHeader><div><PanelTitle>Change history</PanelTitle><p className="text-muted-foreground text-xs">{formatNumber(rows.length)} verified events</p></div></PanelHeader><PanelBody scroll={false}>{activity.isLoading ? <PanelSkeleton rows={8} /> : activity.isError ? <ErrorState error={activity.error} onRetry={activity.refetch} compact /> : activity.data?.available ? <DataTable columns={columns} rows={rows} pageSize={25} emptyTitle="No matching activity" hasFilters={Boolean(search) || entity !== 'all'} onClearFilters={() => { setSearch(''); setEntity('all'); }} /> : <EmptyState icon={History} title="Audit migration required" description="Apply the CRM Operations Intelligence migration to activate verified history." compact />}</PanelBody></Panel></ViewShell>;
}
