import { useModule } from '@/hooks/useModule';
import { AgentInbox } from '@/views/agent/AgentInbox';
import { AgentBoard } from '@/views/agent/AgentBoard';
import { AgentBookings } from '@/views/agent/AgentBookings';
import { AgentEscalations } from '@/views/agent/AgentEscalations';

/*
 * Operations Agent.
 *
 * Read-only by design. There is no backend endpoint that sends a WhatsApp
 * message on an operator's behalf — the only outbound path lives inside the bot
 * flow handlers — so the Inbox deliberately offers no reply control rather than
 * a button that would need to be disabled forever. Replies happen in the
 * WhatsApp Business app until that API exists.
 */
export function AgentDashboard() {
  const { active } = useModule('inbox');

  if (active === 'board') return <AgentBoard />;
  if (active === 'bookings') return <AgentBookings />;
  if (active === 'escalations') return <AgentEscalations />;
  return <AgentInbox />;
}
