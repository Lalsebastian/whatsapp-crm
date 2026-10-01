import { cn } from '@/lib/utils';
import { Panel } from '@/components/layout/Panel';
import { Skeleton } from '@/components/ui/skeleton';

/*
 * KpiCard
 *
 * A KPI that cannot explain itself is worse than no KPI, so every tile takes an
 * optional `hint` that states the definition inline ("sum of completed jobs").
 * `value` renders verbatim: the caller owns the formatting, because a currency
 * tile and a count tile format differently and a dumb component cannot know
 * which it is.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  delta,
  loading = false,
  className,
}) {
  return (
    <Panel data-tone={tone} className={cn('kpi-card surreal-kpi surface-shine group relative gap-0 overflow-hidden p-4 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_18px_42px_rgba(15,23,42,.11)]', className)}>
      <div className={cn('kpi-accent-line absolute inset-x-0 top-0 h-0.5 origin-left opacity-70', TONE_LINE[tone] ?? TONE_LINE.neutral)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground truncate text-xs font-medium">{label}</div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <div className="kpi-value tabular mt-1.5 truncate text-2xl leading-none font-semibold tracking-tight transition-transform duration-300">
              {value}
            </div>
          )}
        </div>

        {Icon ? (
          <Icon className="kpi-watermark pointer-events-none absolute -right-4 -bottom-5 size-24" aria-hidden="true" />
        ) : null}

        {Icon ? (
          <div
            className={cn(
              'surreal-icon flex size-8 shrink-0 items-center justify-center transition-[transform,box-shadow,border-radius] duration-500 group-hover:rotate-6 group-hover:scale-110 group-hover:shadow-md',
              TONE_ICON[tone] ?? TONE_ICON.neutral
            )}
          >
            <Icon className="size-4" strokeWidth={2.2} />
          </div>
        ) : null}
      </div>

      {delta ? (
        <div className={cn('mt-3 text-xs', delta.tone === 'negative' ? 'text-destructive' : 'text-success')}>
          {delta.label}
        </div>
      ) : hint ? (
        <div className="text-muted-foreground mt-3 truncate text-[11px]" title={hint}>
          {hint}
        </div>
      ) : null}
    </Panel>
  );
}

const TONE_ICON = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  info: 'bg-info/12 text-info',
  accent: 'bg-accent/12 text-accent',
  primary: 'bg-primary/14 text-primary',
  destructive: 'bg-destructive/12 text-destructive',
};

const TONE_LINE = {
  neutral: 'bg-muted-foreground/30',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  accent: 'bg-accent',
  primary: 'bg-primary',
  destructive: 'bg-destructive',
};

const GRID_COLS = {
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
};

/** Wraps a KPI row so every tile lines up regardless of label length. */
export function KpiGrid({ className, children, cols = 6 }) {
  return <div className={cn('grid gap-3', GRID_COLS[cols] ?? GRID_COLS[6], className)}>{children}</div>;
}
