import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * FilterBar
 *
 * Declarative so views describe their filters as data. `isDirty` is derived
 * rather than tracked so the "Clear" button can never disagree with the active
 * filters — a reset button that appears when there is nothing to reset is a
 * small lie that makes people distrust every control in the bar.
 */
export function FilterBar({ children, search, onSearchChange, searchPlaceholder, onReset, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {search !== undefined && onSearchChange ? (
        <div className="relative min-w-[12rem] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? 'Search…'}
            className="pl-8"
            aria-label={searchPlaceholder ?? 'Search'}
          />
        </div>
      ) : null}

      {children}

      {onReset ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      ) : null}
    </div>
  );
}

/** Date-range preset switcher. `value` is a key into `RANGES`. */
export function RangePicker({ value, onChange, ranges = DEFAULT_RANGES }) {
  return (
    <div className="bg-muted inline-flex rounded-lg p-0.5">
      {Object.entries(ranges).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === key ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_RANGES = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All',
};
