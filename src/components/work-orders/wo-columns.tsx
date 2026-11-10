"use client";

/** Work Orders grid: the 20 Logiwa columns. Requested Kit Quantity carries a build-progress bar. */
import type { ColumnDef } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell, TagsCell } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkOrderRow } from "./wo-client";

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);
const longText = (v: unknown) => {
  if (v === null || v === undefined || v === "") return dash;
  const s = String(v);
  return s.length > 40 ? <Tooltip content={<span className="block max-w-[320px] whitespace-pre-wrap">{s}</span>}><span className="truncate">{s}</span></Tooltip> : <span className="truncate">{s}</span>;
};
const date = (id: keyof WorkOrderRow & string, header: string): ColumnDef<WorkOrderRow, unknown> => ({
  id, accessorKey: id, header, size: DATE_TIME_COLUMN_WIDTH, minSize: DATE_TIME_COLUMN_WIDTH,
  cell: ({ getValue }) => <DateCell value={getValue() as string | null} />,
});

export function BuildProgress({ processed, requested, className }: { readonly processed: number; readonly requested: number; readonly className?: string }) {
  const pct = requested > 0 ? Math.min(100, Math.round((processed / requested) * 100)) : 0;
  return (
    <span className={cn("flex w-full flex-col items-end gap-0.5", className)} title={`${processed.toLocaleString()} of ${requested.toLocaleString()} kits built`}>
      <span className="tabular-nums">{requested.toLocaleString()}</span>
      <span className="h-1 w-full max-w-[72px] overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function buildWoColumns(): ColumnDef<WorkOrderRow, unknown>[] {
  return [
    {
      id: "code", accessorKey: "code", header: "Work order code", size: 150, minSize: 120, meta: { alwaysVisible: true },
      cell: ({ row }) => <LinkCell href={`/work-orders/${row.original.id}`}>{row.original.code}</LinkCell>,
    },
    { id: "warehouseCode", accessorKey: "warehouseCode", header: "Warehouse", size: 110, cell: ({ getValue }) => text(getValue()) },
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 160, cell: ({ getValue }) => text(getValue()) },
    { id: "status", accessorKey: "status", header: "Work order status", size: 140, meta: { clip: false }, cell: ({ row }) => <StatusPill status={row.original.status} domain="workOrder" /> },
    {
      id: "age", accessorKey: "age", header: "Age", size: 80, meta: { align: "right", headerTip: "Days since the work order was created" },
      cell: ({ row }) => <span className={cn("tabular-nums", row.original.age > 14 && row.original.status !== "Completed" && row.original.status !== "Cancelled" && "font-semibold text-warning")}>{row.original.age}</span>,
    },
    { id: "operationType", accessorKey: "operationType", header: "Work order operation type", size: 170, cell: ({ getValue }) => text(getValue()) },
    { id: "type", accessorKey: "type", header: "Work order type", size: 200, cell: ({ getValue }) => text(getValue()) },
    { id: "tags", accessorKey: "tags", header: "Tags", size: 150, enableSorting: false, meta: { clip: false }, cell: ({ row }) => <TagsCell tags={row.original.tags} /> },
    {
      id: "jobCode", accessorKey: "jobCode", header: "Job code", size: 130,
      cell: ({ row }) => (row.original.jobId && row.original.jobCode ? <LinkCell href={`/jobs/${row.original.jobId}`}>{row.original.jobCode}</LinkCell> : dash),
    },
    { id: "kitSku", accessorKey: "kitSku", header: "Kit SKU", size: 160, cell: ({ row }) => <span className="truncate font-medium text-foreground" title={row.original.kitName}>{row.original.kitSku}</span> },
    {
      id: "requestedQty", accessorKey: "requestedQty", header: "Requested kit quantity", size: 150, meta: { align: "right", headerTip: "Kits to build; the bar shows how many are built." },
      cell: ({ row }) => <BuildProgress processed={row.original.processedQty} requested={row.original.requestedQty} />,
    },
    {
      id: "processedQty", accessorKey: "processedQty", header: "Processed quantity", size: 130, meta: { align: "right" },
      cell: ({ row }) => (row.original.processedQty > 0 ? <span className="tabular-nums">{row.original.processedQty.toLocaleString()}</span> : dash),
    },
    { id: "extraNote", accessorKey: "extraNote", header: "Extra notes", size: 200, cell: ({ getValue }) => longText(getValue()) },
    { id: "kittingInstructions", accessorKey: "kittingInstructions", header: "Kitting instructions", size: 200, cell: ({ getValue }) => longText(getValue()) },
    date("createdAt", "Created date"),
    date("plannedStartAt", "Planned start date"),
    date("plannedFinishAt", "Planned finish date"),
    date("actualStartAt", "Actual start date"),
    date("actualFinishAt", "Actual finish date"),
    date("cancelledAt", "Cancellation date"),
  ];
}
