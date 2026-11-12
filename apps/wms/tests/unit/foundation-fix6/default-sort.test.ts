import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { withDefaultSort } from '@/components/grid/data-grid';

interface Row {
  readonly code: string;
  readonly total: number;
}

type AnyColumn = ColumnDef<Row, unknown> & {
  readonly accessorFn?: (row: Row) => unknown;
  readonly accessorKey?: string;
};

describe('withDefaultSort (DataGrid columns sortable by default)', () => {
  it('gives a display column (id only) an accessor reading row[id]', () => {
    const col = withDefaultSort<Row>({ id: 'code', header: 'Order code' }, 'code') as AnyColumn;
    expect(col.id).toBe('code');
    expect(col.accessorFn?.({ code: 'SO1', total: 3 })).toBe('SO1');
  });

  it('reads meta.sortKey when the id differs from the field', () => {
    const col = withDefaultSort<Row>(
      { id: 'amount', header: 'Amount', meta: { sortKey: 'total' } },
      'amount',
    ) as AnyColumn;
    expect(col.accessorFn?.({ code: 'SO1', total: 42 })).toBe(42);
  });

  it('leaves enableSorting:false columns without an accessor', () => {
    const col = withDefaultSort<Row>(
      { id: 'actions', header: 'Actions', enableSorting: false },
      'actions',
    ) as AnyColumn;
    expect(col.accessorFn).toBeUndefined();
  });

  it('keeps an existing accessorKey untouched', () => {
    const col = withDefaultSort<Row>({ accessorKey: 'total', header: 'Total' }, 'total') as AnyColumn;
    expect(col.accessorKey).toBe('total');
    expect(col.accessorFn).toBeUndefined();
    expect(col.id).toBe('total');
  });
});
