'use client';

/** Purchase Orders grid: the 16 Logiwa columns (all visible by default) plus a receive-progress bar inside Total Quantity. */
import type { ColumnDef } from '@tanstack/react-table';
import { DATE_TIME_COLUMN_WIDTH, LinkCell, MoneyCell, TagsCell } from '@/components/grid/cells';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { ZonedTime, type PoRow } from './receiving-shared';

const dash = <span className="text-faint">None</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="truncate" title={String(v)}>
      {String(v)}
    </span>
  );
const date = (id: keyof PoRow & string, header: string, sortable = true): ColumnDef<PoRow, unknown> => ({
  // Warehouse zone, labelled ("2026/11/10 1:02 AM EST"): wide enough never to clip at 1440px.
  id,
  accessorKey: id,
  header,
  size: DATE_TIME_COLUMN_WIDTH + 28,
  minSize: DATE_TIME_COLUMN_WIDTH,
  enableSorting: sortable,
  cell: ({ getValue, row }) => (
    <ZonedTime value={getValue() as string | null} timeZone={row.original.warehouseTimeZone} />
  ),
});

export function QtyProgress({ received, total }: { readonly received: number; readonly total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <span
      className="flex h-full w-full items-center justify-end gap-2 leading-none"
      title={`${received.toLocaleString()} of ${total.toLocaleString()} received`}
    >
      {/* Partial progress is informational (blue), never the red brand colour, which reads as an error. */}
      <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-border" aria-hidden>
        <span
          className={cn('block h-full rounded-full', pct >= 100 ? 'bg-success' : 'bg-info')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums leading-5">{total.toLocaleString()}</span>
    </span>
  );
}

export function buildPoColumns(): ColumnDef<PoRow, unknown>[] {
  return [
    {
      id: 'code',
      accessorKey: 'code',
      header: 'PO number',
      size: 210,
      minSize: 150,
      meta: { alwaysVisible: true },
      // Codes run to 50 chars: wide by default, truncated with the full code as a tooltip.
      cell: ({ row }) => (
        <span className="block min-w-0 truncate" title={row.original.code}>
          <LinkCell href={`/receiving/${row.original.id}`}>{row.original.code}</LinkCell>
        </span>
      ),
    },
    // Status sits next to the PO number so it stays on screen at tablet width.
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      size: 124,
      minSize: 116,
      meta: { clip: false },
      cell: ({ row }) => <StatusPill status={row.original.status} domain="purchaseOrder" />,
    },
    {
      id: 'vendorName',
      accessorKey: 'vendorName',
      header: 'Vendor',
      size: 210,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'referenceNumber',
      accessorKey: 'referenceNumber',
      header: 'Reference number',
      size: 168,
      minSize: 150,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'purchasePrice',
      accessorKey: 'purchasePrice',
      header: 'Purchase price',
      size: 140,
      minSize: 132,
      meta: { align: 'right' },
      cell: ({ getValue }) => <MoneyCell value={getValue() as number} />,
    },
    {
      id: 'totalQuantity',
      accessorKey: 'totalQuantity',
      header: 'Total quantity',
      size: 150,
      minSize: 140,
      meta: {
        align: 'right',
        headerClassName: 'flex-row',
        headerTip: 'Ordered units; the bar shows how much is received.',
      },
      cell: ({ row }) => (
        <QtyProgress received={row.original.receivedQuantity} total={row.original.totalQuantity} />
      ),
    },
    {
      id: 'poType',
      accessorKey: 'poType',
      header: 'PO type',
      size: 150,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'tags',
      accessorKey: 'tags',
      header: 'Tags',
      size: 150,
      meta: { sortKey: 'tags', clip: false },
      cell: ({ row }) => <TagsCell tags={row.original.tags} />,
    },
    date('poDate', 'PO date'),
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 168,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'warehouseName',
      accessorKey: 'warehouseName',
      header: 'Warehouse',
      size: 180,
      cell: ({ getValue }) => text(getValue()),
    },
    date('createdAt', 'Created date'),
    date('plannedReceivingDate', 'Planned receiving date'),
    date('receivedAt', 'Actual receiving date'),
    date('plannedArrivalDate', 'Planned arrival date'),
    date('actualArrivalDate', 'Actual arrival date'),
  ];
}
