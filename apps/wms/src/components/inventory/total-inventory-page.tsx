'use client';

/**
 * Total Inventory (spec 04 §1): read-only SKU × warehouse totals with an
 * "All Warehouses" aggregate, SKU / Open SO deep links (new tab) and export.
 */
import * as React from 'react';
import Link from 'next/link';
import { Boxes, MapPin } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { buttonVariants } from '@/components/ui/button';
import { DataGrid, GridToolbar, useGrid } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { InventoryReportsMenu } from './inventory-reports-menu';
import {
  ALL_WAREHOUSES_LABEL,
  TOTAL_INVENTORY_DEF,
  TOTAL_INVENTORY_EXPORT_COLUMNS,
  TOTAL_INVENTORY_GRID_KEY,
  TOTAL_INVENTORY_TIPS,
} from '@/lib/grid-defs/inventory/total-inventory';
import {
  GridStallNotice,
  OpenSoLink,
  ProductThumb,
  Qty,
  headerWidth,
  useInventoryFilterFields,
  SkuLink,
  ByLocationLink,
  ShortageToggle,
  rightMeta,
} from './inventory-shared';
import { SearchChip } from './inventory-search-chip';

export interface TotalInventoryRow {
  readonly rowId: string;
  readonly productId: string;
  readonly imageUrl: string | null;
  readonly warehouseId: string | null;
  readonly warehouse: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly productName: string;
  readonly uomPackType: string;
  readonly uomQty: number;
  readonly availableQty: number;
  readonly totalQty: number;
  readonly openSoQty: number;
  readonly undamagedQty: number;
  readonly undamagedAvailableQty: number;
  readonly kitType: string | null;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly damagedQty: number;
  readonly locationCount: number;
  readonly warehouseCount: number;
}

type Col = ColumnDef<TotalInventoryRow, unknown>;

const qtyCol = (
  id: keyof TotalInventoryRow & string,
  label: string,
  opts: { sortable?: boolean; tone?: 'danger' | 'warning' } = {},
): Col => ({
  id,
  accessorKey: id,
  header: label,
  size: headerWidth(label, 120, Boolean(TOTAL_INVENTORY_TIPS[id])),
  enableSorting: opts.sortable ?? true,
  meta: rightMeta(label, TOTAL_INVENTORY_TIPS[id]),
  cell: ({ row }) => <Qty value={row.original[id] as number} tone={opts.tone} />,
});

const text = (id: keyof TotalInventoryRow & string, label: string, size = 140, sortable = true): Col => ({
  id,
  accessorKey: id,
  header: label,
  size: headerWidth(label, size),
  enableSorting: sortable,
  meta: { label },
  cell: ({ row }) => (row.original[id] as string | null) ?? <span className="text-faint">—</span>,
});

export function buildTotalColumns(): Col[] {
  return [
    {
      id: 'image',
      header: 'Image',
      size: 64,
      enableSorting: false,
      meta: { label: 'Image', clip: false, justify: 'center' },
      cell: ({ row }) => <ProductThumb src={row.original.imageUrl} alt={row.original.sku} />,
    },
    {
      id: 'warehouse',
      accessorKey: 'warehouse',
      header: 'Warehouse',
      size: 170,
      meta: { label: 'Warehouse' },
      cell: ({ row }) =>
        row.original.warehouseId ? (
          row.original.warehouse
        ) : (
          <span
            className="inline-flex rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-secondary"
            title={
              row.original.warehouseCount > 1
                ? `${ALL_WAREHOUSES_LABEL} (${row.original.warehouseCount} warehouses)`
                : ALL_WAREHOUSES_LABEL
            }
          >
            {row.original.warehouseCount > 1 ? `All (${row.original.warehouseCount})` : 'All'}
          </span>
        ),
    },
    text('client', 'Client', 190),
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 180,
      meta: { label: 'SKU', alwaysVisible: true },
      cell: ({ row }) => <SkuLink sku={row.original.sku} clientId={row.original.clientId} />,
    },
    text('productName', 'Product Name', 240),
    // Key quantities first, so they are on screen at 1440px (Logiwa parity order puts them off-screen).
    qtyCol('availableQty', 'Available UOM Qty'),
    qtyCol('uomQty', 'UOM Quantity', { sortable: true }),
    {
      id: 'byLocation',
      header: 'By Location',
      size: 120,
      enableSorting: false,
      meta: { label: 'By Location' },
      cell: ({ row }) => (
        <ByLocationLink
          sku={row.original.sku}
          warehouseId={row.original.warehouseId}
          count={row.original.locationCount}
        />
      ),
    },
    text('uomPackType', 'UOM Pack Type', 120, false),
    qtyCol('totalQty', 'Total Quantity'),
    {
      id: 'openSoQty',
      accessorKey: 'openSoQty',
      header: 'Open SO Qty',
      size: headerWidth('Open SO Qty', 128, true),
      meta: rightMeta('Open SO Qty', TOTAL_INVENTORY_TIPS.openSoQty),
      cell: ({ row }) => (
        <OpenSoLink
          productId={row.original.productId}
          warehouseId={row.original.warehouseId}
          sku={row.original.sku}
          qty={row.original.openSoQty}
        />
      ),
    },
    qtyCol('undamagedQty', 'Undamaged Quantity'),
    qtyCol('undamagedAvailableQty', 'Undamaged Available UOM Qty'),
    text('kitType', 'Kit Type', 120),
    text('productType', 'Product Type', 140),
    text('productGroup', 'Product Group', 140),
    qtyCol('damagedQty', 'Damaged Qty', { tone: 'warning' }),
  ];
}

function HeaderActions() {
  return (
    <>
      <InventoryReportsMenu />
      <Link href="/inventory/by-location" className={buttonVariants({ variant: 'secondary' })}>
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        View by location
      </Link>
    </>
  );
}

export function TotalInventoryPage() {
  const fields = useInventoryFilterFields(TOTAL_INVENTORY_DEF.fields);
  const g = useGrid<TotalInventoryRow>({ gridKey: TOTAL_INVENTORY_GRID_KEY, path: '/api/inventory', fields });
  const columns = React.useMemo(() => buildTotalColumns(), []);
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Total Inventory"
        helper="On-hand, available and open-order quantities per SKU."
        actions={<HeaderActions />}
        tabs="inventory"
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by SKU"
        trailing={
          <>
            <SearchChip grid={g.grid} noun="SKU" />
            <ShortageToggle grid={g.grid} field="availableQty" label="Available UOM Qty" />
          </>
        }
      />
      <GridStallNotice loading={g.isLoading} onRetry={g.refetch} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<TotalInventoryRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.rowId}
          selectable={false}
          exportColumns={TOTAL_INVENTORY_EXPORT_COLUMNS}
          emptyTitle={hasState ? 'No SKUs match these filters' : 'No products yet'}
          emptyDescription={
            hasState
              ? 'Try Starts With instead of Equal, or clear a filter.'
              : 'Products appear here as soon as they are created, even before stock arrives.'
          }
          emptyAction={
            hasState ? undefined : (
              <Link href="/products" className={buttonVariants({ variant: 'secondary' })}>
                <Boxes className="h-3.5 w-3.5" aria-hidden />
                Go to products
              </Link>
            )
          }
        />
      </div>
    </div>
  );
}
