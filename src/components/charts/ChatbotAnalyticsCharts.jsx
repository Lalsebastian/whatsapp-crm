import { useMemo } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { baseScales, baseTooltip, useChartTheme } from '@/components/charts/setup';
import { cn } from '@/lib/utils';

function ChartFrame({ children, className, height = 250 }) {
  return <div className={cn('w-full', className)} style={{ height }}>{children}</div>;
}

export function ConversationTrendChart({ data, className }) {
  const theme = useChartTheme();
  const config = useMemo(() => ({
    data: {
      labels: (data || []).map((item) => item.label),
      datasets: [{
        label: 'Conversations',
        data: (data || []).map((item) => item.count),
        borderColor: theme.palette[0],
        backgroundColor: `${theme.palette[0]}20`,
        fill: true,
        tension: 0.3,
        pointRadius: (data || []).length > 31 ? 0 : 2,
        pointHoverRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: baseTooltip(theme) },
      scales: baseScales(theme),
    },
  }), [data, theme]);
  return <ChartFrame className={className}><Line {...config} /></ChartFrame>;
}

export function ComparisonTrendChart({ data, className }) {
  const theme = useChartTheme();
  const config = useMemo(() => ({
    data: {
      labels: (data || []).map((item) => item.label),
      datasets: [
        { label: 'AI requests', data: (data || []).map((item) => item.requests), backgroundColor: theme.palette[0], borderRadius: 4 },
        { label: 'Fallbacks', data: (data || []).map((item) => item.fallbacks), backgroundColor: theme.palette[3], borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: theme.muted, usePointStyle: true } }, tooltip: baseTooltip(theme) },
      scales: baseScales(theme),
    },
  }), [data, theme]);
  return <ChartFrame className={className}><Bar {...config} /></ChartFrame>;
}

export function BreakdownDonut({ data, className, emptyLabel = 'No data in this period' }) {
  const theme = useChartTheme();
  const config = useMemo(() => ({
    data: {
      labels: (data || []).map((item) => item.label),
      datasets: [{
        data: (data || []).map((item) => item.count),
        backgroundColor: (data || []).map((_, index) => theme.palette[index % theme.palette.length]),
        borderColor: theme.tooltipBg,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: { legend: { position: 'bottom', labels: { color: theme.muted, usePointStyle: true, boxWidth: 8 } }, tooltip: baseTooltip(theme) },
    },
  }), [data, theme]);

  if (!data?.some((item) => item.count > 0)) {
    return <div className="text-muted-foreground flex h-[250px] items-center justify-center text-sm">{emptyLabel}</div>;
  }
  return <ChartFrame className={className}><Doughnut {...config} /></ChartFrame>;
}
