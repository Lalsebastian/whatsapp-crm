import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Data access and realtime are the network boundary: replace them so views
// render deterministic data.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  listEscalations: vi.fn(),
  updateEscalation: vi.fn(),
}));
vi.mock('@/hooks/useRealtime', () => ({ useLiveUpdates: () => {}, useRealtime: () => {} }));

// Each console is replaced by a marker so routing can be tested on its own.
vi.mock('@/views/owner/OwnerDashboard', () => ({ OwnerDashboard: () => <h1>Owner console</h1> }));
vi.mock('@/views/agent/AgentDashboard', () => ({ AgentDashboard: () => <h1>Agent console</h1> }));
vi.mock('@/views/tech/TechDashboard', () => ({ TechDashboard: () => <h1>Technician console</h1> }));
vi.mock('@/components/layout/AppShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { AppShell: () => <main><Outlet /></main> };
});

const api = await import('@/lib/api');
const { AgentEscalations } = await import('@/views/agent/AgentEscalations');
const { default: App } = await import('@/App');
const { UserProvider } = await import('@/hooks/useCurrentUser');

function renderWithProviders(ui, { route = '/' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Agent escalations view', () => {
  beforeEach(() => {
    api.listEscalations.mockReset();
    api.updateEscalation.mockReset();
  });

  it('lists handoffs with the reason, summary and a call link', async () => {
    api.listEscalations.mockResolvedValue([
      { id: 'e1', phone: '971501234567', reason: 'customer_requested_human', conversation_summary: 'AC leaking again after repair', status: 'open' },
    ]);

    renderWithProviders(<AgentEscalations />);

    expect(await screen.findByText('1 escalations')).toBeInTheDocument();
    expect(screen.getByText('Customer requested human')).toBeInTheDocument();
    expect(screen.getByText('AC leaking again after repair')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:971501234567');
  });

  it('opens agent assist with the suggested reply, next step and a prefilled WhatsApp link', async () => {
    const handoff = {
      reason: 'repeat_service_failure',
      assist: {
        summary: 'AC not cooling again two days after the repair visit.',
        suggestedReply: 'Hi Aisha, I am sorry the AC is not cooling again.',
        recommendedNextAction: 'Offer a free revisit within 48 hours.',
        source: 'ai',
      },
    };
    api.listEscalations.mockResolvedValue([{
      id: 'e2', phone: '971501234567', reason: 'repeat_service_failure', status: 'open',
      created_at: new Date(Date.now() - 50 * 60000).toISOString(),
      conversation_summary: `Customer reports AC issue

Structured handoff:
${JSON.stringify(handoff)}`,
    }]);

    renderWithProviders(<AgentEscalations />);

    expect(await screen.findByText('AC not cooling again two days after the repair visit.')).toBeInTheDocument();
    expect(screen.getByText('Repeat service failure')).toBeInTheDocument();
    expect(screen.getByText(/waiting 50 min/)).toBeInTheDocument();
    expect(screen.queryByText(/Structured handoff/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reply with Assist' }));
    const panel = screen.getByRole('region', { name: 'Agent assist' });
    expect(panel).toHaveTextContent('Offer a free revisit within 48 hours.');

    const reply = screen.getByLabelText('Suggested reply');
    await userEvent.clear(reply);
    await userEvent.type(reply, 'Hello again');
    expect(screen.getByRole('link', { name: /Open in WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/971501234567?text=Hello%20again');
  });

  it('shows an explicit empty state', async () => {
    api.listEscalations.mockResolvedValue([]);
    renderWithProviders(<AgentEscalations />);
    expect(await screen.findByText('No escalations.')).toBeInTheDocument();
  });

  it('surfaces a load failure and retries on request', async () => {
    api.listEscalations
      .mockRejectedValueOnce(new Error('JWT expired'))
      .mockResolvedValueOnce([]);
    renderWithProviders(<AgentEscalations />);

    expect(await screen.findByText(/JWT expired/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('No escalations.')).toBeInTheDocument();
  });
});

describe('role-based routing', () => {
  it.each([
    ['owner', 'Owner console'],
    ['agent', 'Agent console'],
    ['tech', 'Technician console'],
  ])('sends the %s role to its own console from /', async (role, heading) => {
    window.localStorage.setItem('crm-console-role', role);
    renderWithProviders(<UserProvider><App /></UserProvider>);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('redirects a role away from another role\'s console', async () => {
    window.localStorage.setItem('crm-console-role', 'tech');
    renderWithProviders(<UserProvider><App /></UserProvider>, { route: '/owner' });
    expect(await screen.findByRole('heading', { name: 'Technician console' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Owner console' })).not.toBeInTheDocument();
  });

  it('falls back to the owner console for an unknown stored role', async () => {
    window.localStorage.setItem('crm-console-role', 'superuser');
    renderWithProviders(<UserProvider><App /></UserProvider>, { route: '/nowhere' });
    expect(await screen.findByRole('heading', { name: 'Owner console' })).toBeInTheDocument();
  });
});
