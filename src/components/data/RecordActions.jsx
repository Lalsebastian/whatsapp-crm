import { CheckCircle2, Eye, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function StatusSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel = 'Change status',
  compact = false,
}) {
  return (
    <div className="status-action-control" onClick={(event) => event.stopPropagation()}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-label={ariaLabel}
          className={cn(
            'status-action-trigger border-primary/15 bg-background/80 font-semibold shadow-sm',
            compact ? 'h-8 min-w-32 text-xs' : 'h-9 min-w-40'
          )}
        >
          {disabled ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {Object.entries(options).map(([optionValue, meta]) => (
            <SelectItem key={optionValue} value={optionValue}>
              <span className={`status-option-dot status-option-dot-${meta.tone ?? 'neutral'}`} />
              {meta.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function OpenRecordButton({ onClick, label = 'Open' }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="record-open-button"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <Eye className="size-3.5" />
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}

export function RecordActionBar({ label = 'Record actions', error, success, children, className }) {
  return (
    <section className={cn('record-action-bar', className)} aria-label={label}>
      <div className="record-action-bar-label">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {success ? <p className="text-success flex basis-full items-center gap-1.5 text-xs font-medium"><CheckCircle2 className="size-3.5" />{success}</p> : null}
      {error ? <p className="text-destructive basis-full text-xs">{error}</p> : null}
    </section>
  );
}
