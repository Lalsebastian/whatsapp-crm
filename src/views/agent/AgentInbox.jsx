import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSession, listConversationPhones, listMessages } from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { formatDateTime, formatPhone, formatRelative } from '@/lib/utils';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { Tag } from '@/components/data/StatusBadge';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { Button } from '@/components/ui/button';
import { MessageSquareOff, MessagesSquare } from 'lucide-react';

export function AgentInbox() {
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  useLiveUpdates(['messages']);

  const phones = useQuery({ queryKey: ['messages', 'phones'], queryFn: () => listConversationPhones() });

  if (phones.isError) {
    return (
      <ViewShell title="Inbox" scroll={false}>
        <ErrorState error={phones.error} onRetry={phones.refetch} />
      </ViewShell>
    );
  }

  if (phones.isLoading) {
    return (
      <ViewShell title="Inbox" scroll={false}>
        <PanelSkeleton rows={8} />
      </ViewShell>
    );
  }

  const list = phones.data ?? [];
  const activePhone = selectedPhone ?? list[0]?.phone ?? null;

  return (
    <ViewShell
      title="Inbox"
      description="Read-only. Reply in the WhatsApp Business app."
      scroll={false}
    >
      <Panel className="min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="border-border flex w-full shrink-0 flex-col border-b md:w-72 md:border-r md:border-b-0">
            <PanelHeader className="py-2.5">
              <PanelTitle>Conversations</PanelTitle>
              <span className="text-muted-foreground ml-auto text-xs">{list.length}</span>
            </PanelHeader>
            <PanelBody className="max-h-48 md:max-h-none">
              <ul className="divide-border divide-y">
                {list.map((conv) => (
                  <li key={conv.phone}>
                    <button
                      type="button"
                      onClick={() => setSelectedPhone(conv.phone)}
                      className={
                        conv.phone === activePhone
                          ? 'bg-accent/10 border-accent/40 w-full border-l-2 px-3 py-2.5 text-left'
                          : 'hover:bg-muted/50 w-full border-l-2 border-transparent px-3 py-2.5 text-left'
                      }
                    >
                      <div className="tabular truncate text-sm font-medium">
                        {formatPhone(conv.phone)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelative(conv.lastActivityAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </aside>

          <ConversationDetail phone={activePhone} />
        </div>
      </Panel>

      <BulkActionBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
        <Button size="sm" variant="outline" onClick={() => setSelectedIds([])}>
          Clear
        </Button>
      </BulkActionBar>
    </ViewShell>
  );
}

function ConversationDetail({ phone }) {
  const messages = useQuery({
    queryKey: ['messages', phone],
    queryFn: () => listMessages({ phone }),
    enabled: Boolean(phone),
  });

  const session = useQuery({
    queryKey: ['sessions', phone],
    queryFn: () => getSession(phone),
    enabled: Boolean(phone),
  });

  if (!phone) {
    return (
      <PanelBody className="text-muted-foreground flex items-center justify-center p-8 text-sm">
        <MessagesSquare className="mr-2 size-4" />
        No conversations yet.
      </PanelBody>
    );
  }

  const history = (messages.data ?? []).slice().reverse();
  const state = session.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader className="flex-wrap gap-y-1">
        <div className="min-w-0">
          <PanelTitle className="tabular">{formatPhone(phone)}</PanelTitle>
          {state?.state ? (
            <div className="text-muted-foreground text-xs">
              State <span className="font-medium">{state.state}</span>
              {state.current_flow ? ` · ${state.current_flow}` : ''}
              {state.human_takeover ? ' · human takeover' : ''}
            </div>
          ) : null}
        </div>
        <NoSendControl />
      </PanelHeader>

      <PanelBody className="p-4">
        {session.isError ? (
          <ErrorState error={session.error} onRetry={session.refetch} compact />
        ) : messages.isError ? (
          <ErrorState error={messages.error} onRetry={messages.refetch} compact />
        ) : (
          <ol className="space-y-3">
            {history.map((message) => {
              const outbound = message.direction === 'outbound';
              return (
                <li
                  key={message.id}
                  className={
                    outbound
                      ? 'bg-muted/60 ml-auto max-w-[85%] rounded-lg rounded-br-sm p-2.5'
                      : 'bg-accent/8 mr-auto max-w-[85%] rounded-lg rounded-bl-sm p-2.5'
                  }
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span>{formatDateTime(message.created_at)}</span>
                    {!outbound ? <span>· {message.direction}</span> : null}
                    {message.intent ? <Tag>{message.intent}</Tag> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </PanelBody>
    </div>
  );
}

/**
 * The disabled affordance, stated plainly rather than hidden. Omitting it
 * entirely leaves people typing into nothing, which reads as a broken app.
 */
function NoSendControl() {
  return (
    <div className="bg-muted/60 text-muted-foreground flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs">
      <MessageSquareOff className="size-3.5" />
      Reply from WhatsApp Business
    </div>
  );
}
