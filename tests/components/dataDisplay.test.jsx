import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Receipt } from 'lucide-react';
import { KpiCard } from '@/components/data/KpiCard';
import { StatusBadge } from '@/components/data/StatusBadge';
import { SlaBadge } from '@/components/data/SlaBadge';
import { EmptyFilter, EmptyState, ErrorState } from '@/components/data/EmptyState';
import { BulkActionBar } from '@/components/data/BulkActionBar';

describe('KpiCard', () => {
  it('shows the label, the caller-formatted value and the definition hint', () => {
    render(<KpiCard label="Revenue" value="AED 12.4K" hint="Sum of 31 completed jobs" icon={Receipt} />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('AED 12.4K')).toBeInTheDocument();
    expect(screen.getByTitle('Sum of 31 completed jobs')).toBeInTheDocument();
  });

  it('shows the period comparison instead of the hint, coloured by direction', () => {
    render(<KpiCard label="Bookings" value="40" hint="hidden" delta={{ label: '-12% vs previous period', tone: 'negative' }} />);
    expect(screen.getByText('-12% vs previous period')).toHaveClass('text-destructive');
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
  });

  it('renders a skeleton instead of a value while loading', () => {
    render(<KpiCard label="CSAT" value="4.8" loading />);
    expect(screen.queryByText('4.8')).not.toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('falls back to the neutral style for an unknown tone instead of rendering blank', () => {
    render(<StatusBadge tone="made-up">Mystery</StatusBadge>);
    expect(screen.getByText('Mystery')).toHaveAttribute('data-slot', 'status-badge');
  });
});

describe('SlaBadge', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['fresh urgent escalation', { created_at: '2026-10-04T11:30:00Z', status: 'open', priority: 'urgent' }, 'escalation', '30m remaining'],
    ['overdue urgent escalation', { created_at: '2026-10-04T10:00:00Z', status: 'open', priority: 'urgent' }, 'escalation', '1h overdue'],
    ['resolved complaint', { created_at: '2026-10-01T10:00:00Z', status: 'resolved' }, 'complaint', 'SLA complete'],
    ['undated complaint', { status: 'open' }, 'complaint', 'No SLA'],
  ])('labels a %s correctly', (_name, record, entityType, label) => {
    vi.useFakeTimers({ now: new Date('2026-10-04T12:00:00Z') });
    render(<SlaBadge record={record} entityType={entityType} />);
    expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
  });
});

describe('empty and error states', () => {
  it('distinguishes "no matches" from "nothing yet" and offers to clear filters', async () => {
    const onClear = vi.fn();
    render(<EmptyFilter onClear={onClear} />);
    expect(screen.getByText('No matches')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows the underlying error message and a retry action', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={{ message: 'permission denied for table bookings' }} onRetry={onRetry} />);
    expect(screen.getByText(/permission denied for table bookings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders a custom empty message', () => {
    render(<EmptyState title="No bookings yet" description="New WhatsApp bookings appear here." />);
    expect(screen.getByText('No bookings yet')).toBeInTheDocument();
    expect(screen.getByText('New WhatsApp bookings appear here.')).toBeInTheDocument();
  });
});

describe('BulkActionBar', () => {
  it('stays hidden with nothing selected', () => {
    render(<BulkActionBar count={0} onClear={() => {}}><button type="button">Apply</button></BulkActionBar>);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('states the selection count and clears it', async () => {
    const onClear = vi.fn();
    render(<BulkActionBar count={3} onClear={onClear}><button type="button">Apply</button></BulkActionBar>);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('3 selected');
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
