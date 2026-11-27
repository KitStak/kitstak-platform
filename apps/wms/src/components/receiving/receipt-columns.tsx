'use client';

/** Receiving History grid: the 34 Logiwa columns (all visible by default) plus a cancelled marker on Master Id. */
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, ImageIcon } from 'lucide-react';
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell } from '@/components/grid/cells';
import { Badge } from '@/components/ui/badge';
import { calendarDay } from '@/lib/grid-defs/receiving/po-schemas';
import { receivingTypeLabel } from '@/lib/grid-defs/receiving/receiving-types';
import { ProductThumb, ZonedTime } from './receiving-shared';

export interface ReceiptRow {
  readonly id: string;
  readonly masterId: number;
  readonly purchaseOrderId: string | null;
  readonly poCode: string | null;
  readonly poType: string | null;
  readonly poStatus: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly quantity: number;
  readonly packType: string;
  readonly uomPackType: string;
  readonly uomQuantity: number;
  readonly receivedAt: string;
  readonly type: string;
  readonly skuDetailsUpdated: boolean;
  readonly note: string | null;
  readonly lineNote: string | null;
  readonly actualReturnReason: string | null;
  readonly customerReturnReason: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly workOrderId: string | null;
  readonly workOrderCode: string | null;
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly returnOrderId: string | null;
  readonly rmaNumber: string | null;
  readonly lpNumber: string | null;
  readonly lpType: string | null;
  readonly parentLpNumber: string | null;
  readonly parentLpType: string | null;
  readonly damageReason: string | null;
  readonly damageImageFileId: string | null;
  readonly receivedBy: string;
  readonly productionDate: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelBlockedReason: string | null;
  /** Warehouse IANA time zone (module date-time rule). */
  readonly timeZone?: string;
}

const dash = <span className="text-faint">None</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="truncate" title={String(v)}>
      {String(v)}
    </span>
  );
type Col = ColumnDef<ReceiptRow, unknown>;
const plain = (id: keyof ReceiptRow & string, header: string, size = 140, sortable = true): Col => ({
  id,
  accessorKey: id,
  header,
  size,
  enableSorting: sortable,
  cell: ({ getValue }) => text(getValue()),
});
const date = (id: keyof ReceiptRow & string, header: string, dateOnly = false): Col => ({
  id,
  accessorKey: id,
  header,
  size: dateOnly ? 120 : DATE_TIME_COLUMN_WIDTH + 28,
  minSize: dateOnly ? 110 : DATE_TIME_COLUMN_WIDTH,
  // Date-only values (expiry / production) render as their calendar day, never shifted by the viewer's time zone;
  // instants render in the warehouse zone, labelled (the module's one date-time rule).
  cell: ({ getValue, row }) =>
    dateOnly ? (
      <DateCell value={calendarDay(getValue() as string | null)} dateOnly />
    ) : (
      <ZonedTime value={getValue() as string | null} timeZone={row.original.timeZone} />
    ),
});
const num = (id: keyof ReceiptRow & string, header: string): Col => ({
  id,
  accessorKey: id,
  header,
  size: 104,
  meta: { align: 'right' },
  cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0).toLocaleString()}</span>,
});

