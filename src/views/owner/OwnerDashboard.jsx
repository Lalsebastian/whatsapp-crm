import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, CalendarDays, Receipt, Star, TrendingUp, Wrench } from 'lucide-react';
import { getOverview, getServiceMix } from '@/lib/api/analytics';
import { queryKeys } from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import { ChartPanel, ViewShell } from '@/components/layout/ViewShell';
import { useModule } from '@/hooks/useModule';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { RangePicker } from '@/components/data/FilterBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { DashboardCustomizer } from '@/components/data/DashboardCustomizer';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { MixChart, RevenueChart, UtilizationChart, VolumeChart } from '@/components/charts/LazyCharts';
import { OwnerCalendar, OwnerCustomers, TodayCommandCentre } from '@/views/owner/OwnerExperienceViews';
import { OwnerAuditLog, OwnerDispatch, OwnerReports } from '@/views/owner/OwnerOperationsViews';
import { OwnerControlCentre } from '@/views/owner/OwnerControlCentre';
import { ChatbotAnalytics } from '@/views/owner/ChatbotAnalytics';
import { Button } from '@/components/ui/button';
import { useWorkspacePreferences } from '@/hooks/useWorkspacePreferences';
import {
  ComplaintCategoryList,
  ExecutiveHero,
  FunnelList,
  OperationalPulse,
  SectionHeading,
  UnansweredSurveys,
} from '@/views/owner/OwnerOverviewParts';
import { comparisonDelta, STATUS_BAR_COLOR } from '@/views/owner/ownerRecordUtils';
import { OwnerBookings, RecentBookings } from '@/views/owner/OwnerBookingsView';
import { OwnerComplaints } from '@/views/owner/OwnerComplaintsView';
import { OwnerEscalations } from '@/views/owner/OwnerEscalationsView';

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
