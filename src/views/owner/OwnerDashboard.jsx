import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Download,
  Gauge,
  MessageSquareWarning,
  Receipt,
  Star,
  TrendingUp,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { getOverview, getServiceMix } from '@/lib/api/analytics';
import {
  listBookings,
  listComplaints,
  listEscalations,
  queryKeys,
  updateBooking,
  updateBookingStatuses,
  updateComplaint,
  updateComplaintStatuses,
  updateEscalation,
  updateEscalationStatuses,
} from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPhone,
} from '@/lib/utils';
import { BOOKING_STATUS, COMPLAINT_STATUS, complaintStatus } from '@/lib/status';
import { ChartPanel, ViewShell } from '@/components/layout/ViewShell';
import { useModule } from '@/hooks/useModule';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { StatusBadge, StatusDot } from '@/components/data/StatusBadge';
import { FilterBar, RangePicker } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { DataTable } from '@/components/data/DataTable';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { OpenRecordButton, RecordActionBar, StatusSelect } from '@/components/data/RecordActions';
import { SavedViews } from '@/components/data/SavedViews';
import { DashboardCustomizer } from '@/components/data/DashboardCustomizer';
import { BookingWorkflow } from '@/components/data/BookingWorkflow';
import { TableViewControls } from '@/components/data/TableViewControls';
import { SlaBadge } from '@/components/data/SlaBadge';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { useTableView } from '@/hooks/useTableView';
import { MixChart, RevenueChart, VolumeChart } from '@/components/charts/Charts';
import { UtilizationChart } from '@/components/charts/TrendCharts';
import { OwnerCalendar, OwnerCustomers, TodayCommandCentre } from '@/views/owner/OwnerExperienceViews';
import { OwnerAuditLog, OwnerDispatch, OwnerReports } from '@/views/owner/OwnerOperationsViews';
import { OwnerControlCentre } from '@/views/owner/OwnerControlCentre';
import { ChatbotAnalytics } from '@/views/owner/ChatbotAnalytics';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { toast } from '@/lib/toast';
import { downloadCsv, stamp } from '@/lib/csv';
import { useWorkspacePreferences } from '@/hooks/useWorkspacePreferences';

/*
 * Owner / Manager — the business view.
 *
 * Every tile states its own definition underneath. A number with no stated
 * denominator is the thing that makes people stop trusting a dashboard, and the
 * first question about "conversion rate" is always "out of what".
 */
