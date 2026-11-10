"use client";

/** Purchase Orders grid: the 16 Logiwa columns (all visible by default) plus a receive-progress bar inside Total Quantity. */
import type { ColumnDef } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell, MoneyCell, TagsCell } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { PoRow } from "./receiving-shared";

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);
const date = (id: keyof PoRow & string, header: string, sortable = true): ColumnDef<PoRow, unknown> => ({
  id, accessorKey: id, header, size: DATE_TIME_COLUMN_WIDTH, minSize: DATE_TIME_COLUMN_WIDTH, enableSorting: sortable,
  cell: ({ getValue }) => <DateCell value={getValue() as string | null} />,
});

export function QtyProgress({ received, total }: { readonly received: number; readonly total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <span className="flex w-full flex-col items-end gap-0.5" title={`${received.toLocaleString()} of ${total.toLocaleString()} received`}>
      <span className="tabular-nums">{total.toLocaleString()}</span>
      <span className="h-1 w-full max-w-[72px] overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function buildPoColumns(): ColumnDef<PoRow, unknown>[] {
  return [
    {
      id: "code", accessorKey: "code", header: "PO number", size: 140, minSize: 120, meta: { alwaysVisible: true },
      cell: ({ row }) => <LinkCell href={`/receiving/${row.original.id}`}>{row.original.code}</LinkCell>,
    },
    { id: "vendorName", accessorKey: "vendorName", header: "Vendor", size: 180, cell: ({ getValue }) => text(getValue()) },
    { id: "referenceNumber", accessorKey: "referenceNumber", header: "Reference number", size: 140, cell: ({ getValue }) => text(getValue()) },
    { id: "purchasePrice", accessorKey: "purchasePrice", header: "Purchase price", size: 124, meta: { align: "right" }, cell: ({ getValue }) => <MoneyCell value={getValue() as number} /> },
    {
      id: "totalQuantity", accessorKey: "totalQuantity", header: "Total quantity", size: 116, meta: { align: "right", headerTip: "Ordered units; the bar shows how much is received." },
      cell: ({ row }) => <QtyProgress received={row.original.receivedQuantity} total={row.original.totalQuantity} />,
    },
    { id: "status", accessorKey: "status", header: "Status", size: 116, meta: { clip: false }, cell: ({ row }) => <StatusPill status={row.original.status} domain="purchaseOrder" /> },
    { id: "poType", accessorKey: "poType", header: "PO type", size: 150, cell: ({ getValue }) => text(getValue()) },
    { id: "tags", accessorKey: "tags", header: "Tags", size: 150, meta: { sortKey: "tags", clip: false }, cell: ({ row }) => <TagsCell tags={row.original.tags} /> },
    date("poDate", "PO date"),
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 168, cell: ({ getValue }) => text(getValue()) },
    { id: "warehouseName", accessorKey: "warehouseName", header: "Warehouse", size: 180, cell: ({ getValue }) => text(getValue()) },
    date("createdAt", "Created date"),
    date("plannedReceivingDate", "Planned receiving date"),
    date("receivedAt", "Actual receiving date"),
    date("plannedArrivalDate", "Planned arrival date"),
    date("actualArrivalDate", "Actual arrival date"),
  ];
}
