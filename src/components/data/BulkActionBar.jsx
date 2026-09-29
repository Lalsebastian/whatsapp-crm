import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/*
 * BulkActionBar
 *
 * Fixed to the bottom of the viewport rather than rendered inline, because the
 * rows being acted on are usually scrolled off screen. It states the count
 * explicitly — "3 selected" — because a bulk action against an invisible
 * selection is the kind of mistake that costs someone a booking.
 */
export function BulkActionBar({ count, onClear, children, className }) {
  if (!count) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        'bg-popover text-popover-foreground border-border animate-in slide-in-from-bottom-4 fade-in fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl rounded-t-lg border p-3 shadow-lg md:bottom-4 md:rounded-lg',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {count} selected
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>

        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
