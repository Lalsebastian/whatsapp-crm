import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/layout/Panel';
import { Inbox } from 'lucide-react';

/*
 * Empty states.
 *
 * Distinguishes "nothing here yet" from "nothing matched your filter" from
 * "that failed to load". They look identical otherwise, and the third one sends
 * people to check their filters when the real problem is the network.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className
      )}
    >
      <div
        className={cn(
          'bg-muted text-muted-foreground flex items-center justify-center rounded-full',
          compact ? 'size-9' : 'size-12'
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} />
      </div>

      <div className="space-y-1">
        <div className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>{title}</div>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm text-balance">{description}</p>
        ) : null}
      </div>

      {action}
    </div>
  );
}

export function EmptyFilter({ onClear, ...props }) {
  return (
    <EmptyState
      icon={Inbox}
      title="No matches"
      description="No records match the current filters."
      action={
        onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : null
      }
      {...props}
    />
  );
}

/**
 * Error state with the underlying reason attached. Supabase failures arrive as
 * opaque objects, so surfacing the message is the difference between a user
 * reporting "it's broken" and reporting a PostgREST code.
 */
export function ErrorState({ error, onRetry, title = 'Could not load this data' }) {
  const message =
    error?.message ?? error?.error?.message ?? 'Unknown error. Check the browser console.';

  return (
    <EmptyState
      icon={Inbox}
      title={title}
      description={message}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
    />
  );
}

/** Panel-level loading placeholder that matches the final layout's height. */
export function PanelSkeleton({ rows = 4, className }) {
  return (
    <Panel className={cn('gap-0 p-4', className)}>
      <div className="bg-muted h-3 w-32 animate-pulse rounded" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="bg-muted h-8 animate-pulse rounded" />
        ))}
      </div>
    </Panel>
  );
}
