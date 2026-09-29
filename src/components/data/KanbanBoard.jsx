import { useState } from 'react';
import { cn } from '@/lib/utils';
import { complaintStatus } from '@/lib/status';

/*
 * Kanban.
 *
 * Mouse drag is built on native HTML5 drag-and-drop; every card also carries a
 * "move to" select. That pairing is deliberate rather than belt-and-braces:
 * native dragstart does not fire on touch at all, so a drag-only board silently
 * stops working for the agents using it on a phone. The select is a real,
 * fully-styled control rather than a hidden affordance because it is also the
 * keyboard path and the only path that works under a screen reader.
 *
 * Both write through the same mutation, so a drag and a select are equivalent.
 */

export function KanbanBoard({
  columns,
  cardsByColumn,
  onMove,
  onSelect,
  onCardClick,
  selectedIds = [],
  loading = false,
}) {
  const [dragId, setDragId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  function handleDrop(columnId) {
    setOverColumn(null);
    if (!dragId) return;
    setDragId(null);
    if (cardsByColumn[columnId]?.some((c) => c.id === dragId)) return;
    onMove(dragId, columnId);
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 pb-16">
      {columns.map((columnId) => {
        const meta = complaintStatus(columnId);
        const cards = cardsByColumn[columnId] ?? [];

        return (
          <section
            key={columnId}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(columnId);
            }}
            onDragLeave={() => setOverColumn((c) => (c === columnId ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(columnId);
            }}
            className={cn(
              'bg-muted/40 flex w-72 shrink-0 flex-col rounded-lg border transition-colors',
              overColumn === columnId ? 'border-primary bg-primary/5' : 'border-transparent'
            )}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-medium">{meta.label}</span>
              <span className="bg-background text-muted-foreground tabular ml-auto rounded-full px-2 py-0.5 text-xs">
                {cards.length}
              </span>
            </header>

            <div className="scrollbar-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {cards.map((card) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  selected={selectedIds.includes(card.id)}
                  onSelect={onSelect}
                  onMove={onMove}
                  onCardClick={onCardClick}
                  columns={columns}
                  onDragStart={() => setDragId(card.id)}
                />
              ))}

              {cards.length === 0 && !loading ? (
                <p className="text-muted-foreground px-2 py-6 text-center text-xs">Empty</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({ card, selected, onSelect, onMove, onCardClick, columns, onDragStart }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={() => onCardClick?.(card.id)}
      className={cn(
        'bg-card group relative rounded-md border p-3 shadow-xs transition-shadow hover:shadow-md',
        selected && 'border-primary ring-primary/30 ring-2'
      )}
    >
      <div className="flex items-start gap-2">
        {onSelect ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(card.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${card.reference ?? card.id}`}
            className="accent-primary mt-0.5 size-3.5 shrink-0 cursor-pointer"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="tabular text-muted-foreground truncate text-[11px]">
              {card.reference ?? card.id?.slice(0, 8)}
            </span>
            {card.priority && card.priority !== 'normal' ? (
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  card.priority === 'urgent'
                    ? 'bg-destructive/12 text-destructive'
                    : 'bg-warning/14 text-warning'
                )}
              >
                {card.priority}
              </span>
            ) : null}
          </div>

          <p className="mt-1 line-clamp-2 text-sm">{card.title}</p>

          {card.subtitle ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{card.subtitle}</p>
          ) : null}

          {card.footer ? (
            <p className="text-muted-foreground mt-2 truncate text-[11px]">{card.footer}</p>
          ) : null}
        </div>
      </div>

      {/* The non-drag path: same mutation, reachable by keyboard and touch. */}
      <label className="mt-2 block">
        <span className="sr-only">Move {card.reference ?? card.id}</span>
        <select
          value={card.status ?? ''}
          onChange={(e) => onMove(card.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'bg-background/60 text-muted-foreground w-full rounded border px-1.5 py-1 text-[11px]',
            'focus-visible:ring-ring focus-visible:ring-2',
            menuOpen && 'ring-2'
          )}
          onFocus={() => setMenuOpen(true)}
          onBlur={() => setMenuOpen(false)}
        >
          {columns.map((columnId) => (
            <option key={columnId} value={columnId}>
              Move to {complaintStatus(columnId).label}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

/**
 * Mutation wrapper shared by the board and the bulk action bar, so a drag and a
 * bulk action take exactly the same path — including the optimistic update and
 * its rollback.
 */
