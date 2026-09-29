import { cn } from '@/lib/utils';
import { TONE_CLASS } from '@/lib/status';

/*
 * StatusBadge — the only component allowed to decide what a status looks like.
 *
 * The colour comes from the `tone` in src/lib/status.js, so a status can never
 * be amber in the board and blue in the inbox. Tone resolution is deliberately
 * forgiving: an unknown status renders neutral rather than throwing, because the
 * database's CHECK constraint and this file are edited separately and a new
 * status should degrade to "readable", not to "blank panel".
 */
export function StatusBadge({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      data-slot="status-badge"
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone] ?? TONE_CLASS.neutral,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', className, ...props }) {
  const dotColor = {
    neutral: 'bg-neutral-status',
    success: 'bg-success',
    warning: 'bg-warning',
    info: 'bg-info',
    accent: 'bg-accent',
    primary: 'bg-primary',
    destructive: 'bg-destructive',
  }[tone];

  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full', dotColor ?? 'bg-neutral-status', className)}
      {...props}
    />
  );
}

/**
 * Badge for an arbitrary value that has no entry in the status tables — service
 * names, complaint categories. Keeps the two kinds of badge visually distinct so
 * a status never reads as a category.
 */
export function Tag({ className, children, ...props }) {
  return (
    <span
      data-slot="tag"
      className={cn(
        'bg-muted text-muted-foreground inline-flex w-fit shrink-0 items-center rounded-md px-2 py-0.5 text-xs whitespace-nowrap',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
