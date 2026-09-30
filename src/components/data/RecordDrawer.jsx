import { CalendarClock, CircleDot, FileText } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function RecordDrawer({ record, title, description, fields = [], timeline = [], onClose }) {
  return (
    <Sheet open={Boolean(record)} onOpenChange={(open) => !open && onClose?.()}>
      <SheetContent className="record-drawer w-full overflow-y-auto p-0 sm:max-w-xl">
        <div className="record-drawer-hero relative overflow-hidden border-b px-6 pt-8 pb-6">
          <div className="record-drawer-orbit" aria-hidden="true" />
          <SheetHeader className="relative p-0 pr-8">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-info uppercase dark:text-primary">
              <CircleDot className="size-3.5" /> Record overview
            </div>
            <SheetTitle className="text-xl tracking-tight">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-7 p-6">
          <section>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
              <FileText className="size-4 text-info dark:text-primary" /> Details
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {fields.map(([label, value]) => {
                const wide = ['Notes', 'Description', 'Conversation summary'].includes(label);
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
