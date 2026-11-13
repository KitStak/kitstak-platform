'use client';

/**
 * Return Orders grid: one row per RMA line. Default order leads with RMA code, status and
 * SKU (so multi-line RMAs read as lines, not duplicates), then the Logiwa columns (Company
 * name included); the KitStaks extras are hidden by default.
 */
import type { ColumnDef } from '@tanstack/react-table';
import { ChannelCell, DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell } from '@/components/grid/cells';
import { StatusPill } from '@/components/ui/status-pill';
import { DARK_SAFE_PILL } from './returns-client';
import type { ReturnLineRow } from './return-types';
import { localDateFromIso } from './date-only';

const dash = <span className="text-secondary">None</span>;
/** Plain text cell; the full value is the native tooltip so truncated cells stay readable. */
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="truncate" title={String(v)}>
      {String(v)}
    </span>
  );

type Col = ColumnDef<ReturnLineRow, unknown>;

const plain = (id: keyof ReturnLineRow & string, header: string, size = 150, hidden = false): Col => ({
  id,
  accessorKey: id,
  header,
  size,
  ...(hidden ? { meta: { defaultVisible: false } } : {}),
  cell: ({ getValue }) => text(getValue()),
});
const date = (id: keyof ReturnLineRow & string, header: string, dateOnly = false): Col => ({
  id,
  accessorKey: id,
  header,
  size: DATE_TIME_COLUMN_WIDTH,
  minSize: DATE_TIME_COLUMN_WIDTH,
  // Date-only values ("2026-11-20") are local calendar dates: never parsed as UTC midnight.
  cell: ({ getValue }) => (
    <DateCell
      value={dateOnly ? localDateFromIso(getValue() as string | null) : (getValue() as string | null)}
      dateOnly={dateOnly}
    />
  ),
});
const qty = (id: 'requestedQty' | 'returnedQty', header: string): Col => ({
  id,
  accessorKey: id,
  header,
  size: 165,
  meta: { align: 'right' },
  cell: ({ row }) => {
    const v = row.original[id];
    const short =
      id === 'returnedQty' &&
      row.original.returnedQty < row.original.requestedQty &&
      row.original.status === 'Completed';
    return (
      <span
        className={
          short ? 'w-full text-right font-medium tabular-nums text-warning' : 'w-full text-right tabular-nums'
        }
      >
        {v.toLocaleString()}
      </span>
    );
  },
});

/** Uppercase 11px headers need ~8px per character plus sort/menu affordances (~56px). */
export function headerFitWidth(header: string): number {
  return Math.ceil(header.length * 8 + 56);
}

/** Widens every column so its header label fits (no overlapping or clipped headers). */
function fitHeaders(cols: Col[]): Col[] {
  return cols.map((c) => {
    const h = typeof c.header === 'string' ? c.header : '';
    const need = headerFitWidth(h);
    const size = Math.max(c.size ?? 150, need);
    return { ...c, size, minSize: Math.max(c.minSize ?? 0, need) };
  });
}

export function buildReturnColumns(): Col[] {
  return fitHeaders([
    {
      id: 'shipmentOrderCode',
      accessorKey: 'shipmentOrderCode',
      header: 'Shipment order code',
      size: 150,
      cell: ({ row }) =>
        row.original.shipmentOrderId ? (
          <LinkCell href={`/orders/${row.original.shipmentOrderId}`}>
            {row.original.shipmentOrderCode}
          </LinkCell>
        ) : (
          <span className="text-secondary">Manual return</span>
        ),
    },
    {
      id: 'rmaCode',
      accessorKey: 'rmaCode',
      header: 'RMA code',
      size: 130,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <LinkCell href={`/orders/returns/${row.original.returnOrderId}`}>{row.original.rmaCode}</LinkCell>
      ),
    },
    // Status sits next to the RMA code (the most-read column), never under the sticky kebab.
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      size: 132,
      minSize: 132,
      meta: { clip: false },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <StatusPill status={row.original.status} domain="return" className={DARK_SAFE_PILL} />
        </span>
      ),
    },
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 150,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium" title={row.original.sku}>
            {row.original.sku}
          </span>
          <span className="truncate text-2xs text-secondary" title={row.original.productName ?? undefined}>
            {row.original.productName}
          </span>
        </span>
      ),
    },
    plain('storeOrderNumber', 'Store order number', 150),
    {
      id: 'store',
      accessorKey: 'store',
      header: 'Store',
      size: 130,
      meta: { clip: false },
      cell: ({ row }) => (row.original.store ? <ChannelCell channel={row.original.store} /> : dash),
    },
    { ...plain('returnAddress', 'Return address', 240), enableSorting: false },
    plain('fromCountry', 'From country name', 170),
    qty('requestedQty', 'Requested quantity'),
    qty('returnedQty', 'Returned quantity'),
    plain('packType', 'Pack type', 100),
    plain('customerName', 'Customer name', 160),
    plain('carrierName', 'Carrier name', 120),
    plain('carrierServiceName', 'Carrier shipping option name', 200),
    plain('trackingNumber', 'Tracking number', 170),
    date('createdAt', 'Return order created date'),
    plain('createdByName', 'Created by', 140),
    date('shipmentOrderDate', 'Shipment order date'),
    date('deliveryDate', 'Shipment order delivery date'),
    date('expectedReturnDate', 'Expected return date', true),
    date('actualReturnDate', 'Actual return date'),
    plain('warehouseCode', 'Warehouse', 110),
    plain('clientName', 'Client', 160),
    {
      id: 'tagNames',
      accessorKey: 'tagNames',
      header: 'Tags',
      size: 150,
      enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return dash;
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {v
              .split(', ')
              .slice(0, 2)
              .map((t) => (
                <span
                  key={t}
                  className="truncate rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-medium text-primary"
                >
                  {t}
                </span>
              ))}
          </span>
        );
      },
    },
    {
      id: 'lineStatus',
      accessorKey: 'lineStatus',
      header: 'Line status',
      size: 120,
      meta: { clip: false, defaultVisible: false },
      cell: ({ row }) => (
        <StatusPill status={row.original.lineStatus} domain="return" size="sm" className={DARK_SAFE_PILL} />
      ),
    },
    // Logiwa default column set includes Company name (blank for most B2C returns).
    plain('companyName', 'Company name', 150),
    // Available in the column chooser, hidden by default.
    plain('source', 'Source', 110, true),
    plain('disposition', 'Disposition', 120, true),
    { ...plain('customerReturnReason', 'Customer return reason', 180, true), enableSorting: false },
    { ...plain('actualReturnReason', 'Actual return reason', 180, true), enableSorting: false },
  ]);
}
