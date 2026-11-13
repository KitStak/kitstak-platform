'use client';

/**
 * Kit Inventory report (`/inventory/kits`, Logiwa 07 §Kit Inventory). Rows come from
 * `kit_inventory_stats` (recalculated every 15 minutes, or now with Recalculate now).
 *   Net Kitting Capacity    = min over components of ⌊free component qty ÷ BOM qty⌋
 *   Total Inventory Capacity = Net Kitting Capacity + current kit stock
 *   Required Kitting Qty    = max(0, pending order qty − current kit stock)
 * Selecting a kit-to-stock row enables Create work order, which opens the wizard prefilled.
 */
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, ClipboardList, Clock, Eye, Layers, ListTree, Plus, RefreshCw, Unlink } from 'lucide-react';
import { DataGrid, GridToolbar, LinkCell, QtyCell, useGrid, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { apiFetch } from '@/lib/api-client';
import { DEFAULT_WAREHOUSE_ZONE, formatInZone } from '@/lib/grid-defs/work-orders/wo-time';
import { useCan } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  KIT_INVENTORY_EXPORT_COLUMNS,
  KIT_INVENTORY_FIELDS,
  KIT_INVENTORY_GRID_KEY,
  type KitInventoryRow,
} from '@/lib/grid-defs/work-orders/kits';
import { errorMessage, useInvalidateWorkOrders, useWoFilterFields, WO_P } from '../work-orders/wo-client';
import { headerWidth } from './header-width';
import { GridStallNotice } from '../inventory/inventory-shared';
import { WorkOrderWizard, type WorkOrderPrefill } from '../work-orders/wizard/work-order-wizard';
import { DisassembleDialog, type DisassemblePrefill } from '../work-orders/disassemble-dialog';
import { KitBuildPreviewDrawer } from './kit-build-preview-drawer';
import type { GridFilter } from '@/server/query/grid-query';

export const KIT_INVENTORY_HELPER =
  'Kit stock, kitting capacity and how many kits to build. Kit to Stock kits are built ahead by work orders; Kit to Order kits are assembled when an order is fulfilled.';

export const KIT_TYPE_OPTIONS = [
  { key: 'all', label: 'All kits', tip: 'Kit to Stock and Kit to Order' },
  { key: 'Kit to Stock', label: 'Kit to Stock', tip: 'Built ahead of demand by a work order and stocked' },
  {
    key: 'Kit to Order',
    label: 'Kit to Order',
    tip: 'Assembled while the order is fulfilled; capacity shown for planning',
  },
] as const;

/** Which segment the current filters select ("all" when no single Kit Type filter is set). */
export function kitTypeSegment(filters: readonly GridFilter[]): string {
  const f = filters.find((x) => x.field === 'kitType');
  if (!f) return 'all';
  const values = f.op === 'in' ? f.values : f.op === 'eq' ? [f.value] : [];
  return values.length === 1 ? (values[0] ?? 'all') : 'custom';
}

/** Disassemble needs free kit stock and the disassemble permission. */
export function disassembleReason(r: KitInventoryRow, allowed: boolean): string | null {
  if (!allowed) return "You don't have permission to disassemble kits";
  if (r.currentInventoryQty <= 0) return 'No kit stock in this warehouse to disassemble';
  return null;
}

const dash = <span className="text-faint">None</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? dash : <span className="truncate">{String(v)}</span>;
const qty = (
  id: keyof KitInventoryRow & string,
  header: string,
  tip: string,
  tone?: (r: KitInventoryRow) => string | undefined,
): ColumnDef<KitInventoryRow, unknown> => ({
  id,
  accessorKey: id,
  header,
  size: headerWidth(header),
  minSize: headerWidth(header),
  meta: { align: 'right', headerTip: tip },
  cell: ({ row }) => (
    <span className={cn('tabular-nums', tone?.(row.original))}>
      <QtyCell value={row.original[id] as number} muteZero />
    </span>
  ),
});

