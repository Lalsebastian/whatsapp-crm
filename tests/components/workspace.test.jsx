import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardCustomizer } from '@/components/data/DashboardCustomizer';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { toast } from '@/lib/toast';

function CustomizerHarness() {
  const dashboard = useDashboardWidgets();
  return <DashboardCustomizer widgets={dashboard.widgets} onToggle={dashboard.toggle} onReset={dashboard.reset} />;
}

describe('dashboard customisation', () => {
  it('hides a section, counts what is visible and restores the default layout', async () => {
    render(<CustomizerHarness />);
    await userEvent.click(screen.getByRole('button', { name: /Customize/ }));

    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Show Operations' }));
    expect(screen.getByText('4 of 5')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show Operations' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /Restore default layout/ }));
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
  });

  it('remembers the layout on this device', () => {
    const first = renderHook(() => useDashboardWidgets());
    act(() => first.result.current.toggle('revenue'));
    first.unmount();

    const second = renderHook(() => useDashboardWidgets());
    expect(second.result.current.widgets.revenue).toBe(false);
    expect(second.result.current.widgets.today).toBe(true);
  });

  it('survives corrupted stored preferences', () => {
    window.localStorage.setItem('joboy.owner.dashboard.widgets', '{not json');
    const { result } = renderHook(() => useDashboardWidgets());
    expect(Object.values(result.current.widgets).every(Boolean)).toBe(true);
  });
});

describe('toasts', () => {
  it('shows a published toast, runs its action once, and can be dismissed', async () => {
    const undo = vi.fn();
    render(<ToastProvider><div /></ToastProvider>);

    act(() => toast({ title: 'Booking status updated', description: 'BK-1 is now Completed.', action: { label: 'Undo', onClick: undo } }));
    expect(screen.getByRole('status')).toHaveTextContent('Booking status updated');

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('Booking status updated')).not.toBeInTheDocument();
  });

  it('announces errors assertively and auto-dismisses after their duration', () => {
    vi.useFakeTimers();
    try {
      render(<ToastProvider><div /></ToastProvider>);
      act(() => toast({ title: 'Booking update failed', tone: 'error', duration: 1000 }));
      expect(screen.getByRole('alert')).toHaveTextContent('Booking update failed');
      act(() => vi.advanceTimersByTime(1001));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a safe no-op when no provider is mounted', () => {
    expect(() => toast('nobody is listening')).not.toThrow();
  });
});
