"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, ClipboardList, Eye, History, Printer, Tag } from "lucide-react";
import { DEV_GRID_KEY, DEV_SEARCH_FIELDS, devOrderField, type DevOrderLines, type DevOrderRow } from "@/lib/dev-orders";
import { applyLocalGridQuery } from "@/lib/local-grid-query";
import { DATE_TIME_COLUMN_WIDTH, PRIORITY_COLUMN_WIDTH, DataGrid, DateCell, GridToolbar, LinkCell, MoneyCell, QtyCell, ChannelCell, useGrid, type BulkAction, type FilterFieldDef, type RowAction } from "@/components/grid";
import { ConfirmDialog, type ConfirmRecords } from "@/components/ui/confirm-dialog";
import { StatusPill, PriorityFlag } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { OrderLinesTable } from "./order-lines-table";
import { ShowcaseSection } from "./showcase-section";

export type { DevOrderRow };
export { DEV_GRID_KEY };

function enumOptions(rows: readonly DevOrderRow[], pick: (r: DevOrderRow) => string) {
  return [...new Set(rows.map(pick))].sort().map((value) => ({ value, label: value }));
}

function buildFields(rows: readonly DevOrderRow[]): readonly FilterFieldDef[] {
  return [
    { field: "status", label: "Status", type: "enum", options: enumOptions(rows, (r) => r.status) },
    { field: "clientName", label: "Client", type: "enum", options: enumOptions(rows, (r) => r.clientName) },
    { field: "channel", label: "Channel", type: "enum", options: enumOptions(rows, (r) => r.channel) },
    { field: "priority", label: "Priority", type: "enum", options: enumOptions(rows, (r) => r.priority) },
    { field: "customerName", label: "Customer", type: "text" },
    { field: "trackingNumber", label: "Tracking number", type: "text", description: "Use Empty to find unshipped orders" },
    { field: "totalQuantity", label: "Total quantity", type: "number" },
    { field: "salesPrice", label: "Sales price", type: "number", decimals: 2 },
    { field: "orderDate", label: "Order date", type: "date" },
  ];
}

const COLUMNS: ColumnDef<DevOrderRow, unknown>[] = [
  { id: "code", accessorKey: "code", header: "Order code", size: 108, meta: { headerTip: "Opens the order detail page" }, cell: ({ row }) => <LinkCell href={`/orders/${row.original.id}`}>{row.original.code}</LinkCell> },
  { id: "status", accessorKey: "status", header: "Status", size: 120, cell: ({ row }) => <StatusPill status={row.original.status} domain="shipmentOrder" /> },
  { id: "clientName", header: "Client", accessorKey: "clientName", size: 168, minSize: 168 },
  { id: "channel", accessorKey: "channel", header: "Channel", size: 128, minSize: 128, cell: ({ row }) => <ChannelCell channel={row.original.channel} /> },
  { id: "storeOrderNumber", header: "Store order #", accessorKey: "storeOrderNumber", size: 140, meta: { defaultVisible: false } },
  { id: "customerName", header: "Customer", accessorKey: "customerName", size: 140, meta: { defaultVisible: false } },
  { id: "shipState", header: "State", accessorKey: "shipState", size: 56, meta: { defaultVisible: false } },
  { id: "priority", accessorKey: "priority", header: "Priority", size: PRIORITY_COLUMN_WIDTH, minSize: PRIORITY_COLUMN_WIDTH, meta: { clip: false }, cell: ({ row }) => <PriorityFlag priority={row.original.priority} /> },
  { id: "totalQuantity", accessorKey: "totalQuantity", header: "Qty", size: 56, meta: { align: "right" }, cell: ({ row }) => <QtyCell value={row.original.totalQuantity} /> },
  { id: "salesPrice", accessorKey: "salesPrice", header: "Sales price", size: 116, minSize: 116, meta: { align: "right" }, cell: ({ row }) => <MoneyCell value={row.original.salesPrice} /> },
  { id: "orderDate", accessorKey: "orderDate", header: "Order date", size: DATE_TIME_COLUMN_WIDTH, minSize: DATE_TIME_COLUMN_WIDTH, cell: ({ row }) => <DateCell value={row.original.orderDate} /> },
  { id: "trackingNumber", header: "Tracking #", accessorKey: "trackingNumber", size: 160, meta: { defaultVisible: false } },
];

/** "1 order selected" / "3 orders selected". */
export function selectedOrdersMessage(count: number): string {
  return `${count} ${count === 1 ? "order" : "orders"} selected (demo).`;
}

/** Statuses past the point of no return: a shipped (or cancelled) order cannot be cancelled. */
const NOT_CANCELLABLE = new Set(["Shipped", "Partially Shipped", "Delivered", "Cancelled"]);

