'use client';
import * as React from 'react';

/**
 * Products grid: the 29 Logiwa columns in Logiwa order (Image … Production date
 * tracking), plus KitStaks extras hidden by default (category, on hand, available,
 * serial tracking, pack types).
 */
import type { ColumnDef } from '@tanstack/react-table';
import { DateCell, LinkCell, MoneyCell, QtyCell, YesNoPill } from '@/components/grid/cells';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { ProductThumb, type ProductListRow } from './catalog-shared';

type Col = ColumnDef<ProductListRow, unknown>;

const dash = <span className="text-faint">None</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="truncate" title={String(v)}>
      {String(v)}
    </span>
  );

const flag = (
  id: keyof ProductListRow & string,
  header: string,
  opts: { defaultVisible?: boolean } = {},
): Col => ({
  id,
  accessorKey: id,
  header,
  size: Math.max(104, header.length * 8 + 36),
  meta: { clip: false, ...(opts.defaultVisible === false ? { defaultVisible: false } : {}) },
  // Yes is the exception: show it as a pill; No is a muted dash so the grid isn't a wall of pills.
  cell: ({ getValue }) =>
    getValue() ? (
      <YesNoPill value />
    ) : (
      <span className="text-faint" aria-label="No" title="No">
        None
      </span>
    ),
});

/** Id of the product just created/duplicated: its row shows a "New" badge (context keeps columns stable). */
export const NewProductContext = React.createContext<string | null>(null);

function NewBadge({ id }: { readonly id: string }) {
  const newId = React.useContext(NewProductContext);
  return newId === id ? (
    <Badge tone="success" className="shrink-0">
      New
    </Badge>
  ) : null;
}

export function buildProductColumns(): Col[] {
  return [
    {
      id: 'image',
      header: 'Image',
      size: 64,
      enableSorting: false,
      meta: { label: 'Image', clip: false, justify: 'center' },
      cell: ({ row }) => <ProductThumb url={row.original.imageUrl} size={30} label={row.original.name} />,
    },
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 168,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 168,
      meta: { alwaysVisible: true, clip: false },
      cell: ({ row }) => (
        <span
          className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden"
          title={
            row.original.barcodes
              ? `${row.original.sku} · Barcodes: ${row.original.barcodes}`
              : row.original.sku
          }
        >
          <LinkCell href={`/products/${row.original.id}`} className="block min-w-0 truncate">
            {row.original.sku}
          </LinkCell>
          {row.original.productCategory === 'Kit' ? (
            <Badge tone="info" className="shrink-0">
              Kit
            </Badge>
          ) : null}
          <NewBadge id={row.original.id} />
        </span>
      ),
    },
    {
      id: 'barcode',
      accessorKey: 'barcode',
      header: 'Barcode',
      size: 170,
      meta: { clip: false },
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-xs">{row.original.barcode}</span>
          {row.original.barcodeConflictCount > 0 ? (
            <span
              title={`Barcode shared with ${row.original.barcodeConflictCount} other product${row.original.barcodeConflictCount === 1 ? '' : 's'} of this client. Scans are ambiguous`}
            >
              <Badge tone="warning">Conflict</Badge>
            </span>
          ) : null}
        </span>
      ),
    },
    // Wide enough that typical names ("Copperline Roaster's Sampler Kit") don't truncate at 1440.
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      size: 300,
      minSize: 200,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      size: 100,
      meta: { clip: false },
      cell: ({ row }) => <StatusPill status={row.original.status} domain="active" size="sm" />,
    },
    flag('isFragile', 'Fragile'),
    flag('isOversized', 'Oversized'),
    flag('isDigital', 'Digital product'),
    flag('isHazmat', 'Hazardous'),
    flag('isInsert', 'Insert'),
    flag('isLiquid', 'Liquid'),
    flag('isNonReturnable', 'Non-returnable'),
    flag('isPackagingMaterial', 'Packaging material'),
    flag('isPoster', 'Poster'),
    flag('isFoldable', 'Foldable'),
    flag('isStackable', 'Stackable'),
    {
      id: 'salesPrice',
      accessorKey: 'salesPrice',
      header: 'Sales price',
      size: 112,
      meta: { align: 'right' },
      cell: ({ row }) => <MoneyCell value={row.original.salesPrice} currency={row.original.currency} />,
    },
    {
      id: 'purchasePrice',
      accessorKey: 'purchasePrice',
      header: 'Purchase price',
      size: 124,
      meta: { align: 'right' },
      cell: ({ row }) => <MoneyCell value={row.original.purchasePrice} currency={row.original.currency} />,
    },
    {
      id: 'uom',
      accessorKey: 'uom',
      header: 'UOM pack type',
      size: 124,
      cell: ({ row }) => (
        <span className="truncate">
          {row.original.uom}
          {row.original.packTypeCount > 1 ? (
            <span className="ml-1 text-2xs text-faint">+{row.original.packTypeCount - 1}</span>
          ) : null}
        </span>
      ),
    },
    flag('trackLot', 'Lot/batch number tracking'),
    flag('trackExpiry', 'Expiry date tracking'),
    {
      id: 'productType',
      accessorKey: 'productType',
      header: 'Product type',
      size: 140,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'productGroup',
      accessorKey: 'productGroup',
      header: 'Product group',
      size: 140,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: 'Description',
      size: 220,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'taxRate',
      accessorKey: 'taxRate',
      header: 'Tax rate',
      size: 90,
      meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0)}</span>,
    },
    {
      id: 'fnsku',
      accessorKey: 'fnsku',
      header: 'FNSKU',
      size: 130,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: 'Created date',
      size: 172,
      cell: ({ getValue }) => <DateCell value={getValue() as string} />,
    },
    flag('trackProductionDate', 'Production date tracking'),
    /* KitStaks extras (hidden until enabled in the column chooser). */
    {
      id: 'productCategory',
      accessorKey: 'productCategory',
      header: 'Category',
      size: 150,
      meta: { defaultVisible: false },
      cell: ({ row }) => (
        <span className="truncate">
          {row.original.productCategory === 'Packaging Material'
            ? 'Packaging material'
            : row.original.productCategory}
          {row.original.kitType ? ` · ${row.original.kitType}` : ''}
        </span>
      ),
    },
    flag('trackSerial', 'Serial number tracking', { defaultVisible: false }),
    {
      id: 'onHand',
      accessorKey: 'onHand',
      header: 'On hand',
      size: 100,
      meta: { align: 'right', defaultVisible: false, headerTip: 'Units on hand in your warehouses' },
      cell: ({ getValue }) => <QtyCell value={getValue() as number} muteZero />,
    },
    {
      id: 'available',
      accessorKey: 'available',
      header: 'Available',
      size: 100,
      meta: { align: 'right', defaultVisible: false, headerTip: 'On hand minus allocated and damaged' },
      cell: ({ getValue }) => <QtyCell value={getValue() as number} muteZero />,
    },
  ];
}
