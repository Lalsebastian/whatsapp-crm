import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  Gauge,
  MessageSquareWarning,
  Star,
  UsersRound,
} from 'lucide-react';
import { formatNumber, formatPercent } from '@/lib/utils';
import { BOOKING_STATUS } from '@/lib/status';
import { StatusDot } from '@/components/data/StatusBadge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/layout/Panel';
import { humanise } from '@/views/owner/ownerRecordUtils';

// Sections of the executive overview: hero, pulse, funnel and customer-care panels.

export function SectionHeading({ eyebrow, title, description }) {
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

export function ExecutiveHero({ kpis, utilisation, range, onNavigate }) {
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

export function OperationalPulse({ kpis, bookingsByStatus, onNavigate, className }) {
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

/**
 * Funnel as a list rather than a chart: the interesting number is the drop
 * between consecutive steps, and stacked bars make that harder to read than
 * showing each step against the first.
 */
export function FunnelList({ funnel }) {
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

export function ComplaintCategoryList({ data }) {
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

export function UnansweredSurveys({ count }) {
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
