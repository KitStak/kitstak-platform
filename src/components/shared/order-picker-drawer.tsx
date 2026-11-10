"use client";

/**
 * "Add order(s)" drawer (BUILD_PLAN F4.4): shipment-order grid with search, filters and
 * checkbox selection over `GET /api/pickers/orders/grid` (scoped; accepts the grid grammar
 * plus `clientId`, `warehouseId`, `status`). Used by shipment plans, waves and EOD.
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { SO_STATUSES } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { DataGrid } from "@/components/grid/data-grid";
import { DateCell, QtyCell } from "@/components/grid/cells";
import { GridToolbar } from "@/components/grid/grid-toolbar";
import type { FilterFieldDef } from "@/components/grid/grid-types";
import { useLocalGrid } from "@/components/grid/use-grid";

export const orderPickSchema = z.object({
  id: z.string(),
  code: z.string(),
  storeOrderCode: z.string().nullish(),
  clientName: z.string().nullish(),
  status: z.string().default(""),
  customerName: z.string().nullish(),
  lineCount: z.number().nullish(),
  quantity: z.number().nullish(),
  orderDate: z.string().nullish(),
  shipBy: z.string().nullish(),
});
export type OrderPick = z.infer<typeof orderPickSchema>;

export const ORDER_PICKER_FIELDS: readonly FilterFieldDef[] = [
  { field: "status", label: "Status", type: "enum", options: SO_STATUSES.map((s) => ({ value: s, label: s })) },
  { field: "storeOrderCode", label: "Store order #", type: "text" },
  { field: "customerName", label: "Customer", type: "text" },
  { field: "orderDate", label: "Order date", type: "date" },
  { field: "shipBy", label: "Ship by", type: "date" },
  { field: "quantity", label: "Quantity", type: "number" },
];

const COLUMNS: ColumnDef<OrderPick, unknown>[] = [
  { id: "code", header: "Order code", meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-semibold text-foreground">{row.original.code}</span> },
  { id: "storeOrderCode", header: "Store order #", cell: ({ row }) => row.original.storeOrderCode ?? "—" },
  { id: "clientName", header: "Client", enableSorting: false, cell: ({ row }) => row.original.clientName ?? "—" },
  { id: "customerName", header: "Customer", cell: ({ row }) => row.original.customerName ?? "—" },
  { id: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} domain="shipmentOrder" /> },
  { id: "lineCount", header: "Lines", meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.lineCount} /> },
  { id: "quantity", header: "Qty", meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.quantity} /> },
  { id: "orderDate", header: "Order date", cell: ({ row }) => <DateCell value={row.original.orderDate} /> },
  { id: "shipBy", header: "Ship by", cell: ({ row }) => <DateCell value={row.original.shipBy} dateOnly /> },
];

export interface OrderPickerDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (ids: readonly string[]) => void | Promise<void>;
  readonly clientId?: string | null;
  readonly warehouseId?: string | null;
  /** Restrict to statuses (e.g. ["Open", "Ready to Pick"]). */
  readonly statuses?: readonly string[];
  readonly excludeIds?: readonly string[];
  readonly title?: string;
  readonly confirmLabel?: string;
}

function Body({ onOpenChange, onConfirm, clientId, warehouseId, statuses, excludeIds = [], confirmLabel = "Add order(s)" }: Omit<OrderPickerDrawerProps, "open" | "title">) {
  const extraQuery = React.useMemo(() => {
    const out: Record<string, string> = {};
    if (clientId) out.clientId = clientId;
    if (warehouseId) out.warehouseId = warehouseId;
    if (statuses?.length) out.status = statuses.join(",");
    return out;
  }, [clientId, warehouseId, statuses]);
  const g = useLocalGrid<OrderPick>({ gridKey: "picker:orders", path: "/api/pickers/orders/grid", fields: ORDER_PICKER_FIELDS, extraQuery });
  const excluded = new Set(excludeIds);
  const [pending, setPending] = React.useState(false);
  const count = g.selectedIds.length;
  const reason = pending ? "Adding…" : count === 0 ? "Select at least one order" : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <GridToolbar {...g.toolbarProps} views={undefined} searchPlaceholder="Search order code" />
      <DataGrid<OrderPick> {...g.gridProps} gridKey={undefined} queryString={undefined} columns={COLUMNS} getRowId={(o) => o.id} canSelectRow={(o) => !excluded.has(o.id)} onAllMatchingSelectedChange={undefined} emptyTitle="No orders match" emptyDescription="Adjust the search or filters." />
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border px-6 py-3">
        <span className="mr-auto text-[12px] text-secondary">
          Selected: <strong className="text-foreground">{count}</strong>
        </span>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <DisabledReason reason={reason}>
          <Button
            variant="primary"
            disabled={Boolean(reason)}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(g.selectedIds);
                onOpenChange(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DisabledReason>
      </div>
    </div>
  );
}

export function OrderPickerDrawer({ open, title = "Add order(s)", ...props }: OrderPickerDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={props.onOpenChange} title={title} width={60} bodyClassName="p-0 flex flex-col">
      {open ? <Body {...props} /> : null}
    </Drawer>
  );
}
