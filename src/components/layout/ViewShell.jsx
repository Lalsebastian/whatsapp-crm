import { cn } from '@/lib/utils';
import { Panel, PanelBody } from '@/components/layout/Panel';

/*
 * View scaffolding — page frame and the standard chart panel.
 *
 * `scroll` is false for views that own their own scroll regions (the board, the
 * inbox): a page that scrolls AND contains a scrolling panel hands the user two
 * competing scrollbars and makes both feel broken.
 */
export function ViewShell({ title, description, actions, children, scroll = true, className }) {
  return (
    <div
      className={cn(
        'view-enter flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6',
        scroll ? 'min-h-dvh' : 'h-[calc(100dvh-4rem)]',
        className
      )}
    >
      <header className="dream-header flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="dream-title text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>

      {children}
    </div>
  );
}

/** Standard chart panel: title on the left, optional controls on the right. */
export function ChartPanel({ title, description, actions, children, className, bodyClassName }) {
  return (
    <Panel className={className}>
      <div className="border-border flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          {description ? (
            <div className="text-muted-foreground truncate text-xs">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <PanelBody scroll={false} className={cn('p-4', bodyClassName)}>
        {children}
      </PanelBody>
    </Panel>
  );
}
