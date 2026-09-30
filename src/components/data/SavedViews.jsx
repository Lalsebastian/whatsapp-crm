import { useMemo, useState } from 'react';
import { Bookmark, Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function readViews(storageKey) {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
  } catch {
    return [];
  }
}

function sameFilters(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function SavedViews({ storageKey, value, onApply, presets = [] }) {
  const [custom, setCustom] = useState(() => readViews(storageKey));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const views = useMemo(() => [...presets, ...custom], [presets, custom]);

  function persist(next) {
    setCustom(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function save() {
    const clean = name.trim();
    if (!clean) return;
    persist([...custom.filter((item) => item.name !== clean), { name: clean, filters: value }]);
    setName('');
    setCreating(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold">
        <Bookmark className="size-3.5" /> Views
      </span>
      {views.map((view) => {
        const active = sameFilters(value, view.filters);
        const isCustom = custom.some((item) => item.name === view.name);
        return (
          <span key={view.name} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onApply(view.filters)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${active ? 'border-primary/40 bg-primary/15 shadow-sm' : 'border-border/70 bg-background/60 hover:border-primary/25 hover:bg-muted'}`}
            >
              {active ? <Check className="mr-1 inline size-3" /> : null}{view.name}
            </button>
            {isCustom ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive -ml-1 grid size-5 place-items-center rounded-full bg-background"
                aria-label={`Delete saved view ${view.name}`}
                onClick={() => persist(custom.filter((item) => item.name !== view.name))}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        );
      })}

      {creating ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
            placeholder="View name"
            aria-label="Saved view name"
            className="h-7 w-32 text-xs"
            autoFocus
          />
          <Button size="icon-sm" variant="ghost" onClick={save} aria-label="Save view"><Check /></Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setCreating(false)} aria-label="Cancel"><X /></Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 rounded-full text-[11px]" onClick={() => setCreating(true)}>
          <Plus /> Save current
        </Button>
      )}
    </div>
  );
}
