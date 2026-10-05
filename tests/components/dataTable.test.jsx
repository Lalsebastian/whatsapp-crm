import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '@/components/data/DataTable';

const columns = [
  { key: 'reference', header: 'Reference', cell: (row) => row.reference },
  { key: 'customer', header: 'Customer', cell: (row) => row.customer },
  { key: 'price', header: 'Price', cell: (row) => `AED ${row.price}` },
];

const rows = [
  { id: 'b1', reference: 'BK-B', customer: 'Maya', price: 300 },
  { id: 'b2', reference: 'BK-A', customer: 'Omar', price: 120 },
  { id: 'b3', reference: 'BK-C', customer: 'Lena', price: 900 },
];

// The table is the desktop rendering; the card list below md duplicates the
// content for phones, so queries are scoped to the table.
function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

function referenceOrder() {
  return tableRows().map((row) => within(row).getAllByRole('cell').find((cell) => /^BK-/.test(cell.textContent)).textContent);
}

function SelectableTable(props) {
  const [selectedIds, setSelectedIds] = useState([]);
  return (
    <>
      <output data-testid="selection">{selectedIds.join(',')}</output>
      <DataTable columns={columns} rows={rows} selectedIds={selectedIds} onSelectionChange={setSelectedIds} {...props} />
    </>
  );
}

describe('DataTable', () => {
  it('cycles a column through ascending, descending and unsorted', async () => {
    render(<DataTable columns={columns} rows={rows} />);
    const header = screen.getByRole('button', { name: /Reference/ });

    await userEvent.click(header);
    expect(referenceOrder()).toEqual(['BK-A', 'BK-B', 'BK-C']);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(header);
    expect(referenceOrder()).toEqual(['BK-C', 'BK-B', 'BK-A']);

    await userEvent.click(header);
    expect(referenceOrder()).toEqual(['BK-B', 'BK-A', 'BK-C']);
  });

  it('sorts numbers numerically using sortValue', async () => {
    const priced = columns.map((column) => (column.key === 'price' ? { ...column, sortValue: (row) => row.price } : column));
    render(<DataTable columns={priced} rows={rows} />);
    await userEvent.click(screen.getByRole('button', { name: /Price/ }));
    expect(referenceOrder()).toEqual(['BK-A', 'BK-B', 'BK-C']);
  });

  it('selects single rows and the whole page through controlled state', async () => {
    render(<SelectableTable />);
    const table = screen.getByRole('table');

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select row b2' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('b2');

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByTestId('selection').textContent.split(',').sort()).toEqual(['b1', 'b2', 'b3']);

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('');
  });

  it('paginates and reports the visible range', async () => {
    render(<DataTable columns={columns} rows={rows} pageSize={2} />);
    expect(screen.getByText('1–2 of 3', { exact: false })).toBeInTheDocument();
    expect(tableRows()).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(tableRows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('opens a row by click or keyboard, without selection toggling it', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);
    const [first] = tableRows();

    await userEvent.click(first);
    first.focus();
    await userEvent.keyboard('{Enter}');

    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('shows "no matches" with a clear action when filters hide every row', async () => {
    const onClearFilters = vi.fn();
    render(<DataTable columns={columns} rows={[]} hasFilters onClearFilters={onClearFilters} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it('shows the empty state when there is genuinely nothing yet', () => {
    render(<DataTable columns={columns} rows={[]} emptyTitle="No bookings yet" />);
    expect(screen.getByText('No bookings yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
