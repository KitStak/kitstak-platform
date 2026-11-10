"use client";

/**
 * Add order(s) drawer for shipment plans. Reads `/api/shipment-plans/eligible-orders`, which is
 * pre-filtered server-side to the plan's warehouse (and client), the eligible order statuses and
 * orders not riding on another active plan. Local adapter for docs/requests/shipping.md REQ-3
 * (the shared OrderPickerDrawer reads `status` from `/api/pickers/orders`, which returns it under
 * `meta`, and crashes on render).
 */
import * as React from "react";
import { EmptyState } from "@/components/ui/empty-state";
import type { ColumnDef } from "@tanstack/react-table";
import { PLAN_ELIGIBLE_ORDER_FIELDS, orderReadiness } from "@/lib/grid-defs/shipping/shipment-plans";
import { cn } from "@/lib/utils";

const READINESS_TONE = { success: "font-medium text-success", info: "text-info", warning: "text-warning", neutral: "text-secondary" } as const;
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { DataGrid } from "@/components/grid/data-grid";
import { DateCell, QtyCell } from "@/components/grid/cells";
import { GridToolbar } from "@/components/grid/grid-toolbar";
import { useLocalGrid } from "@/components/grid/use-grid";
import { errorMessage, useFilterFields } from "@/components/shipping/shipping-client";

export interface EligibleOrder {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly orderType: string | null;
  readonly storeName: string | null;
  readonly clientName: string | null;
  readonly customerName: string | null;
  readonly sku: string | null;
  readonly totalQuantity: number;
  readonly createdAt: string;
  readonly warehouseCode: string | null;
  readonly ageDays: number | null;
  readonly tags: string | null;
}

const COLUMNS: ColumnDef<EligibleOrder, unknown>[] = [
  { id: "code", header: "Order code", meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-semibold text-foreground">{row.original.code}</span> },
  { id: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} domain="shipmentOrder" /> },
  { id: "readiness", header: "Readiness", enableSorting: false, cell: ({ row }) => {
    const r = orderReadiness(row.original.status);
    return <span className={cn("text-[12px]", READINESS_TONE[r.tone])} title={r.tone === "success" ? undefined : "Ship only ships Ready to Ship orders."}>{r.label}</span>;
  } },
  { id: "warehouseCode", header: "Warehouse", cell: ({ row }) => row.original.warehouseCode ?? "—" },
  { id: "clientName", header: "Client", cell: ({ row }) => row.original.clientName ?? "—" },
  { id: "customerName", header: "Customer", cell: ({ row }) => row.original.customerName ?? "—" },
  { id: "storeName", header: "Store", cell: ({ row }) => row.original.storeName ?? "—" },
  { id: "orderType", header: "Order type", cell: ({ row }) => row.original.orderType ?? "—" },
  { id: "sku", header: "SKU", enableSorting: false, cell: ({ row }) => <span className="block max-w-[220px] truncate" title={row.original.sku ?? undefined}>{row.original.sku ?? "—"}</span> },
  { id: "totalQuantity", header: "Qty", meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.totalQuantity} /> },
  { id: "createdAt", header: "Created date", cell: ({ row }) => <DateCell value={row.original.createdAt} /> },
  { id: "ageDays", header: "Age", meta: { align: "right" }, cell: ({ row }) => <span className="block text-right tabular-nums" title="Days since the order was created">{row.original.ageDays === null ? "—" : `${row.original.ageDays} d`}</span> },
  { id: "tags", header: "Tags", enableSorting: false, cell: ({ row }) => row.original.tags ? <span className="flex flex-wrap gap-1">{row.original.tags.split(", ").map((t) => <span key={t} className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] text-body">{t}</span>)}</span> : <span className="text-faint">—</span> },
];

export interface PlanOrderPickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (ids: readonly string[]) => void | Promise<void>;
  readonly warehouseId: string;
  readonly clientId?: string | null;
  /** Editing an existing plan: its own orders stay eligible on the server side. */
  readonly planId?: string | null;
  readonly excludeIds?: readonly string[];
  readonly title?: string;
}

function Body({ onOpenChange, onConfirm, warehouseId, clientId, planId, excludeIds = [] }: Omit<PlanOrderPickerProps, "open" | "title">) {
  const fields = useFilterFields(PLAN_ELIGIBLE_ORDER_FIELDS);
  const extraQuery = React.useMemo(() => {
    const out: Record<string, string> = { warehouseId };
    if (clientId) out.clientId = clientId;
    if (planId) out.planId = planId;
    return out;
  }, [warehouseId, clientId, planId]);
  const g = useLocalGrid<EligibleOrder>({ gridKey: "shipment-plan-order-picker", path: "/api/shipment-plans/eligible-orders", fields, extraQuery });
  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds]);
  const ids = g.selectedIds.filter((id) => !excluded.has(id));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reason = pending ? "Adding…" : ids.length === 0 ? "Select at least one order" : null;

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(ids);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(errorMessage(e, "Couldn't add the orders"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GridToolbar {...g.toolbarProps} views={undefined} searchPlaceholder="Order code, store order # or customer" />
      {!g.isLoading && !g.error && g.total === 0 ? (
        // Rendered outside the horizontally scrolling grid so the message is never clipped (critic R3).
        <div className="flex min-h-[240px] flex-1 items-center justify-center px-6">
          <EmptyState compact title={g.grid.query.q || g.grid.query.filters.length > 0 ? "No orders match these filters" : "No eligible orders"}
            description="Only orders of this warehouse that are not shipped, cancelled, on hold or on another active plan can be added." />
        </div>
      ) : (
        <DataGrid<EligibleOrder> {...g.gridProps} gridKey={undefined} queryString={undefined} columns={COLUMNS} getRowId={(o) => o.id}
          canSelectRow={(o) => !excluded.has(o.id)} onAllMatchingSelectedChange={undefined}
          emptyTitle="No eligible orders" emptyDescription="Only orders of this warehouse that are not shipped, cancelled, on hold or on another active plan can be added." />
      )}
      {g.rows.filter((o) => ids.includes(o.id) && o.status !== "Ready to Ship").length > 0 ? (
        <p role="status" className="mx-6 mt-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px]">
          {g.rows.filter((o) => ids.includes(o.id) && o.status !== "Ready to Ship").length} selected {g.rows.filter((o) => ids.includes(o.id) && o.status !== "Ready to Ship").length === 1 ? "order is" : "orders are"} not Ready to Ship. The plan can&apos;t ship them until they are picked and packed.
        </p>
      ) : null}
      {error ? <p role="alert" className="px-6 pt-2 text-[12px] text-danger">{error}</p> : null}
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border px-6 py-3">
        <span className="mr-auto text-[12px] text-secondary">Selected: <strong className="text-foreground">{ids.length}</strong></span>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void confirm()}>
            {ids.length > 1 ? `Add ${ids.length} orders` : "Add selected order"}
          </Button>
        </DisabledReason>
      </div>
    </div>
  );
}

export function PlanOrderPicker({ open, title = "Add order(s)", ...props }: PlanOrderPickerProps) {
  return (
    <Drawer open={open} onOpenChange={props.onOpenChange} title={title} description="Pre-filtered to this warehouse and to orders that can still ship on a truck." width={60} bodyClassName="p-0 flex flex-col">
      {open ? <Body {...props} /> : null}
    </Drawer>
  );
}
