import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Receipt,
  Star,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { getOverview, getServiceMix } from '@/lib/api/analytics';
import { listBookings, listEscalations, queryKeys } from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@/lib/utils';
import { BOOKING_STATUS, complaintStatus } from '@/lib/status';
import { ChartPanel, ViewShell } from '@/components/layout/ViewShell';
import { useModule } from '@/hooks/useModule';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { StatusBadge, StatusDot } from '@/components/data/StatusBadge';
import { RangePicker } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { MixChart, RevenueChart, VolumeChart } from '@/components/charts/Charts';
import { UtilizationChart } from '@/components/charts/TrendCharts';

/*
 * Owner / Manager — the business view.
 *
 * Every tile states its own definition underneath. A number with no stated
 * denominator is the thing that makes people stop trusting a dashboard, and the
 * first question about "conversion rate" is always "out of what".
 */
export function OwnerDashboard() {
  const { active } = useModule('overview');
  const [range, setRange] = useState('30d');

  // Bookings and complaints feed the tiles and the charts, so a status change
  // anywhere in the app has to land here without a reload.
  useLiveUpdates(['bookings', 'complaints', 'satisfaction_surveys', 'conversation_events']);

  const overview = useQuery({
    queryKey: queryKeys.analytics.overview(range),
    queryFn: () => getOverview({ range }),
  });

  const mix = useQuery({
    queryKey: ['analytics', 'mix', range],
    queryFn: () => getServiceMix({ range }),
  });

  if (overview.isError) {
    return (
      <ViewShell title="Overview" description="Business performance at a glance">
        <ErrorState error={overview.error} onRetry={overview.refetch} />
      </ViewShell>
    );
  }

  if (overview.isLoading) {
    return (
      <ViewShell title="Overview" description="Business performance at a glance">
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

  const { kpis, series, daily, utilisation } = overview.data;

  if (active === 'bookings') return <OwnerBookings overview={overview.data} />;
  if (active === 'complaints') return <OwnerComplaints overview={overview.data} />;
  if (active === 'escalations') return <OwnerEscalations />;

  return (
    <ViewShell
      title="Overview"
      description="Business performance at a glance"
      actions={<RangePicker value={range} onChange={setRange} />}
    >
      {overview.data.warnings?.length ? (
        <div className="bg-warning/10 text-warning ring-warning/25 rounded-lg px-3 py-2 text-xs ring-1 ring-inset">
          Some optional analytics are unavailable: {overview.data.warnings.join(' · ')}
        </div>
      ) : null}
      <KpiGrid>
        <KpiCard
          label="Revenue"
          value={formatCompactCurrency(kpis.revenue)}
          icon={Receipt}
          tone="primary"
          hint={`Sum of ${formatNumber(kpis.completed)} completed jobs in this period`}
        />
        <KpiCard
          label="Bookings"
          value={formatNumber(kpis.bookings)}
          icon={CalendarDays}
          tone="info"
          hint={`${kpis.completed} completed, ${kpis.cancelled} cancelled`}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartPanel
          title="Revenue over time"
          description="Completed jobs, by scheduled date"
          className="lg:col-span-2"
        >
          <RevenueChart data={daily} height={260} />
        </ChartPanel>

        <ChartPanel title="Funnel" description="Distinct customers at each step">
          <FunnelList funnel={series.funnel} />
        </ChartPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartPanel title="Bookings by status" description="Volume across the pipeline">
          <VolumeChart
            data={series.bookingsByStatus}
            colors={series.bookingsByStatus.map((s) => STATUS_BAR_COLOR[s.label] ?? undefined)}
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Complaint categories" description="What customers are actually complaining about">
          <ComplaintCategoryList data={series.complaintsByCategory} />
        </ChartPanel>

        <ChartPanel title="Unanswered CSAT surveys" description="Sent, no reply yet">
          <UnansweredSurveys count={kpis.csatPending} />
        </ChartPanel>
      </div>
    </ViewShell>
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
    <ViewShell title="Bookings" description="Read-only view of the booking pipeline">
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

      <ChartPanel title="Recent bookings" description="Latest 15 by scheduled date">
        <RecentBookings />
      </ChartPanel>
    </ViewShell>
  );
}

function RecentBookings() {
  const { data, isLoading } = useQuery({
    queryKey: ['bookings', 'recent-owner'],
    queryFn: () => listBookings({}),
  });

  if (isLoading) return <PanelSkeleton rows={5} />;
  if (!data?.length) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No bookings yet.</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {data.slice(0, 15).map((booking) => {
        const status = BOOKING_STATUS[booking.status];
        return (
          <li key={booking.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="tabular text-muted-foreground w-24 shrink-0 truncate text-xs">
              {booking.reference}
            </span>
            <span className="min-w-0 flex-1 truncate">{booking.service?.name ?? '—'}</span>
            <span className="text-muted-foreground hidden w-32 shrink-0 truncate text-xs sm:block">
              {booking.customer?.name ?? booking.customer?.phone ?? '—'}
            </span>
            <span className="tabular w-20 shrink-0 text-right text-xs">
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
    </ViewShell>
  );
}

function OwnerEscalations() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['escalations', 'owner'],
    queryFn: () => listEscalations({}),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <PanelSkeleton rows={5} />;

  return (
    <ViewShell title="Escalations" description="Conversations handed off to a human">
      <ChartPanel title="All escalations" description={`${data?.length ?? 0} total`}>
        {!data?.length ? (
          <p className="text-muted-foreground py-12 text-center text-sm">No escalations.</p>
        ) : (
          <ul className="divide-border divide-y">
            {data.map((esc) => (
              <li key={esc.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="tabular text-muted-foreground w-28 shrink-0 text-xs">
                  {esc.phone}
                </span>
                <span className="min-w-0 flex-1 truncate">{esc.reason ?? '—'}</span>
                <StatusBadge tone={esc.status === 'resolved' ? 'success' : 'warning'}>
                  {esc.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </ChartPanel>
    </ViewShell>
  );
}
