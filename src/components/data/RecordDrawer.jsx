import { useEffect, useMemo, useState } from 'react';
import { Bookmark, CalendarClock, ChevronLeft, ChevronRight, CircleDot, FileText, Link2, Maximize2, Minimize2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AuditTrail } from '@/components/data/AuditTrail';
import { toast } from '@/lib/toast';
import { useWorkspacePreferences } from '@/hooks/useWorkspacePreferences';
import { cn } from '@/lib/utils';

export function RecordDrawer({ record, title, description, fields = [], timeline = [], actions, summary, navigation, activityEntity, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const { pinned: pinnedRecords, rememberRecord, togglePinned } = useWorkspacePreferences();
  const shareable = Boolean(record?.id && new URLSearchParams(window.location.search).get('record') === String(record.id));
  const recordHref = `${window.location.pathname}${window.location.search}`;
  const workspaceRecord = useMemo(() => record?.id ? { id: record.id, title, description, href: recordHref } : null, [record, title, description, recordHref]);
  const pinned = workspaceRecord ? pinnedRecords.some((item) => item.href === workspaceRecord.href) : false;

  useEffect(() => {
    if (workspaceRecord) rememberRecord(workspaceRecord);
  }, [workspaceRecord, rememberRecord]);
  return (
    <Sheet open={Boolean(record)} onOpenChange={(open) => !open && onClose?.()}>
      <SheetContent overlayClassName="record-drawer-overlay" className={cn('record-drawer w-full overflow-y-auto p-0 sm:max-w-xl lg:w-[46vw] lg:max-w-[44rem]', expanded && 'lg:w-[calc(100vw-17rem)] lg:max-w-none')}>
        <div className="record-drawer-hero relative overflow-hidden border-b px-6 pt-8 pb-6">
          <div className="record-drawer-orbit" aria-hidden="true" />
          <SheetHeader className="relative p-0 pr-8">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-info uppercase dark:text-primary">
              <CircleDot className="size-3.5" /> Record workspace
            </div>
            <SheetTitle className="text-xl tracking-tight">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
            {shareable ? <div className="mt-2 flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); toast({ title: 'Record link copied', description: 'You can share this exact CRM view.', tone: 'info' }); } catch { toast({ title: 'Could not copy link', description: 'Copy the address from your browser instead.', tone: 'error' }); } }}><Link2 /> Copy link</Button><Button variant={pinned ? 'secondary' : 'ghost'} size="sm" onClick={() => workspaceRecord && togglePinned(workspaceRecord)}><Bookmark className={pinned ? 'fill-current' : ''} />{pinned ? 'Pinned' : 'Pin record'}</Button><Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setExpanded((current) => !current)}>{expanded ? <Minimize2 /> : <Maximize2 />}{expanded ? 'Compact view' : 'Full workspace'}</Button></div> : null}
          </SheetHeader>
          {navigation ? (
            <div className="relative mt-5 flex items-center justify-between border-t border-primary/10 pt-3">
              <span className="text-muted-foreground text-[11px] font-medium">{navigation.label}</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" onClick={navigation.onPrevious} disabled={!navigation.hasPrevious} aria-label="Previous record"><ChevronLeft /></Button>
                <Button variant="outline" size="icon-sm" onClick={navigation.onNext} disabled={!navigation.hasNext} aria-label="Next record"><ChevronRight /></Button>
              </div>
            </div>
          ) : null}
        </div>

        {actions ? <div className="border-b border-border/70 bg-muted/20 px-6 py-4">{actions}</div> : null}

        <div className="space-y-7 p-6">
          {summary}
          <section>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
              <FileText className="size-4 text-info dark:text-primary" /> Details
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {fields.map(([label, value]) => {
                const wide = ['Notes', 'Description', 'Conversation summary', 'Service address'].includes(label);
                return (
                  <div
                    key={label}
                    className={`rounded-xl border border-border/70 bg-muted/30 p-3 ${wide ? 'sm:col-span-2' : ''}`}
                  >
                    <dt className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">{label}</dt>
                    <dd className="mt-1.5 text-sm whitespace-pre-wrap">{value || '—'}</dd>
                  </div>
                );
              })}
            </dl>
          </section>

          {timeline.length ? (
            <section>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
                <CalendarClock className="size-4 text-info dark:text-primary" /> Activity timeline
              </div>
              <ol className="relative ml-2 space-y-4 border-l border-border pl-5">
                {timeline.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="relative">
                    <span className="absolute top-1 -left-[1.48rem] size-2.5 rounded-full border-2 border-card bg-primary shadow-[0_0_0_3px_var(--card)]" />
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">{item.value || '—'}</div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {record && activityEntity ? <AuditTrail entityType={activityEntity} entityId={record.id} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