export function buildKitInventoryColumns(): ColumnDef<KitInventoryRow, unknown>[] {
  return [
    {
      id: 'warehouseCode',
      accessorKey: 'warehouseCode',
      header: 'Warehouse',
      size: 128,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 150,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 170,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <LinkCell href={`/products/${row.original.kitProductId}`}>{row.original.sku}</LinkCell>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Product Name',
      size: 220,
      cell: ({ getValue }) => text(getValue()),
    },
    // Capacity columns come right after the kit (visible at 1440 without scrolling); descriptive columns follow.
    qty(
      'requiredKittingQty',
      'Required Kitting Quantity',
      'max(0, pending order quantity − current kit stock).',
      (r) =>
        r.requiredKittingQty > 0
          ? r.requiredKittingQty > r.netKittingCapacity
            ? 'font-semibold text-danger'
            : 'font-semibold text-warning'
          : undefined,
    ),
    qty(
      'netKittingCapacity',
      'Net Kitting Capacity',
      "Kits you can build now: the smallest ⌊usable component qty ÷ BOM qty⌋ across the kit's components. Stock in count-locked or allocation-blocked locations is excluded.",
      (r) => (r.netKittingCapacity > 0 ? 'font-semibold text-success' : undefined),
    ),
    qty('currentInventoryQty', 'Current Inventory Quantity', 'Undamaged kit stock on hand.'),
    qty(
      'pendingOrderQty',
      'Pending Order Quantity',
      'Kit units on open shipment orders (not shipped or cancelled).',
    ),
    qty('totalInventoryCapacity', 'Total Inventory Capacity', 'Net kitting capacity + current kit stock.'),
    {
      id: 'kitType',
      accessorKey: 'kitType',
      header: 'Kit Type',
      size: 120,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'barcode',
      accessorKey: 'barcode',
      header: 'Barcode',
      size: 140,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'packType',
      accessorKey: 'packType',
      header: 'Pack Type Name',
      size: 120,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'productType',
      accessorKey: 'productType',
      header: 'Product Type',
      size: 130,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'productGroup',
      accessorKey: 'productGroup',
      header: 'Product Group',
      size: 130,
      cell: ({ getValue }) => text(getValue()),
    },
  ];
}

export function createWoReason(rows: readonly KitInventoryRow[]): string | null {
  if (rows.length === 0) return 'Select a kit to create a work order';
  if (rows.length > 1) return 'Select one kit to create a work order';
  const r = rows[0];
  if (r && r.kitType !== 'Kit to Stock')
    return 'Kit-to-order kits are built during fulfillment, not by work orders';
  return null;
}

