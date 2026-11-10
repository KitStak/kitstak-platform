"use client";

/**
 * Shipment Orders grid columns: all 58 Logiwa columns (+4 on Shipped & Canceled), built
 * from `@/lib/grid-defs/orders/shipment-orders`. Primary-key and job cells are links;
 * the job link text is the job code (the UUID only lives in the href).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { ChannelCell, DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell, MoneyCell, PRIORITY_COLUMN_WIDTH, QtyCell, TagsCell, YesNoPill } from "@/components/grid/cells";
import { PriorityFlag, StatusPill } from "@/components/ui/status-pill";
import { columnsForView, defaultVisibleFor, type OrderColumnDef, type OrderView } from "@/lib/grid-defs/orders/shipment-orders";
import type { OrderRow } from "./orders-client";


const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);

const WIDTH: Readonly<Record<string, number>> = {
  code: 132, storeOrderNumber: 128, storeName: 172, age: 64, processingAge: 96, clientName: 160, warehouseCode: 96, status: 132,
  pickShortStatus: 96, packShortStatus: 96, tags: 150, totalQuantity: 80, skus: 180, jobCode: 112, customerName: 180, carrier: 100,
  shippingService: 150, trackingNumber: 170, salesPrice: 112, rate: 96, orderTypeName: 140, priority: PRIORITY_COLUMN_WIDTH, note: 200,
};

function shortPill(value: unknown) {
  const v = String(value ?? "None");
  if (v === "None") return <span className="text-[12px] text-faint">None</span>;
  if (v === "Open") return <span className="inline-flex rounded-full bg-[#F7E9E4] px-1.5 py-px text-[10px] font-semibold leading-4 text-[#A13406]">Open</span>;
  return <StatusPill status={v} size="sm" />;
}

function weight(oz: unknown) {
  const n = typeof oz === "number" ? oz : 0;
  if (n >= 16) return <span className="tabular-nums">{Math.round((n / 16) * 100) / 100} lb</span>;
  return <span className="tabular-nums">{Math.round(n * 100) / 100} oz</span>;
}

function cellFor(def: OrderColumnDef): ColumnDef<OrderRow, unknown>["cell"] {
  switch (def.id) {
    case "code":
      return ({ row }) => <LinkCell href={`/orders/${encodeURIComponent(row.original.code)}`}>{row.original.code}</LinkCell>;
    case "storeName":
      return ({ row }) => <ChannelCell channel={row.original.channel === "Manual" ? "Manual" : row.original.channel} store={String(row.original.storeName ?? "")} />;
    case "status":
      return ({ row }) => <StatusPill status={row.original.status} domain="shipmentOrder" />;
    case "pickShortStatus":
    case "packShortStatus":
      return ({ getValue }) => shortPill(getValue());
    case "tags":
      return ({ row }) => <TagsCell tags={row.original.tags} />;
    case "jobCode":
      return ({ row }) => (row.original.jobId && row.original.jobCode ? <LinkCell href={`/jobs/${encodeURIComponent(row.original.jobId)}`}>{String(row.original.jobCode)}</LinkCell> : dash);
    case "customerName":
      return ({ row }) => text([row.original.customerName, row.original.shipState].filter(Boolean).join(" / "));
    case "mergedOrderCode":
      return ({ row }) => (row.original.mergedOrderCode ? <LinkCell href={`/orders/${encodeURIComponent(String(row.original.mergedOrderCode))}`}>{String(row.original.mergedOrderCode)}</LinkCell> : dash);
    case "mergedOrderStatus":
      return ({ getValue }) => (getValue() ? <StatusPill status={String(getValue())} domain="shipmentOrder" size="sm" /> : dash);
    case "priority":
      return ({ getValue }) => <PriorityFlag priority={String(getValue() ?? "None")} />;
    case "totalWeightOz":
      return ({ getValue }) => weight(getValue());
    default:
      break;
  }
  switch (def.kind) {
    case "money":
      return ({ getValue }) => <MoneyCell value={getValue() as number | null} />;
    case "integer":
    case "number":
      return ({ getValue }) => <QtyCell value={getValue() as number | null} />;
    case "datetime":
    case "date":
      return ({ getValue }) => <DateCell value={getValue() as string | null} dateOnly={def.kind === "date"} />;
    case "boolean":
      return ({ getValue }) => <YesNoPill value={Boolean(getValue())} />;
    default:
      return ({ getValue }) => text(getValue());
  }
}

export function buildOrderColumns(view: OrderView): ColumnDef<OrderRow, unknown>[] {
  return columnsForView(view).map((def): ColumnDef<OrderRow, unknown> => {
    const numeric = def.kind === "integer" || def.kind === "number" || def.kind === "money";
    const width = WIDTH[def.id] ?? (def.kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : def.kind === "boolean" ? 110 : 140);
    return {
      id: def.id,
      accessorKey: def.id,
      header: def.label,
      size: width,
      minSize: Math.min(width, 64),
      enableSorting: def.sortable !== false,
      enableHiding: def.id !== "code",
      meta: {
        label: def.label,
        defaultVisible: defaultVisibleFor(view, def),
        alwaysVisible: def.id === "code",
        align: numeric ? "right" : undefined,
        clip: !["status", "tags", "priority", "pickShortStatus", "packShortStatus", "mergedOrderStatus"].includes(def.id),
      },
      cell: cellFor(def),
    };
  });
}
