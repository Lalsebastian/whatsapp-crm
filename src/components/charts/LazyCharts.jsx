import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/*
 * Lazy chart entry points.
 *
 * Chart.js and react-chartjs-2 are the largest dependencies in the console
 * (~500 KB unminified). Views import charts from here instead of from the
 * chart modules, so the library is fetched only when a chart is actually on
 * screen, in its own cacheable chunk, and every other view loads without it.
 * The placeholder keeps the chart's height so the layout does not jump.
 */
function ChartPlaceholder({ height = 240, className }) {
  return (
    <div className={cn('w-full', className)} style={{ height }} role="status" aria-label="Loading chart">
      <Skeleton className="size-full rounded-md" />
    </div>
  );
}

function lazyChart(load, exportName) {
  const Chart = lazy(() => load().then((module) => ({ default: module[exportName] })));
  function LazyChart(props) {
    return (
      <Suspense fallback={<ChartPlaceholder height={props.height} className={props.className} />}>
        <Chart {...props} />
      </Suspense>
    );
  }
  LazyChart.displayName = `Lazy${exportName}`;
  return LazyChart;
}

const loadCharts = () => import('@/components/charts/Charts');
const loadTrendCharts = () => import('@/components/charts/TrendCharts');
const loadChatbotCharts = () => import('@/components/charts/ChatbotAnalyticsCharts');

export const RevenueChart = lazyChart(loadCharts, 'RevenueChart');
export const VolumeChart = lazyChart(loadCharts, 'VolumeChart');
export const MixChart = lazyChart(loadCharts, 'MixChart');
export const UtilizationChart = lazyChart(loadTrendCharts, 'UtilizationChart');
export const ConversationTrendChart = lazyChart(loadChatbotCharts, 'ConversationTrendChart');
export const ComparisonTrendChart = lazyChart(loadChatbotCharts, 'ComparisonTrendChart');
export const BreakdownDonut = lazyChart(loadChatbotCharts, 'BreakdownDonut');
