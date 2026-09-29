import { useMemo } from 'react';
import { Line, Radar } from 'react-chartjs-2';
import { baseTooltip, useChartTheme } from '@/components/charts/setup';
import { cn } from '@/lib/utils';

/*
 * Sparkline — trend only, no axes, no legend.
 *
 * Deliberately not a Chart.js line: the shared defaults (font, padding, legend
 * registration) are tuned for full charts, and a sparkline inside a KPI tile
 * needs none of it. The axes and tooltip are stripped and the whole thing is
 * decorative — `aria-hidden`, because the number it sits under is the real
 * content and a screen reader announcing "line chart" adds nothing.
 */
export function Sparkline({ values, className, color, height = 32, fill = true }) {
  const theme = useChartTheme();

  const points = (values ?? []).map((v) => Number(v) || 0);
  if (points.length < 2) return <div style={{ height }} className={className} />;

  const stroke = color ?? theme.palette[0];

  // Fixed 0-100 viewBox scaled by CSS: avoids a resize observer per tile and
  // keeps a row of sparklines from reflowing as each one loads.
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const path = points
    .map((value, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 30 - ((value - min) / range) * 26 - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const area = `${path} L100,32 L0,32 Z`;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      aria-hidden="true"
    >
      {fill ? <path d={area} fill={stroke} opacity={0.12} /> : null}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Technician utilisation, 0-100% per technician.
 *
 * Capped at 100% on the axis with values allowed above it: an over-capacity
 * technician is the most actionable thing on this chart, and clipping them to
 * the axis would make the busiest person look identical to a perfectly loaded
 * one.
 */
export function UtilizationChart({ data, className, height = 260 }) {
  const theme = useChartTheme();

  const config = useMemo(
    () => ({
      type: 'radar',
      data: {
        labels: (data ?? []).map((d) => d.name),
        datasets: [
          {
            label: 'Utilisation %',
            data: (data ?? []).map((d) => Math.round((d.utilisation ?? 0) * 100)),
            borderColor: theme.palette[1],
            backgroundColor: `${theme.palette[1]}22`,
            pointBackgroundColor: theme.palette[1],
            pointRadius: 3,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...baseTooltip(theme),
            callbacks: { label: (ctx) => `${ctx.parsed.r}% utilised` },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            suggestedMax: 100,
            grid: { color: theme.grid },
            angleLines: { color: theme.grid },
            pointLabels: { color: theme.muted },
            ticks: {
              color: theme.muted,
              backdropColor: 'transparent',
              callback: (value) => `${value}%`,
            },
          },
        },
      },
    }),
    [data, theme]
  );

  if (!data?.length) {
    return (
      <div className={cn('text-muted-foreground flex items-center justify-center text-sm', className)} style={{ height }}>
        No technicians assigned yet.
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <Radar {...config} />
    </div>
  );
}

/** Revenue trend as a smooth line — used where the series is longer than ~14 days. */
export function TrendChart({ labels, values, className, height = 240 }) {
  const theme = useChartTheme();

  const config = useMemo(
    () => ({
      type: 'line',
      data: {
        labels: labels ?? [],
        datasets: [
          {
            label: 'Revenue',
            data: values ?? [],
            borderColor: theme.palette[0],
            backgroundColor: `${theme.palette[0]}1f`,
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...baseTooltip(theme),
            callbacks: { label: (ctx) => `AED ${Number(ctx.parsed.y).toLocaleString('en-AE')}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: theme.muted, maxRotation: 0, autoSkipPadding: 16 } },
          y: {
            beginAtZero: true,
            grid: { color: theme.grid },
            border: { display: false },
            ticks: { color: theme.muted, callback: (v) => `${Math.round(Number(v) / 1000)}k` },
          },
        },
      },
    }),
    [labels, values, theme]
  );

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <Line {...config} />
    </div>
  );
}
