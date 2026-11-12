// @vitest-environment jsdom
import './dom-shims';
import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { QueryClient } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

import { QueryProvider } from '@/lib/query-client';
import { DataGrid } from '@/components/grid/data-grid';
import { FilterPopover } from '@/components/grid/filter-builder/filter-popover';
import { FilterChips } from '@/components/grid/filter-builder/filter-chips';
import { SearchMode } from '@/components/grid/search-mode';
import { BulkActions } from '@/components/grid/bulk-actions';
import { GridFooter } from '@/components/grid/grid-footer';
import type { FilterFieldDef } from '@/components/grid/grid-types';
import type { GridFilter } from '@/server/query/grid-query';

interface Row {
  readonly id: string;
  readonly code: string;
  readonly qty: number;
}

const ROWS: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, code: `SO00${i}`, qty: 5 - i }));
const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'code', header: 'Code' },
  { accessorKey: 'qty', header: 'Qty', meta: { headerTip: 'Units in the primary UOM' } },
];

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryProvider client={client}>{ui}</QueryProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('DataGrid (legacy props)', () => {
  it('renders rows, totals, client sort and header tips', async () => {
    const user = userEvent.setup();
    wrap(
      <DataGrid<Row>
        columns={COLUMNS}
        data={ROWS}
        total={5}
        page={1}
        pageSize={100}
        onPageChange={() => undefined}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByText('SO000')).toBeTruthy();
    expect(screen.getByText(/Total:/).textContent).toContain('5');
    expect(screen.getByRole('button', { name: 'About Qty' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Qty/ }));
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[2]?.textContent);
    expect(cells).toEqual(['1', '2', '3', '4', '5']);
  });

  it('selects the page with the tri-state header and offers select-all-matching', async () => {
    const user = userEvent.setup();
    const onAll = vi.fn();
    function Harness() {
      const [sel, setSel] = React.useState<Record<string, boolean>>({});
      return (
        <DataGrid<Row>
          columns={COLUMNS}
          data={ROWS}
          total={250}
          page={1}
          pageSize={100}
          onPageChange={() => undefined}
          getRowId={(r) => r.id}
          selection={sel}
          onSelectionChange={setSel}
          onAllMatchingSelectedChange={onAll}
        />
      );
    }
    wrap(<Harness />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByText(/Selected:/).textContent).toContain('5');
    await user.click(screen.getByRole('button', { name: 'Select all 250 matching' }));
    expect(onAll).toHaveBeenCalledWith(true);
  });

  it('uses server sort when onSortChange is given (multi-sort with shift)', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    wrap(
      <DataGrid<Row>
        columns={COLUMNS}
        data={ROWS}
        total={5}
        page={1}
        pageSize={100}
        onPageChange={() => undefined}
        getRowId={(r) => r.id}
        sort={[{ field: 'code', dir: 'asc' }]}
        onSortChange={onSort}
      />,
    );
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: /^Qty/ }));
    await user.keyboard('{/Shift}');
    expect(onSort).toHaveBeenCalledWith([
      { field: 'code', dir: 'asc' },
      { field: 'qty', dir: 'asc' },
    ]);
    // Server-sorted rows stay in the order given.
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('SO000');
  });

  it('shows empty and error states with Retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = wrap(
      <DataGrid<Row>
        columns={COLUMNS}
        data={[]}
        total={0}
        page={1}
        pageSize={100}
        onPageChange={() => undefined}
        getRowId={(r) => r.id}
        emptyTitle="No orders"
      />,
    );
    expect(screen.getByText('No orders')).toBeTruthy();
    rerender(
      <QueryProvider client={new QueryClient()}>
        <DataGrid<Row>
          columns={COLUMNS}
          data={[]}
          total={0}
          page={1}
          pageSize={100}
          onPageChange={() => undefined}
          getRowId={(r) => r.id}
          error="Boom"
          onRetry={onRetry}
        />
      </QueryProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders the row kebab with disabled reasons', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    wrap(
      <DataGrid<Row>
        columns={COLUMNS}
        data={ROWS.slice(0, 1)}
        total={1}
        page={1}
        pageSize={100}
        onPageChange={() => undefined}
        getRowId={(r) => r.id}
        rowActions={() => [
          { key: 'edit', label: 'Edit', onSelect: onEdit },
          {
            key: 'del',
            label: 'Delete',
            destructive: true,
            disabledReason: 'Only Open orders can be deleted',
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('GridFooter', () => {
  it('commits the page input on Enter and switches density', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    const onDensity = vi.fn();
    render(
      <GridFooter
        total={1000}
        page={1}
        pageSize={100}
        selectedCount={0}
        density="Small"
        onDensityChange={onDensity}
        onPageChange={onPage}
        onPageSizeChange={() => undefined}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Page number' });
    await user.clear(input);
    await user.type(input, '40{Enter}');
    expect(onPage).toHaveBeenCalledWith(10);
    await user.click(screen.getByRole('radio', { name: 'Large' }));
    expect(onDensity).toHaveBeenCalledWith('Large');
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Show 100 items',
      'Show 300 items',
      'Show 500 items',
      'Show 700 items',
      'Show 1000 items',
    ]);
  });
});

const FIELDS: readonly FilterFieldDef[] = [
  {
    field: 'status',
    label: 'Status',
    type: 'enum',
    options: [
      { value: 'Open', label: 'Open' },
      { value: 'Shipped', label: 'Shipped' },
    ],
  },
  { field: 'code', label: 'Code', type: 'text' },
];

describe('filter builder', () => {
  it('applies an enum filter from the New tab', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    wrap(<FilterPopover gridKey="t" fields={FIELDS} filters={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: /^Status/ }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ field: 'status', op: 'in', values: ['Open'] });
  });

  it('renders chips with +N overflow and removes a filter', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const filters: GridFilter[] = [
      { field: 'status', op: 'in', values: ['Open'] },
      { field: 'code', op: 'sw', value: 'SO' },
      { field: 'a', op: 'ex' },
      { field: 'b', op: 'ex' },
    ];
    wrap(
      <FilterChips
        gridKey="t"
        fields={FIELDS}
        filters={filters}
        onRemove={onRemove}
        onApply={() => undefined}
        onClearAll={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Show 1 more filters' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove Code filter' }));
    expect(onRemove).toHaveBeenCalledWith('code');
  });

  it('switches search mode only on Apply', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchMode value="sw" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Search mode: Starts With' }));
    await user.click(await screen.findByRole('radio', { name: 'Equal' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith('eq');
  });
});

describe('BulkActions', () => {
  it('is disabled with a reason until rows are selected', async () => {
    const onShip = vi.fn();
    const { rerender } = render(
      <BulkActions
        actions={[{ key: 'ship', label: 'Ship', onSelect: onShip }]}
        selectedIds={[]}
        noun="order"
      />,
    );
    expect((screen.getByRole('button', { name: 'Ship' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Select at least one order')).toBeTruthy();
    rerender(
      <BulkActions
        actions={[{ key: 'ship', label: 'Ship', onSelect: onShip }]}
        selectedIds={['a']}
        noun="order"
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ship' }));
    await waitFor(() => expect(onShip).toHaveBeenCalledWith(['a']));
  });
});
