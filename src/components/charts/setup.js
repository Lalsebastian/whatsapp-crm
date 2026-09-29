import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
} from 'chart.js';
import { useEffect, useState } from 'react';

/*
 * Chart.js setup, registered once.
 *
 * Registering per-file would re-register on every import and is what causes the
 * "Tree-shaking failed" warnings people hit with react-chartjs-2. The tree-shaken
 * build only includes what is registered here.
 */
ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip
);

ChartJS.defaults.font.family =
  "'Inter var', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
ChartJS.defaults.font.size = 11;

export { ChartJS };

const CHART_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
];

/**
 * Reads chart colours from CSS custom properties.
 *
 * Chart.js needs concrete colour strings and cannot resolve `var(--chart-1)`, so
 * the values are read from the document and the caller re-reads them when the
 * theme class changes. That is the only way charts follow the light/dark tokens
 * without duplicating the palette in JS.
 */
export function useChartTheme() {
  const [theme, setTheme] = useState(() => readTheme());

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => setTheme(readTheme());
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });

    return () => observer.disconnect();
  }, []);

  return theme;
}

function readTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    palette: CHART_VARS.map((v) => styles.getPropertyValue(v).trim()),
    grid: styles.getPropertyValue('--border').trim(),
    muted: styles.getPropertyValue('--muted-foreground').trim(),
    foreground: styles.getPropertyValue('--foreground').trim(),
    tooltipBg: styles.getPropertyValue('--popover').trim(),
    isDark: document.documentElement.classList.contains('dark'),
  };
}

/**
 * Shared scale/grid styling. Grid lines are drawn only on Y: vertical grid lines
 * behind a bar chart add ink without adding information.
 */
export function baseScales(theme, { money = false } = {}) {
  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: theme.muted, maxRotation: 0, autoSkipPadding: 16 },
    },
    y: {
      beginAtZero: true,
      grid: { color: theme.grid },
      border: { display: false },
      ticks: {
        color: theme.muted,
        callback: (value) => (money ? compactMoney(value) : value),
      },
    },
  };
}

export const baseTooltip = (theme) => ({
  backgroundColor: theme.tooltipBg,
  titleColor: theme.foreground,
  bodyColor: theme.muted,
  borderColor: theme.grid,
  borderWidth: 1,
  padding: 10,
  cornerRadius: 8,
  displayColors: true,
  boxPadding: 4,
});

export function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
