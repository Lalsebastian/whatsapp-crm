import { cn } from '@/lib/utils';

/*
 * Panel — the layout unit for the whole console.
 *
 * Notion/Linear style rather than a card grid: each panel owns its own header
 * and scroll region, so a long table scrolls inside its panel while the KPI row
 * above it stays put. That is the difference between a dashboard you can read
 * and one you lose your scroll position in every time a row updates.
 */

export function Panel({ className, children, ...props }) {
  return (
    <section
      data-slot="panel"
      className={cn(
        'joboy-surface bg-card/90 text-card-foreground border-border/70 flex min-h-0 min-w-0 flex-col rounded-[1.35rem] border shadow-[0_1px_2px_rgba(15,23,42,.025),0_16px_42px_rgba(15,23,42,.055)] backdrop-blur-xl transition-[border-color,box-shadow,transform] duration-300',
        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelHeader({ className, children, ...props }) {
  return (
    <header
      data-slot="panel-header"
      className={cn(
        'border-border/70 flex shrink-0 items-center gap-3 border-b px-4 py-3.5',
        className
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export function PanelTitle({ className, children, ...props }) {
  return (
    <h2
      data-slot="panel-title"
      className={cn('truncate text-sm font-semibold tracking-tight', className)}
      {...props}
    >
      {children}
    </h2>
  );
}

export function PanelDescription({ className, children, ...props }) {
  return (
    <p
      data-slot="panel-description"
      className={cn('text-muted-foreground truncate text-xs', className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function PanelActions({ className, children, ...props }) {
  return (
    <div
      data-slot="panel-actions"
      className={cn('ml-auto flex shrink-0 items-center gap-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The scrollable middle. Panels use this instead of the page scrolling so that
 * one long list cannot push the header of the panel above it off screen.
 */
export function PanelBody({ className, children, scroll = true, ...props }) {
  return (
    <div
      data-slot="panel-body"
      className={cn('min-h-0 min-w-0 flex-1', scroll && 'scrollbar-thin overflow-y-auto', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelFooter({ className, children, ...props }) {
  return (
    <footer
      data-slot="panel-footer"
      className={cn(
        'border-border text-muted-foreground flex shrink-0 items-center gap-3 border-t px-4 py-2.5 text-xs',
        className
      )}
      {...props}
    >
      {children}
    </footer>
  );
}

/**
 * Full-height panel for the side-by-side layouts (Inbox list + detail, board +
 * filters) where both panes scroll independently.
 */
export function PanelSplit({ className, children, ...props }) {
  return (
    <div
      data-slot="panel-split"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col md:flex-row', className)}
      {...props}
    >
      {children}
    </div>
  );
}
