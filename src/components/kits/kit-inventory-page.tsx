"use client";

/**
 * Kit Inventory report (`/inventory/kits`, Logiwa 07 §Kit Inventory). Rows come from
 * `kit_inventory_stats` (recalculated every 15 minutes, or now with Recalculate now).
 *   Net Kitting Capacity    = min over components of ⌊free component qty ÷ BOM qty⌋
 *   Total Inventory Capacity = Net Kitting Capacity + current kit stock
 *   Required Kitting Qty    = max(0, pending order qty − current kit stock)
 * Selecting a kit-to-stock row enables Create work order, which opens the wizard prefilled.
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, Plus, RefreshCw } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, QtyCell, useGrid } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useCan } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { KIT_INVENTORY_EXPORT_COLUMNS, KIT_INVENTORY_FIELDS, KIT_INVENTORY_GRID_KEY, type KitInventoryRow } from "@/lib/grid-defs/work-orders/kits";
import { errorMessage, useInvalidateWorkOrders, useWoFilterFields, WO_P } from "../work-orders/wo-client";
import { WorkOrderWizard, type WorkOrderPrefill } from "../work-orders/wizard/work-order-wizard";

export const KIT_INVENTORY_HELPER = "The inventory levels of kit-to-order products can be monitored on this report.";

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);
const qty = (id: keyof KitInventoryRow & string, header: string, tip: string, tone?: (r: KitInventoryRow) => string | undefined): ColumnDef<KitInventoryRow, unknown> => ({
  id, accessorKey: id, header, size: 150, meta: { align: "right", headerTip: tip },
  cell: ({ row }) => <span className={cn("tabular-nums", tone?.(row.original))}><QtyCell value={row.original[id] as number} muteZero /></span>,
});

export function buildKitInventoryColumns(): ColumnDef<KitInventoryRow, unknown>[] {
  return [
    { id: "warehouseCode", accessorKey: "warehouseCode", header: "Warehouse", size: 110, cell: ({ getValue }) => text(getValue()) },
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 150, cell: ({ getValue }) => text(getValue()) },
    { id: "sku", accessorKey: "sku", header: "SKU", size: 170, meta: { alwaysVisible: true }, cell: ({ row }) => <LinkCell href={`/products/${row.original.kitProductId}`}>{row.original.sku}</LinkCell> },
    { id: "kitType", accessorKey: "kitType", header: "Kit type", size: 120, cell: ({ getValue }) => text(getValue()) },
    { id: "barcode", accessorKey: "barcode", header: "Barcode", size: 140, cell: ({ getValue }) => text(getValue()) },
    { id: "name", accessorKey: "name", header: "Product name", size: 220, cell: ({ getValue }) => text(getValue()) },
    { id: "packType", accessorKey: "packType", header: "Pack type name", size: 120, cell: ({ getValue }) => text(getValue()) },
    { id: "productType", accessorKey: "productType", header: "Product type", size: 130, cell: ({ getValue }) => text(getValue()) },
    { id: "productGroup", accessorKey: "productGroup", header: "Product group", size: 130, cell: ({ getValue }) => text(getValue()) },
    qty("pendingOrderQty", "Pending order quantity", "Kit units on open shipment orders (not shipped or cancelled)."),
    qty("netKittingCapacity", "Net kitting capacity", "Kits you can build now: the smallest ⌊free component qty ÷ BOM qty⌋ across the kit's components.", (r) => (r.netKittingCapacity > 0 ? "font-semibold text-success" : undefined)),
    qty("totalInventoryCapacity", "Total inventory capacity", "Net kitting capacity + current kit stock."),
    qty("currentInventoryQty", "Current inventory quantity", "Undamaged kit stock on hand."),
    qty("requiredKittingQty", "Required kitting quantity", "max(0, pending order quantity − current kit stock).", (r) => (r.requiredKittingQty > 0 ? (r.requiredKittingQty > r.netKittingCapacity ? "font-semibold text-danger" : "font-semibold text-warning") : undefined)),
  ];
}

export function createWoReason(rows: readonly KitInventoryRow[]): string | null {
  if (rows.length === 0) return "Select a kit to create a work order";
  if (rows.length > 1) return "Select one kit to create a work order";
  const r = rows[0];
  if (r && r.kitType !== "Kit to Stock") return "Kit-to-order kits are built during fulfillment, not by work orders";
  return null;
}

export function KitInventoryPage() {
  const fmt = useFormat();
  const invalidate = useInvalidateWorkOrders();
  const fields = useWoFilterFields(KIT_INVENTORY_FIELDS);
  const g = useGrid<KitInventoryRow>({ gridKey: KIT_INVENTORY_GRID_KEY, path: "/api/kits", fields });
  const columns = React.useMemo(() => buildKitInventoryColumns(), []);
  const canCreate = useCan(WO_P.create).allowed;
  const stamp = useApiQuery<{ updatedAt: string | null; everyMs: number }>(["kit-recalc"], "/api/kits/recalculate");
  const [busy, setBusy] = React.useState(false);
  const [prefill, setPrefill] = React.useState<WorkOrderPrefill | null>(null);
  const [seen, setSeen] = React.useState<ReadonlyMap<string, KitInventoryRow>>(new Map());
  const rowsKey = g.rows.map((r) => `${r.id}:${r.updatedAt}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on row identity, not array identity
  React.useEffect(() => { setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)])); }, [rowsKey]);
  const selected = g.selectedIds.map((id) => g.rows.find((r) => r.id === id) ?? seen.get(id)).filter((r): r is KitInventoryRow => Boolean(r));
  const reason = createWoReason(selected);
  const updatedAt = stamp.data?.data.updatedAt ?? g.rows[0]?.updatedAt ?? null;

  const recalc = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ rows: number }>("/api/kits/recalculate", { method: "POST" });
      toast.success("Success", `Kit inventory recalculated (${res.rows} row${res.rows === 1 ? "" : "s"}).`);
      await Promise.all([invalidate(), stamp.refetch()]);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const open = () => {
    const r = selected[0];
    if (!r) return;
    setPrefill({ warehouseId: r.warehouseId, clientId: r.clientId, kitProductId: r.kitProductId, kitSku: r.sku, requestedQty: Math.max(1, r.requiredKittingQty) });
  };

  const trailing = (
    <div className="flex items-center gap-2">
      <Tooltip content={`Recalculated automatically every ${Math.round((stamp.data?.data.everyMs ?? 900_000) / 60_000)} minutes`}>
        <span className="hidden items-center gap-1.5 text-[12px] text-secondary lg:inline-flex">
          <Clock className="h-3.5 w-3.5" aria-hidden />Last updated <strong className="font-semibold text-foreground">{updatedAt ? fmt.dateTime(updatedAt) : "never"}</strong>
        </span>
      </Tooltip>
      <Button variant="secondary" onClick={() => void recalc()} disabled={busy} aria-busy={busy}>
        {busy ? <Spinner className="h-3.5 w-3.5" label="Recalculating" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        Recalculate now
      </Button>
      {canCreate ? (
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={open}><Plus className="h-3.5 w-3.5" aria-hidden />Create work order</Button>
        </DisabledReason>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Kit Inventory" helper={KIT_INVENTORY_HELPER} tabs="inventory" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by SKU" bulkNoun="kit" trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<KitInventoryRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          exportColumns={KIT_INVENTORY_EXPORT_COLUMNS}
          emptyTitle="No kits match this view"
          emptyDescription="Kits appear here once a kit product has stock, components in stock or open orders in a warehouse."
        />
      </div>
      <WorkOrderWizard open={prefill !== null} onOpenChange={(o) => { if (!o) setPrefill(null); }} mode="create" prefill={prefill}
        onSaved={() => { g.clearSelection(); void invalidate(); }} />
    </div>
  );
}
