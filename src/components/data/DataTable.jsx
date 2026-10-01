import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, EmptyFilter } from '@/components/data/EmptyState';

/*
 * DataTable
 *
 * Column-driven so the views stay declarative: a view describes its columns and
 * this handles sort, selection, pagination and the mobile card fallback.
 *
 * Selection is controlled by the caller because bulk actions need to know what
 * is selected while the user is still on the page — a table that owns its own
 * selection cannot offer "assign technician to the 30 rows I just ticked"
 * without the table and the action bar fighting over state.
 */

export function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  loading = false,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  hasFilters = false,
  onClearFilters,
  selectedIds = [],
  onSelectionChange,
  onRowClick,
  pageSize = 25,
  density = 'comfortable',
  className,
}) {
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);

  const selectable = Boolean(onSelectionChange);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;

    const value = column.sortValue ?? ((row) => row[column.key]);

    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.direction === 'asc' ? result : -result;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [sorted, safePage, pageSize]
  );

  const visibleKeys = visible.map(rowKey);
  const allOnPageSelected =
    selectable && visibleKeys.length > 0 && visibleKeys.every((key) => selectedIds.includes(key));

  function toggleSort(key) {
    setPage(0);
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  function toggleRow(key) {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedIds.includes(key) ? selectedIds.filter((id) => id !== key) : [...selectedIds, key]
    );
  }

  function togglePage() {
    if (!onSelectionChange) return;
    if (allOnPageSelected) {
      const pageSet = new Set(visibleKeys);
      onSelectionChange(selectedIds.filter((id) => !pageSet.has(id)));
    } else {
      onSelectionChange([...new Set([...selectedIds, ...visibleKeys])]);
    }
  }

  if (!loading && rows.length === 0) {
    return hasFilters ? (
      <EmptyFilter onClear={onClearFilters} title={emptyTitle} description={emptyDescription} compact />
    ) : (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} compact />
    );
  }

  return (
    <div data-density={density} className={cn('data-table flex min-h-0 flex-1 flex-col', className)}>
      {/* Card list below md — a 6-column table on a 375px screen forces
          horizontal scrolling, which the plan explicitly rules out. */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <Table className="hidden md:table">
          <TableHeader className="bg-card/95 sticky top-0 z-10 backdrop-blur-md">
            <TableRow>
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={togglePage}
                    aria-label="Select all rows on this page"
                  />
                </TableHead>
              ) : null}
              {columns.map((column) => (
                <SortableHead
                  key={column.key}
                  column={column}
                  sort={sort}
                  onSort={toggleSort}
                />
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <TableRow
                  key={key}
                  style={{ '--row-index': visible.indexOf(row) }}
                  data-state={selectedIds.includes(key) ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                    if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.nextElementSibling?.focus(); }
                    if (event.key === 'ArrowUp') { event.preventDefault(); event.currentTarget.previousElementSibling?.focus(); }
                    if (event.key === 'Home') { event.preventDefault(); event.currentTarget.parentElement?.firstElementChild?.focus(); }
                    if (event.key === 'End') { event.preventDefault(); event.currentTarget.parentElement?.lastElementChild?.focus(); }
                  } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn('data-row-reveal focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none transition-[background-color,transform] duration-150', onRowClick && 'cursor-pointer hover:translate-x-0.5')}
                >
                  {selectable ? (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(key)}
                        onCheckedChange={() => toggleRow(key)}
                        aria-label={`Select row ${key}`}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.cellClassName}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <ul className="divide-border divide-y md:hidden">
          {visible.map((row) => {
            const key = rowKey(row);
            return (
              <li
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowClick(row); } } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  'flex flex-col gap-2 px-4 py-3 transition-colors duration-150',
                  onRowClick && 'cursor-pointer active:bg-muted/60'
                )}
              >
                {selectable ? (
                  <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(key)}
                      onCheckedChange={() => toggleRow(key)}
                      aria-label={`Select row ${key}`}
                    />
                    <span className="text-muted-foreground text-[11px]">Select</span>
                  </div>
                ) : null}

                {/* Primary and secondary columns become the card's title and
                    subtitle; the rest stack underneath in definition order. */}
                {columns.slice(0, 2).map((column) => (
                  <div key={column.key} className={column.key === columns[0].key ? 'min-w-0' : 'text-muted-foreground text-xs'}>
                    {column.cell(row)}
                  </div>
                ))}

                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {columns.slice(2).map((column) => (
                    <div key={column.key} className="min-w-0">
                      <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold tracking-wide uppercase">
                        {column.header}
                      </div>
                      <div className="min-w-0">{column.cell(row)}</div>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="premium-skeleton h-9 rounded" />
            ))}
          </div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="border-border text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2 text-xs">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="hover:bg-muted rounded-md border border-transparent px-2.5 py-1.5 transition-colors disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Previous
            </button>
            <span className="tabular">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="hover:bg-muted rounded-md border border-transparent px-2.5 py-1.5 transition-colors disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortableHead({ column, sort, onSort }) {
  const active = sort?.key === column.key;
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <TableHead className={cn(column.headerClassName)} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : column.sortable === false ? undefined : 'none'}>
      {column.sortable === false ? (
        column.header
      ) : (
        <button
          type="button"
          onClick={() => onSort(column.key)}
          className="-mx-2 inline-flex items-center gap-1.5 rounded px-2 py-1 hover:text-foreground"
        >
          {column.header}
          <Icon className={cn('size-3', active ? 'opacity-100' : 'opacity-40')} />
        </button>
      )}
    </TableHead>
  );
}