export function KitInventoryPage() {
  const invalidate = useInvalidateWorkOrders();
  const fields = useWoFilterFields(KIT_INVENTORY_FIELDS);
  const g = useGrid<KitInventoryRow>({ gridKey: KIT_INVENTORY_GRID_KEY, path: '/api/kits', fields });
  const columns = React.useMemo(() => buildKitInventoryColumns(), []);
  const canCreate = useCan(WO_P.create).allowed;
  const canDisassemble = useCan(WO_P.disassemble).allowed;
  const [preview, setPreview] = React.useState<KitInventoryRow | null>(null);
  const [disassemble, setDisassemble] = React.useState<DisassemblePrefill | null>(null);
  const segment = kitTypeSegment(g.toolbarProps.grid.query.filters);
  const setSegment = (key: string) =>
    key === 'all'
      ? g.toolbarProps.grid.removeFilter('kitType')
      : g.toolbarProps.grid.upsertFilter({ field: 'kitType', op: 'in', values: [key] });
  const stamp = useApiQuery<{ updatedAt: string | null; everyMs: number }>(
    ['kit-recalc'],
    '/api/kits/recalculate',
  );
  const [busy, setBusy] = React.useState(false);
  const [prefill, setPrefill] = React.useState<WorkOrderPrefill | null>(null);
  const [seen, setSeen] = React.useState<ReadonlyMap<string, KitInventoryRow>>(new Map());
  const rowsKey = g.rows.map((r) => `${r.id}:${r.updatedAt}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on row identity, not array identity
  React.useEffect(() => {
    setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)]));
  }, [rowsKey]);
  const selected = g.selectedIds
    .map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id))
    .filter((r): r is KitInventoryRow => Boolean(r));
  const reason = createWoReason(selected);
  const updatedAt = stamp.data?.data.updatedAt ?? g.rows[0]?.updatedAt ?? null;
  // One time-zone policy: the warehouse zone with a suffix (the listed warehouse when there is one).
  const zones = [...new Set(g.rows.map((r) => r.warehouseTimeZone).filter((z): z is string => Boolean(z)))];
  const stampZone = zones.length === 1 ? zones[0] : DEFAULT_WAREHOUSE_ZONE;

  const recalc = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ rows: number | null; throttled?: boolean }>('/api/kits/recalculate', {
        method: 'POST',
      });
      if (res.throttled || res.rows === null)
        toast.info('Already up to date', 'Kit inventory was recalculated a few seconds ago.');
      else
        toast.success('Kit inventory recalculated', `${res.rows} row${res.rows === 1 ? '' : 's'} refreshed.`);
      await Promise.all([invalidate(), stamp.refetch()]);
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openFor = (r: KitInventoryRow | undefined) => {
    if (!r) return;
    setPrefill({
      warehouseId: r.warehouseId,
      clientId: r.clientId,
      kitProductId: r.kitProductId,
      kitSku: r.sku,
      requestedQty: Math.max(1, r.requiredKittingQty),
    });
  };
  const open = () => openFor(selected[0]);

  const rowActions = (r: KitInventoryRow): readonly RowAction[] => [
    { key: 'product', label: 'Open Product', icon: Eye, href: `/products/${r.kitProductId}` },
    {
      key: 'components',
      label: 'View Components',
      icon: Layers,
      href: `/products/${r.kitProductId}?tab=kits`,
    },
    {
      key: 'availability',
      label: 'Component Availability',
      icon: ListTree,
      href: `/inventory/kit-components?f.includedKitsText=ct:${encodeURIComponent(r.sku)}`,
    },
    {
      key: 'work-orders',
      label: 'Work Orders for This Kit',
      icon: ClipboardList,
      href: `/work-orders?f.kitSku=eq:${encodeURIComponent(r.sku)}`,
    },
    { key: 'create-kit', label: 'Create Kit (Preview)', icon: Boxes, onSelect: () => setPreview(r) },
    ...(canDisassemble
      ? [
          {
            key: 'disassemble',
            label: 'Disassemble Kit',
            icon: Unlink,
            disabledReason: disassembleReason(r, canDisassemble),
            onSelect: () =>
              setDisassemble({
                warehouseId: r.warehouseId,
                clientId: r.clientId,
                kitProductId: r.kitProductId,
                kitLabel: `${r.sku} · ${r.name}`,
              }),
          },
        ]
      : []),
    ...(canCreate
      ? [
          {
            key: 'create-wo',
            label: 'Create Work Order',
            icon: Plus,
            disabledReason: createWoReason([r]),
            onSelect: () => openFor(r),
          },
        ]
      : []),
  ];

  const typeSegments = (
    <div
      role="radiogroup"
      aria-label="Kit type"
      className="inline-flex h-8 items-center rounded-md border border-border bg-surface p-0.5"
    >
      {KIT_TYPE_OPTIONS.map((o) => (
        <Tooltip key={o.key} content={o.tip}>
          <button
            type="button"
            role="radio"
            aria-checked={segment === o.key}
            onClick={() => setSegment(o.key)}
            className={cn(
              'h-7 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              segment === o.key ? 'bg-info-soft text-info' : 'text-secondary hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );

  const trailing = (
    <div className="flex items-center gap-2">
      {typeSegments}
      <Tooltip
        content={`Recalculated automatically every ${Math.round((stamp.data?.data.everyMs ?? 900_000) / 60_000)} minutes`}
      >
        <span className="hidden items-center gap-1.5 text-xs text-secondary lg:inline-flex">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Last updated{' '}
          <strong className="font-semibold text-foreground">
            {updatedAt ? formatInZone(updatedAt, stampZone) : stamp.isError ? 'unavailable' : '…'}
          </strong>
        </span>
      </Tooltip>
      {canCreate ? (
        <Button variant="secondary" onClick={() => void recalc()} disabled={busy} aria-busy={busy}>
          {busy ? (
            <Spinner className="h-3.5 w-3.5" label="Recalculating" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          Recalculate Now
        </Button>
      ) : null}
      {canCreate ? (
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={open}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create Work Order
          </Button>
        </DisabledReason>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Kit Inventory" helper={KIT_INVENTORY_HELPER} tabs="inventory" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by SKU" bulkNoun="kit" trailing={trailing} />
      <GridStallNotice loading={g.isLoading} onRetry={g.refetch} noun="kit inventory" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<KitInventoryRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          exportColumns={KIT_INVENTORY_EXPORT_COLUMNS}
          emptyTitle="No kits match this view"
          emptyDescription="Kits appear here once a kit product has stock, components in stock or open orders in a warehouse."
        />
      </div>
      <WorkOrderWizard
        open={prefill !== null}
        onOpenChange={(o) => {
          if (!o) setPrefill(null);
        }}
        mode="create"
        prefill={prefill}
        onSaved={() => {
          g.clearSelection();
          void invalidate();
        }}
      />
      <KitBuildPreviewDrawer
        row={preview}
        canCreate={canCreate}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
        onCreateWorkOrder={(r, n) => {
          setPreview(null);
          setPrefill({
            warehouseId: r.warehouseId,
            clientId: r.clientId,
            kitProductId: r.kitProductId,
            kitSku: r.sku,
            requestedQty: n,
          });
        }}
      />
      <DisassembleDialog
        open={disassemble !== null}
        onOpenChange={(o) => {
          if (!o) setDisassemble(null);
        }}
        workOrderId={null}
        stockPrefill={disassemble}
        onDone={() => {
          void invalidate();
          void g.refetch();
        }}
      />
    </div>
  );
}