export function OwnerDashboard() {
  const { active, setModule } = useModule('overview');
  const workspace = useWorkspacePreferences();
  const [range, setRangeState] = useState(workspace.defaultRange);
  const setRange = (nextRange) => { setRangeState(nextRange); workspace.setDefaultRange(nextRange); };
  const dashboard = useDashboardWidgets();

  // Bookings and complaints feed the tiles and the charts, so a status change
  // anywhere in the app has to land here without a reload.
  useLiveUpdates(['bookings', 'complaints', 'satisfaction_surveys', 'conversation_events']);

  const overview = useQuery({
    queryKey: queryKeys.analytics.overview(range),
    queryFn: () => getOverview({ range }),
    enabled: ['overview', 'bookings', 'complaints'].includes(active),
  });

  const mix = useQuery({
    queryKey: ['analytics', 'mix', range],
    queryFn: () => getServiceMix({ range }),
    enabled: active === 'overview',
  });

  if (active === 'calendar') return <OwnerCalendar />;
  if (active === 'customers') return <OwnerCustomers />;
  if (active === 'reports') return <OwnerReports />;
  if (active === 'chatbot-analytics') return <ChatbotAnalytics />;
  if (active === 'dispatch') return <OwnerDispatch />;
  if (active === 'audit') return <OwnerAuditLog />;
  if (active === 'control') return <OwnerControlCentre />;
  if (active === 'escalations') return <OwnerEscalations />;

  if (overview.isError) {
    return (
      <ViewShell title="Executive overview" description="Performance, priorities and customer operations">
        <ErrorState error={overview.error} onRetry={overview.refetch} />
      </ViewShell>
    );
  }

  if (overview.isLoading) {
    return (
      <ViewShell title="Executive overview" description="Loading your business overview">
        <KpiGrid>
          {Array.from({ length: 6 }, (_, i) => (
            <KpiCard key={i} label="Loading…" value="—" loading />
          ))}
        </KpiGrid>
        <div className="grid gap-4 lg:grid-cols-3">
          <PanelSkeleton className="lg:col-span-2" rows={6} />
          <PanelSkeleton rows={6} />
        </div>
      </ViewShell>
    );
  }

  const { kpis, series, daily, utilisation, comparison } = overview.data;

  if (active === 'bookings') return <OwnerBookings overview={overview.data} />;
  if (active === 'complaints') return <OwnerComplaints overview={overview.data} />;

  return (
    <ViewShell
      title="Executive overview"
      description="Revenue, workload and customer service for the selected period"
      actions={
        <>
          <DashboardCustomizer widgets={dashboard.widgets} onToggle={dashboard.toggle} onReset={dashboard.reset} />
          <RangePicker value={range} onChange={setRange} />
        </>
      }
    >
      {overview.data.warnings?.length ? (
        <div className="bg-warning/10 text-warning ring-warning/25 rounded-lg px-3 py-2 text-xs ring-1 ring-inset">
          Some optional analytics are unavailable: {overview.data.warnings.join(' · ')}
        </div>
      ) : null}

      <ExecutiveHero
        kpis={kpis}
        utilisation={utilisation}
        range={range}
        onNavigate={setModule}
      />

      {dashboard.widgets.today ? <TodayCommandCentre onNavigate={setModule} /> : null}

      {dashboard.widgets.performance ? <>
        <SectionHeading
          eyebrow="Performance"
          title="Results for the selected period"
          description="Every metric is calculated from the selected reporting period."
        />
        <KpiGrid>
        <KpiCard
          label="Revenue"
          value={formatCompactCurrency(kpis.revenue)}
          icon={Receipt}
          tone="primary"
          hint={`Sum of ${formatNumber(kpis.completed)} completed jobs in this period`}
          delta={comparisonDelta(comparison?.revenue)}
        />
        <KpiCard
          label="Bookings"
          value={formatNumber(kpis.bookings)}
          icon={CalendarDays}
          tone="info"
          hint={`${kpis.completed} completed, ${kpis.cancelled} cancelled`}
          delta={comparisonDelta(comparison?.bookings)}
        />
        <KpiCard
          label="Avg ticket"
          value={formatCurrency(kpis.avgTicket)}
          icon={TrendingUp}
          tone="accent"
          hint="Revenue ÷ completed bookings"
        />
        <KpiCard
          label="Conversion"
          value={kpis.conversionRate == null ? '—' : formatPercent(kpis.conversionRate)}
          icon={BadgeCheck}
          tone="success"
          hint={
            kpis.conversionRate == null
              ? 'No funnel events recorded yet'
              : `${kpis.conversations} conversations started`
          }
        />
        <KpiCard
          label="Utilisation"
          value={utilisation.overall == null ? '—' : formatPercent(utilisation.overall)}
          icon={Wrench}
          tone="warning"
          hint={utilisation.overall == null ? 'No technicians yet' : 'Assigned job time ÷ shift capacity'}
        />
        <KpiCard
          label="CSAT"
          value={kpis.csat == null ? '—' : `${kpis.csat.toFixed(2)} / 5`}
          icon={Star}
          tone={kpis.csat == null ? 'neutral' : kpis.csat >= 4 ? 'success' : 'warning'}
          hint={
            kpis.csat == null
              ? 'No survey responses yet'
              : `${kpis.csatResponses} responses · ${kpis.csatPending} awaiting reply`
          }
        />
        </KpiGrid>
      </> : null}

      {dashboard.widgets.revenue || dashboard.widgets.operations ? (
        <SectionHeading
          eyebrow="Trends and workload"
          title="See what is moving and what needs attention"
          description="Open the records behind each total when you need the detail."
        />
      ) : null}

      {dashboard.widgets.revenue ? <div className="grid gap-4 xl:grid-cols-12">
        <ChartPanel
          title="Revenue over time"
          description="Completed jobs, by scheduled date"
          className="xl:col-span-8"
        >
          <RevenueChart data={daily} height={290} />
        </ChartPanel>

        <OperationalPulse
          kpis={kpis}
          bookingsByStatus={series.bookingsByStatus}
          onNavigate={setModule}
          className="xl:col-span-4"
        />
      </div> : null}

      {dashboard.widgets.operations ? <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartPanel title="Customer journey" description="Distinct customers at each step">
          <FunnelList funnel={series.funnel} />
        </ChartPanel>

        <ChartPanel title="Bookings by status" description="Volume across the pipeline">
          <VolumeChart
            data={series.bookingsByStatus}
            colors={series.bookingsByStatus.map((s) => STATUS_BAR_COLOR[s.label] ?? undefined)}
            onItemClick={(item) => setModule('bookings', { status: item.label })}
          />
        </ChartPanel>

        <ChartPanel title="Service mix" description="Completed jobs by service">
          {mix.isError ? (
            <ErrorState error={mix.error} onRetry={mix.refetch} compact />
          ) : mix.isLoading ? (
            <div className="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
              Loading…
            </div>
          ) : (
            <MixChart data={mix.data ?? []} />
          )}
        </ChartPanel>

        <ChartPanel
          title="Technician utilisation"
          description="Share of shift capacity booked"
        >
          <UtilizationChart data={utilisation.technicians} />
        </ChartPanel>
      </div> : null}

      {dashboard.widgets.customerCare ? <div className="grid gap-4 xl:grid-cols-12">
        <ChartPanel
          title="Complaint categories"
          description="What customers are actually complaining about"
          className="xl:col-span-4"
        >
          <ComplaintCategoryList data={series.complaintsByCategory} />
        </ChartPanel>

        <ChartPanel title="Unanswered CSAT surveys" description="Sent, no reply yet" className="xl:col-span-4">
          <UnansweredSurveys count={kpis.csatPending} />
        </ChartPanel>

        <ChartPanel
          title="Recent bookings"
          description="Latest customer activity"
          className="xl:col-span-4"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setModule('bookings')}>
              View all <ArrowRight />
            </Button>
          }
        >
          <RecentBookings limit={6} compact />
        </ChartPanel>
      </div> : null}
    </ViewShell>
  );
}