/** Reason the selection cannot be cancelled, or null when every order is still cancellable. */
export function cancelEligibility(rows: readonly DevOrderRow[], ids: readonly string[]): string | null {
  const selected = new Set(ids);
  const blocked = rows.filter((r) => selected.has(r.id) && NOT_CANCELLABLE.has(r.status));
  if (blocked.length === 0) return null;
  const statuses = [...new Set(blocked.map((r) => r.status))];
  const label = statuses.length === 1 ? `${statuses[0]} orders` : "Shipped or cancelled orders";
  return `${label} can't be cancelled (${blocked.map((r) => r.code).slice(0, 3).join(", ")}${blocked.length > 3 ? "…" : ""})`;
}

/** "1 order cancelled (demo)" / "3 orders cancelled (demo)". */
export function cancelledOrdersMessage(count: number): string {
  return `${count} ${count === 1 ? "order" : "orders"} cancelled (demo)`;
}

/** Mini-table (order code + status) for the destructive Cancel confirm. */
export function cancelRecords(rows: readonly DevOrderRow[], ids: readonly string[]): ConfirmRecords {
  const selected = new Set(ids);
  return {
    columns: [{ key: "code", label: "Order" }, { key: "status", label: "Status" }],
    rows: rows.filter((r) => selected.has(r.id)).map((r) => ({ code: r.code, status: <StatusPill status={r.status} domain="shipmentOrder" size="sm" /> })),
  };
}

function buildBulkActions(rows: readonly DevOrderRow[], requestCancel: (ids: readonly string[]) => void): readonly BulkAction[] {
  return [
    { key: "job", label: "Create job", icon: ClipboardList, onSelect: (ids) => toast.success("Create job", selectedOrdersMessage(ids.length)) },
    { key: "tag", label: "Tag", icon: Tag, onSelect: (ids) => toast.info("Tag", selectedOrdersMessage(ids.length)) },
    { key: "cancel", label: "Cancel", icon: Ban, destructive: true, eligibility: (ids) => cancelEligibility(rows, ids), onSelect: requestCancel },
  ];
}

const CANCEL_DEMO_DELAY_MS = 400;

function CancelConfirm({ rows, ids, onClose }: { readonly rows: readonly DevOrderRow[]; readonly ids: readonly string[] | null; readonly onClose: () => void }) {
  const count = ids?.length ?? 0;
  return (
    <ConfirmDialog
      open={ids !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
      variant="danger"
      title={`Cancel ${count} ${count === 1 ? "order" : "orders"}?`}
      description="Allocated stock is released and each order gets a change-log entry."
      records={cancelRecords(rows, ids ?? [])}
      onConfirm={async () => {
        await new Promise((resolve) => setTimeout(resolve, CANCEL_DEMO_DELAY_MS));
        toast.success("Cancelled", cancelledOrdersMessage(count));
      }}
    />
  );
}

function rowActions(row: DevOrderRow): readonly RowAction[] {
  return [
    { key: "details", label: "Show details", icon: Eye, href: `/orders/${row.id}` },
    { key: "print", label: "Print packing slip", icon: Printer, onSelect: () => toast.info("Print", `${row.code} packing slip (demo).`) },
    { key: "log", label: "Change log", icon: History, disabledReason: "Change log opens from the order detail page" },
  ];
}

/** Grid with every toolbar feature over seeded orders, evaluated client-side. */
export function GridShowcase({ rows, lines }: { readonly rows: readonly DevOrderRow[]; readonly lines: DevOrderLines }) {
  const [cancelIds, setCancelIds] = React.useState<readonly string[] | null>(null);
  const fields = React.useMemo(() => buildFields(rows), [rows]);
  const bulkActions = React.useMemo(() => buildBulkActions(rows, setCancelIds), [rows]);
  const g = useGrid<DevOrderRow>({ gridKey: DEV_GRID_KEY, path: null, fields });
  const result = React.useMemo(() => applyLocalGridQuery(rows, g.grid.query, { get: devOrderField, searchFields: DEV_SEARCH_FIELDS }), [rows, g.grid.query]);
  return (
    <ShowcaseSection id="grid" title="Data grid" description={`${rows.length} seeded shipment orders. Quick search (Equal / Starts With), filter builder, chips, saved views, column chooser, density, page sizes, selection, bulk + row actions.`}>
      <div className="-mx-5 -mb-5 border-t border-border">
        <GridToolbar {...g.toolbarProps} searchPlaceholder="Order code, store order #" bulkActions={bulkActions} bulkNoun="order" onRefresh={() => toast.info("Refreshed", "Seeded rows reloaded.")} refreshing={false} />
        <DataGrid<DevOrderRow>
          {...g.gridProps}
          data={[...result.rows]}
          total={result.total}
          loading={false}
          error={null}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          renderExpanded={(row) => <OrderLinesTable code={row.code} lines={lines[row.id] ?? []} />}
        />
      </div>
      <CancelConfirm rows={rows} ids={cancelIds} onClose={() => setCancelIds(null)} />
    </ShowcaseSection>
  );
}