export function buildReceiptColumns(openReceipt: (row: ReceiptRow) => void): Col[] {
  return [
    {
      id: 'masterId',
      accessorKey: 'masterId',
      header: 'Master ID',
      size: 132,
      minSize: 120,
      meta: { alwaysVisible: true, clip: false },
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openReceipt(row.original);
            }}
            className="rounded font-medium tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {row.original.masterId}
          </button>
          <a
            href={`/reports/serial-numbers/receiving-history?f.receiptId=eq:${row.original.masterId}`}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            title="Serial numbers of this receipt (Serial Number Receiving History, new tab)"
            aria-label={`Serial numbers of receipt ${row.original.masterId} (opens in a new tab)`}
            className="rounded text-faint hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'cancelledAt',
      header: 'Status',
      size: 108,
      minSize: 100,
      enableSorting: false,
      meta: { clip: false, headerTip: 'Cancelled receipts were reversed; their stock was taken back out.' },
      cell: ({ row }) =>
        row.original.cancelledAt ? (
          <Badge tone="danger">Cancelled</Badge>
        ) : (
          <Badge tone="success">Received</Badge>
        ),
    },
    {
      // Where the receipt came from (Logiwa Receiving History: Purchase Order / Inventory Add / Return / Work Order …).
      id: 'type',
      accessorKey: 'type',
      header: 'Receiving type',
      size: 150,
      minSize: 130,
      meta: {
        clip: false,
        headerTip: 'What created this receipt. Only Purchase Order receipts carry a PO number and PO type.',
      },
      cell: ({ row }) => (
        <Badge tone={row.original.type === 'Purchase Order' ? 'info' : 'neutral'}>
          {receivingTypeLabel(row.original.type)}
        </Badge>
      ),
    },
    {
      id: 'poCode',
      accessorKey: 'poCode',
      header: 'PO number',
      size: 200,
      minSize: 140,
      cell: ({ row }) =>
        row.original.purchaseOrderId && row.original.poCode ? (
          <span className="block min-w-0 truncate" title={row.original.poCode}>
            <LinkCell href={`/receiving/${row.original.purchaseOrderId}`}>{row.original.poCode}</LinkCell>
          </span>
        ) : (
          dash
        ),
    },
    plain('poType', 'PO type', 140),
    plain('sku', 'SKU', 150),
    plain('productName', 'Product name', 220),
    plain('barcode', 'Barcode', 140),
    plain('lotNumber', 'Lot/batch number', 140),
    date('expiryDate', 'Expiry date', true),
    num('quantity', 'Quantity'),
    {
      id: 'photo',
      header: 'Product photo(s)',
      size: 120,
      enableSorting: false,
      meta: { headerTip: 'The product image from the catalog.' },
      cell: ({ row }) => <ProductThumb url={row.original.imageUrl} label={row.original.sku} size={28} />,
    },
    plain('packType', 'Pack type', 110),
    plain('uomPackType', 'UOM pack type', 120),
    num('uomQuantity', 'UOM quantity'),
    date('receivedAt', 'Receiving date'),
    {
      id: 'skuDetailsUpdated',
      accessorKey: 'skuDetailsUpdated',
      header: 'SKU details updated',
      size: 150,
      meta: { clip: false },
      cell: ({ getValue }) =>
        getValue() ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>,
    },
    plain('note', 'Note', 180),
    plain('lineNote', 'Purchase order line note', 190),
    plain('actualReturnReason', 'Actual return reason', 170),
    plain('customerReturnReason', 'Customer return reason', 180),
    plain('clientName', 'Client', 160),
    plain('warehouseName', 'Warehouse', 170),
    plain('locationCode', 'Location', 130),
    {
      id: 'workOrderCode',
      accessorKey: 'workOrderCode',
      header: 'Work order code',
      size: 140,
      cell: ({ row }) =>
        row.original.workOrderId && row.original.workOrderCode ? (
          <LinkCell href={`/work-orders/${row.original.workOrderId}`}>{row.original.workOrderCode}</LinkCell>
        ) : (
          dash
        ),
    },
    {
      id: 'shipmentOrderCode',
      accessorKey: 'shipmentOrderCode',
      header: 'Shipment order code',
      size: 160,
      cell: ({ row }) =>
        row.original.shipmentOrderId && row.original.shipmentOrderCode ? (
          <LinkCell href={`/orders/${row.original.shipmentOrderId}`}>
            {row.original.shipmentOrderCode}
          </LinkCell>
        ) : (
          dash
        ),
    },
    plain('rmaNumber', 'RMA number', 130),
    plain('lpNumber', 'LPN', 130),
    plain('lpType', 'LP type', 110),
    plain('parentLpNumber', 'Parent LP', 130),
    plain('parentLpType', 'Parent LP type', 130),
    plain('damageReason', 'Damage reason', 140),
    {
      id: 'damageImage',
      header: 'Damage image',
      size: 120,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.damageImageFileId ? (
          <a
            href={`/api/files/${row.original.damageImageFileId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            View
          </a>
        ) : (
          dash
        ),
    },
    plain('receivedBy', 'Receiving user', 170),
    date('productionDate', 'Production date', true),
  ];
}