function SectionHeading({ eyebrow, title, description }) {
  return (
    <div className="dashboard-section-heading flex flex-wrap items-end justify-between gap-3 pt-2">
      <div>
        <div className="text-info dark:text-primary text-[10px] font-bold tracking-[0.24em] uppercase">{eyebrow}</div>
        <h2 className="mt-1 text-base font-semibold tracking-tight md:text-lg">{title}</h2>
      </div>
      <p className="text-muted-foreground max-w-xl text-xs md:text-sm">{description}</p>
    </div>
  );
}

function comparisonDelta(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return {
    label: `${value > 0 ? '+' : ''}${formatPercent(value)} vs previous period`,
    tone: value < 0 ? 'negative' : 'positive',
  };
}

function ExecutiveHero({ kpis, utilisation, range, onNavigate }) {
  const activeBookings = Math.max(0, kpis.bookings - kpis.completed - kpis.cancelled);
  const completion = kpis.completionRate ?? 0;
  const periodLabel = range === 'all' ? 'all recorded time' : `the last ${range.replace('d', ' days')}`;
  const priorities = [
    {
      label: 'Open complaints',
      value: kpis.openComplaints,
      detail: kpis.openComplaints ? 'Customer follow-up needed' : 'Customer care is clear',
      icon: MessageSquareWarning,
      tone: kpis.openComplaints ? 'warning' : 'success',
      target: 'complaints',
    },
    {
      label: 'Active bookings',
      value: activeBookings,
      detail: activeBookings ? 'Moving through operations' : 'No jobs waiting',
      icon: Activity,
      tone: 'info',
      target: 'bookings',
    },
    {
      label: 'Awaiting feedback',
      value: kpis.csatPending,
      detail: kpis.csatPending ? 'Survey responses pending' : 'Feedback is up to date',
      icon: Star,
      tone: kpis.csatPending ? 'primary' : 'success',
      target: 'complaints',
    },
  ];

  return (
    <section className="executive-hero relative overflow-hidden rounded-[1.75rem] border border-primary/15 p-5 shadow-[0_24px_70px_rgba(7,38,91,.10)] md:p-7">
      <div className="executive-hero-orbit" aria-hidden="true" />
      <div className="relative grid gap-7 xl:grid-cols-[1.35fr_.9fr] xl:items-stretch">
        <div className="flex flex-col justify-between gap-7">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-background/70 px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Updated from current CRM records
            </div>
            <h2 className="max-w-2xl text-2xl leading-tight font-semibold tracking-[-0.035em] md:text-4xl">
              A clear view of the day,
              <span className="hero-gradient-text block">from first booking to follow-up.</span>
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6 md:text-base">
              Revenue, workload and customer issues for {periodLabel}, with urgent work brought to the top.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => onNavigate('bookings')}>
              Explore bookings <ArrowRight />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('complaints')}>
              Review customer care
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <HeroMetric label="Completion" value={formatPercent(completion)} icon={BadgeCheck} />
            <HeroMetric
              label="Team capacity"
              value={utilisation.overall == null ? '—' : formatPercent(utilisation.overall)}
              icon={Gauge}
            />
            <HeroMetric label="Conversations" value={formatNumber(kpis.conversations)} icon={UsersRound} />
          </div>
        </div>

        <div className="executive-priority-card rounded-[1.35rem] border border-white/40 bg-background/72 p-3 shadow-xl shadow-primary/5 backdrop-blur-xl md:p-4">
          <div className="mb-2 flex items-center justify-between px-1 py-1">
            <div>
              <div className="text-sm font-semibold">Priority radar</div>
              <div className="text-muted-foreground text-xs">Where to focus next</div>
            </div>
            <div className="clay-icon flex size-9 items-center justify-center bg-primary/10 text-primary">
              <CircleAlert className="size-4" />
            </div>
          </div>
          <div className="space-y-2">
            {priorities.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onNavigate(item.target)}
                  className="priority-row group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-primary/15 hover:bg-background/85 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className={`priority-icon priority-icon-${item.tone}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{item.label}</span>
                    <span className="text-muted-foreground block truncate text-[11px]">{item.detail}</span>
                  </span>
                  <span className="tabular text-xl font-semibold">{formatNumber(item.value)}</span>
                  <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-1" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ label, value, icon: Icon }) {
  return (
    <div className="hero-metric min-w-0 rounded-xl border border-primary/10 bg-background/55 p-3 backdrop-blur-sm">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="tabular mt-1.5 truncate text-lg font-semibold md:text-xl">{value}</div>
    </div>
  );
}

