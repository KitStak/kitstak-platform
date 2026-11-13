'use client';

/**
 * Available To Promise (spec 04 §3): 18 columns with formula tips. Unlike Logiwa the
 * grid is never empty on open — it shows the header warehouse context (or every
 * warehouse in scope) straight away.
 */
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataGrid, GridToolbar, useGrid } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Info } from 'lucide-react';
import { ATP_DEF, ATP_EXPORT_COLUMNS, ATP_GRID_KEY, ATP_TIPS } from '@/lib/grid-defs/inventory/atp';
import { useMe } from '@/lib/permissions-client';
import {
  GridStallNotice,
  OpenPoLink,
  OpenSoLink,
  Qty,
  headerWidth,
  useInventoryFilterFields,
  SkuLink,
  ShortageToggle,
  rightMeta,
} from './inventory-shared';
import { SearchChip, warehouseCodeOf } from './inventory-search-chip';

export interface AtpRow {
  readonly rowId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly kitType: string | null;
  readonly totalQty: number;
  readonly damagedQty: number;
  readonly undamagedQty: number;
  readonly allocatedSoQty: number;
  readonly openSoQty: number;
  readonly openPoQty: number;
  readonly currentAtp: number;
  readonly plannedAtp: number;
  readonly onHandQty: number;
  readonly sellableQty: number;
  readonly pickableQty: number;
  readonly unallocatedSoQty: number;
}

type Col = ColumnDef<AtpRow, unknown>;

const qty = (
  id: keyof AtpRow & string,
  label: string,
  opts: { sortable?: boolean; emphasis?: boolean; tone?: 'warning' } = {},
): Col => ({
  id,
  accessorKey: id,
  header: label,
  size: headerWidth(label, 120, Boolean(ATP_TIPS[id])),
  enableSorting: opts.sortable ?? true,
  meta: rightMeta(label, ATP_TIPS[id]),
  cell: ({ row }) => {
    const v = row.original[id] as number;
    return opts.emphasis ? (
      <span
        className={
          v < 0
            ? 'block text-right font-semibold tabular-nums text-danger'
            : 'block text-right font-semibold tabular-nums text-foreground'
        }
      >
        {v.toLocaleString('en-US')}
      </span>
    ) : (
      <Qty value={v} tone={opts.tone} />
    );
  },
});

const text = (id: keyof AtpRow & string, label: string, size = 140, sortable = true): Col => ({
  id,
  accessorKey: id,
  header: label,
  size,
  enableSorting: sortable,
  meta: { label },
  cell: ({ row }) => (row.original[id] as string | null) ?? <span className="text-faint">None</span>,
});

/**
 * The ATP metrics this page exists for (Current ATP, Planned ATP, Sellable, Pickable) come right
 * after SKU / Product Name, so they are on screen at 1440px without scrolling. Logiwa puts them
 * after the quantity breakdown, off-screen; the breakdown follows here.
 */
export function buildAtpColumns(): Col[] {
  return [
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 180,
      meta: { label: 'SKU', alwaysVisible: true },
      cell: ({ row }) => <SkuLink sku={row.original.sku} clientId={row.original.clientId} />,
    },
    text('productName', 'Product Name', 220),
    qty('currentAtp', 'Current ATP', { emphasis: true }),
    qty('plannedAtp', 'Planned ATP Qty', { emphasis: true }),
    qty('sellableQty', 'Sellable Qty'),
    qty('pickableQty', 'Pickable Qty'),
    {
      id: 'openSoQty',
      accessorKey: 'openSoQty',
      header: 'Open SO Qty',
      size: headerWidth('Open SO Qty', 120, true),
      meta: rightMeta('Open SO Qty', ATP_TIPS.openSoQty),
      cell: ({ row }) => (
        <OpenSoLink
          productId={row.original.productId}
          warehouseId={row.original.warehouseId}
          sku={row.original.sku}
          qty={row.original.openSoQty}
        />
      ),
    },
    {
      ...qty('openPoQty', 'Open PO Qty'),
      cell: ({ row }) => (
        <OpenPoLink
          productId={row.original.productId}
          warehouseId={row.original.warehouseId}
          sku={row.original.sku}
          qty={row.original.openPoQty}
        />
      ),
    },
    {
      // The code fits the 1440px viewport next to the ATP metrics; the full "CODE - Name" is the tooltip.
      id: 'warehouse',
      accessorKey: 'warehouse',
      header: 'Warehouse',
      size: headerWidth('Warehouse', 110),
      meta: { label: 'Warehouse' },
      cell: ({ row }) => (
        <span title={row.original.warehouse}>{warehouseCodeOf(row.original.warehouse)}</span>
      ),
    },
    text('client', 'Client', 190),
    qty('totalQty', 'Total Quantity'),
    qty('damagedQty', 'Damaged Qty', { tone: 'warning' }),
    qty('undamagedQty', 'Undamaged Quantity'),
    qty('allocatedSoQty', 'Allocated SO Item Qty'),
    qty('onHandQty', 'On Hand Qty'),
    qty('unallocatedSoQty', 'Unallocated SO Item Qty', { tone: 'warning' }),
    text('barcode', 'Barcode', 140, false),
    text('kitType', 'Kit Type', 110, false),
  ];
}

export function AtpPage() {
  const me = useMe();
  const fields = useInventoryFilterFields(ATP_DEF.fields);
  const g = useGrid<AtpRow>({ gridKey: ATP_GRID_KEY, path: '/api/inventory/atp', fields });
  const columns = React.useMemo(() => buildAtpColumns(), []);
  const ctx = me.data?.data.context.warehouseId;
  const ctxWh = me.data?.data.contextOptions.warehouses.find((w) => w.id === ctx);
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Available To Promise (ATP)"
        helper="Available to promise (ATP) calculates the available quantity of a product to sell it. ATP helps you to manage demands and match them to purchasing plans."
        tabs="inventory"
      />
      <div className="px-6 pt-3">
        {/* Neutral info note (the shared Callout "info" uses the red brand primary and reads as an error). */}
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-soft px-3.5 py-2.5 text-sm"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <div>
            <p className="font-medium text-foreground">
              {ctxWh ? `Showing ${ctxWh.code ?? ctxWh.name}` : 'Showing every warehouse you can access'}
            </p>
            <p className="text-secondary">
              Current ATP = Undamaged − Open SO · Planned ATP = Current ATP + Open PO. Hover any column header
              for its formula.
            </p>
          </div>
        </div>
      </div>
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by SKU or barcode"
        trailing={
          <>
            <SearchChip grid={g.grid} noun="SKU or barcode" />
            <ShortageToggle grid={g.grid} field="currentAtp" label="Current ATP" />
          </>
        }
      />
      <GridStallNotice loading={g.isLoading} onRetry={g.refetch} noun="ATP" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<AtpRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.rowId}
          selectable={false}
          exportColumns={ATP_EXPORT_COLUMNS}
          emptyTitle={hasState ? 'No SKUs match these filters' : 'Nothing to promise yet'}
          emptyDescription={
            hasState
              ? 'Clear a filter or switch Equal to Starts With.'
              : 'Results appear once a product has stock, an open shipment order or an open purchase order.'
          }
        />
      </div>
    </div>
  );
}
