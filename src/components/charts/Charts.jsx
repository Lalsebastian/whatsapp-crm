import { useMemo } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { baseScales, baseTooltip, useChartTheme } from '@/components/charts/setup';
import { cn } from '@/lib/utils';

/*
 * Revenue over time, as a bar chart rather than a line.
 *
 * Bars because the x-axis is discrete days: a line between two days implies a
 * value in between that does not exist, and it reads as "revenue accumulated
 * smoothly" when a spike is actually one large job.
 */
export function RevenueChart({ data, className, height = 240 }) {
  const theme = useChartTheme();

  const config = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: (data ?? []).map((d) => d.label ?? d.date),
        datasets: [
          {
            label: 'Revenue',
            data: (data ?? []).map((d) => d.revenue ?? 0),
            backgroundColor: theme.palette[0],
            borderRadius: 4,
            maxBarThickness: 28,
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
            callbacks: {
              label: (ctx) => `AED ${Number(ctx.parsed.y).toLocaleString('en-AE')}`,
            },
          },
        },
        scales: baseScales(theme, { money: true }),
      },
    }),
    [data, theme]
  );

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <Bar {...config} />
    </div>
  );
}

/** Booking volume split by status — colour comes from the same status palette. */
export function VolumeChart({ data, colors, className, height = 240, onItemClick }) {
  const theme = useChartTheme();

  const config = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: (data ?? []).map((d) => d.label),
        datasets: [
          {
            label: 'Bookings',
            data: (data ?? []).map((d) => d.count),
            backgroundColor: (data ?? []).map(
              (_, i) => colors?.[i] ?? theme.palette[i % theme.palette.length]
            ),
            borderRadius: 4,
            maxBarThickness: 40,
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
            callbacks: { label: (ctx) => `${ctx.parsed.y} bookings` },
          },
        },
        onClick: (_event, elements) => {
          const index = elements[0]?.index;
          if (index != null) onItemClick?.((data ?? [])[index], index);
        },
        onHover: (event, elements) => {
          if (event?.native?.target) event.native.target.style.cursor = elements.length && onItemClick ? 'pointer' : 'default';
        },
        scales: {
          ...baseScales(theme),
          x: { ...baseScales(theme).x, stacked: false },
        },
      },
    }),
    [data, colors, theme, onItemClick]
  );

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <Bar {...config} />
    </div>
  );
}

/** Service mix as a doughnut — parts of a whole, few enough slices to read. */
export function MixChart({ data, className, height = 240 }) {
  const theme = useChartTheme();

  const config = useMemo(
    () => ({
      type: 'doughnut',
      data: {
        labels: (data ?? []).map((d) => d.label),
        datasets: [
          {
            data: (data ?? []).map((d) => d.count),
            backgroundColor: (data ?? []).map((_, i) => theme.palette[i % theme.palette.length]),
            borderColor: theme.tooltipBg,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: theme.muted, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 },
          },
          tooltip: { ...baseTooltip(theme), callbacks: { label: (ctx) => `${ctx.parsed} jobs` } },
        },
      },
    }),
    [data, theme]
  );

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <Doughnut {...config} />
    </div>
  );
}
