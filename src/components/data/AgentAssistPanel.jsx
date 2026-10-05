import { useState } from 'react';
import { Copy, MessageCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappReplyLink } from '@/lib/handoff';
import { toast } from '@/lib/toast';

/*
 * Agent assist for one handoff: the recommended next step and a suggested
 * first reply the agent can edit, then send from WhatsApp Business with one
 * click. Nothing is sent from the dashboard itself.
 */
export function AgentAssistPanel({ phone, assist }) {
  const [reply, setReply] = useState(assist?.suggestedReply ?? '');
  if (!assist) return null;
  const link = whatsappReplyLink(phone, reply);

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(reply);
      toast({ title: 'Reply copied', tone: 'info' });
    } catch {
      toast({ title: 'Could not copy the reply', description: 'Select the text and copy it manually.', tone: 'error' });
    }
  }

  return (
    <section aria-label="Agent assist" className="bg-primary/[0.04] border-primary/15 mt-2 space-y-2 rounded-xl border p-3">
      <div className="text-primary flex items-center gap-1.5 text-xs font-semibold">
        <Sparkles className="size-3.5" /> Agent assist{assist.source === 'ai' ? '' : ' (standard reply)'}
      </div>
      {assist.recommendedNextAction ? (
        <p className="text-xs"><span className="font-medium">Next step: </span>{assist.recommendedNextAction}</p>
      ) : null}
      {assist.suggestedReply ? (
        <>
          <label className="block text-xs font-medium" htmlFor={`assist-reply-${phone}`}>Suggested reply</label>
          <textarea
            id={`assist-reply-${phone}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            className="bg-background w-full rounded-lg border p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {link ? (
              <Button asChild size="sm">
                <a href={link} target="_blank" rel="noreferrer"><MessageCircle /> Open in WhatsApp</a>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={copyReply}><Copy /> Copy</Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
