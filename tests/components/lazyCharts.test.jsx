import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Chart.js needs a real canvas; the chart modules are replaced so this test
// only covers the lazy-loading contract of LazyCharts.
const loaded = vi.fn();
vi.mock('@/components/charts/Charts', () => {
  loaded();
  return {
    RevenueChart: ({ data }) => <div data-testid="revenue-chart">{data.length} points</div>,
    VolumeChart: () => <div data-testid="volume-chart" />,
    MixChart: () => <div data-testid="mix-chart" />,
  };
});

describe('lazy charts', () => {
  it('does not load the chart library until a chart is rendered', async () => {
    const { RevenueChart } = await import('@/components/charts/LazyCharts');
    expect(loaded).not.toHaveBeenCalled();

    render(<RevenueChart data={[1, 2, 3]} height={180} />);

    // Placeholder with the chart's height while the chunk loads.
    expect(screen.getByRole('status', { name: 'Loading chart' })).toHaveStyle({ height: '180px' });
    expect(await screen.findByTestId('revenue-chart')).toHaveTextContent('3 points');
    expect(loaded).toHaveBeenCalledOnce();
  });
});