function OperationalPulse({ kpis, bookingsByStatus, onNavigate, className }) {
  const active = (bookingsByStatus ?? []).filter((row) => !['completed', 'cancelled'].includes(row.label));
  const max = Math.max(1, ...active.map((row) => row.count));

  return (
    <Panel className={className}>
      <div className="border-border/70 flex items-start justify-between border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Work requiring attention</div>
          <div className="text-muted-foreground text-xs">Open work and customer issues</div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-1 text-[10px] font-semibold text-success">
          <span className="size-1.5 rounded-full bg-success" /> Live
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="grid grid-cols-2 gap-2">
          <PulseStat label="Open complaints" value={kpis.openComplaints} tone="warning" />
          <PulseStat label="Escalated cases" value={kpis.escalatedComplaints} tone="destructive" />
        </div>

        <div className="mt-5 flex-1">
          <div className="text-muted-foreground mb-3 text-[10px] font-bold tracking-[0.18em] uppercase">Active pipeline</div>
          {active.length ? (
            <ul className="space-y-3">
              {active.slice(0, 4).map((row) => {
                const status = BOOKING_STATUS[row.label] ?? { label: humanise(row.label), tone: 'neutral' };
                return (
                  <li key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2"><StatusDot tone={status.tone} />{status.label}</span>
                      <span className="tabular font-semibold">{row.count}</span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                      <div
                        className="joboy-gradient h-full rounded-full transition-[width] duration-700"
                        style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-muted-foreground flex h-28 flex-col items-center justify-center gap-2 text-center text-xs">
              <BadgeCheck className="size-6 text-success" /> No active bookings waiting.
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" className="mt-5 w-full" onClick={() => onNavigate('bookings')}>
          Open booking pipeline <ChevronRight />
        </Button>
      </div>
    </Panel>
  );
}

function PulseStat({ label, value, tone }) {
  const iconTone = {
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[tone] ?? 'text-primary';

  return (
    <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px]">{label}</span>
        <CircleAlert className={`size-3.5 ${iconTone}`} />
      </div>
      <div className="tabular mt-1 text-xl font-semibold">{formatNumber(value)}</div>
    </div>
  );
}

const STATUS_BAR_COLOR = {
  pending: 'var(--warning)',
  confirmed: 'var(--info)',
  in_progress: 'var(--accent)',
  completed: 'var(--success)',
  cancelled: 'var(--destructive)',
  rescheduled: 'var(--primary)',
};

const ESCALATION_STATUS = {
  open: { label: 'Open', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

/**
 * Funnel as a list rather than a chart: the interesting number is the drop
 * between consecutive steps, and stacked bars make that harder to read than
 * showing each step against the first.
 */
function FunnelList({ funnel }) {
  const steps = [
    { key: 'conversation_started', label: 'Conversation started' },
    { key: 'service_selected', label: 'Service selected' },
    { key: 'booking_confirmed', label: 'Booking confirmed' },
    { key: 'complaint_submitted', label: 'Complaint submitted' },
  ];

  const top = funnel.conversation_started || 0;

  if (!top) {
    return (
      <div className="text-muted-foreground flex h-full min-h-[200px] items-center justify-center text-sm">
        No conversation events recorded yet.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const value = funnel[step.key] ?? 0;
        const share = value / top;
        return (
          <li key={step.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{step.label}</span>
              <span className="tabular font-medium">{value}</span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width]"
                style={{ width: `${Math.max(share * 100, value > 0 ? 3 : 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ComplaintCategoryList({ data }) {
  if (!data?.length) {
    return (
      <div className="text-muted-foreground flex min-h-[160px] items-center justify-center text-sm">
        No complaints in this period.
      </div>
    );
  }

  const top = data[0].count;

  return (
    <ul className="space-y-2.5">
      {data.slice(0, 6).map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm">{humanise(row.label)}</span>
          <div className="bg-muted hidden h-2 w-32 overflow-hidden rounded-full sm:block">
            <div
              className="bg-accent h-full rounded-full"
              style={{ width: `${(row.count / top) * 100}%` }}
            />
          </div>
          <span className="tabular w-8 text-right text-sm font-medium">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

function UnansweredSurveys({ count }) {
  if (!count) {
    return (
      <div className="text-muted-foreground flex min-h-[160px] items-center justify-center text-sm">
        Every survey sent has been answered.
      </div>
    );
  }

  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
      <AlertTriangle className="text-warning size-6" />
      <div className="tabular text-2xl font-semibold">{count}</div>
      <p className="text-muted-foreground max-w-xs text-sm">
        Surveys sent with no reply. The backend retries these on its next sweep.
      </p>
    </div>
  );
}

function humanise(value) {
  return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/*
 * Owner sub-modules
 *
 * Owners can see bookings, complaints and escalations but not act on them —
 * that is the agent's job. These are read-only views of the same overview
 * query rather than separate fetches, so the numbers cannot disagree.
 */

function OwnerBookings({ overview }) {
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

function RecentBookings({ limit = 15, compact = false }) {
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

function OwnerComplaints({ overview }) {
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

function complaintAgeDays(complaint) {
  const start = new Date(complaint.created_at).getTime();
  const end = ['resolved', 'closed'].includes(complaint.status) && complaint.updated_at
    ? new Date(complaint.updated_at).getTime()
    : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 864e5));
}

function OwnerEscalations() {
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
          { header: 'Summary', value: (row) => row.conversation_summary },
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
          ['Conversation summary', detail.conversation_summary],
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

function RecordBulkActions({ selectedIds, rows, statusOptions, pending, onApply, onClear, exportName, exportColumns }) {
  const [nextStatus, setNextStatus] = useState('');
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  return (
    <BulkActionBar count={selectedIds.length} onClear={onClear}>
      <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="bg-background h-8 rounded-lg border px-2 text-xs" aria-label="Choose status for selected records">
        <option value="">Choose status…</option>
        {Object.entries(statusOptions).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
      </select>
      <Button size="sm" disabled={!nextStatus || pending} onClick={() => onApply(nextStatus)}>{pending ? 'Updating…' : 'Apply'}</Button>
      <Button variant="outline" size="sm" onClick={() => downloadCsv(stamp(exportName), selectedRows, exportColumns)}><Download /> Export</Button>
    </BulkActionBar>
  );
}

function QueueMetric({ label, value, tone = 'info' }) {
  const tones = {
    info: 'border-info/20 bg-info/7 text-info',
    warning: 'border-warning/25 bg-warning/8 text-warning',
    success: 'border-success/20 bg-success/7 text-success',
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] ?? tones.info}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{formatNumber(value)}</div>
    </div>
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
