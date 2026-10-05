import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listEscalations, updateEscalation } from '@/lib/api';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { formatPhone } from '@/lib/utils';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { StatusSelect } from '@/components/data/RecordActions';
import { Button } from '@/components/ui/button';
import { ESCALATION_STATUS_OPTIONS, humanise } from '@/views/agent/agentRecordUtils';
import { SlaBadge } from '@/components/data/SlaBadge';
import { AgentAssistPanel } from '@/components/data/AgentAssistPanel';
import { formatWaiting, parseHandoff, waitingMinutes } from '@/lib/handoff';

export function AgentEscalations() {
  const queryClient = useQueryClient();
  const [openAssist, setOpenAssist] = useState(null);

  useLiveUpdates(['escalations']);

  const escalations = useQuery({
    queryKey: ['escalations', 'agent'],
    queryFn: () => listEscalations({}),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => updateEscalation(id, {
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['escalations'] }),
  });

  if (escalations.isError) {
    return (
      <ViewShell title="Escalations">
        <ErrorState error={escalations.error} onRetry={escalations.refetch} />
      </ViewShell>
    );
  }

  return (
    <ViewShell title="Escalations" description="Conversations handed off to a human">
      <Panel>
        <PanelHeader>
          <PanelTitle>{(escalations.data ?? []).length} escalations</PanelTitle>
        </PanelHeader>
        <PanelBody scroll={false}>
          {escalations.isLoading ? (
            <PanelSkeleton rows={5} />
          ) : (
            <ul className="divide-border divide-y">
              {(escalations.data ?? []).map((esc) => {
                const { summary, assist } = parseHandoff(esc.conversation_summary);
                const waiting = esc.status === 'open' ? waitingMinutes(esc.created_at) : null;
                const expanded = openAssist === esc.id;
                return (
                <li key={esc.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="tabular w-28 shrink-0 text-xs">{formatPhone(esc.phone)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm">{humanise(esc.reason)}</span>
                      {esc.status === 'open' ? <SlaBadge record={esc} entityType="escalation" /> : null}
                      {waiting != null ? <span className="text-muted-foreground text-[11px]">waiting {formatWaiting(waiting)}</span> : null}
                    </div>
                    {summary ? (
                      <div className={expanded ? 'text-muted-foreground text-xs' : 'text-muted-foreground line-clamp-1 text-xs'}>
                        {summary}
                      </div>
                    ) : null}
                    {expanded ? <AgentAssistPanel phone={esc.phone} assist={assist} /> : null}
                  </div>
                  {assist ? (
                    <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpenAssist(expanded ? null : esc.id)}>
                      {expanded ? 'Hide Assist' : 'Reply with Assist'}
                    </Button>
                  ) : null}
                  <StatusSelect
                    compact
                    value={esc.status}
                    options={ESCALATION_STATUS_OPTIONS}
                    disabled={statusMutation.isPending && statusMutation.variables?.id === esc.id}
                    ariaLabel={`Change escalation status for ${esc.phone}`}
                    onChange={(status) => statusMutation.mutate({ id: esc.id, status })}
                  />
                  {esc.phone ? <Button asChild size="sm" variant="outline"><a href={`tel:${esc.phone}`}>Call</a></Button> : null}
                </li>
                );
              })}
              {(escalations.data ?? []).length === 0 ? (
                <li className="text-muted-foreground py-12 text-center text-sm">
                  No escalations.
                </li>
              ) : null}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </ViewShell>
  );
}
