"use client";

/** Return Orders grid: the 25 Logiwa columns (visible by default) plus KitStaks extras (hidden). */
import type { ColumnDef } from "@tanstack/react-table";
import { ChannelCell, DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import type { ReturnLineRow } from "./return-types";

const dash = <span className="text-secondary">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);

type Col = ColumnDef<ReturnLineRow, unknown>;

const plain = (id: keyof ReturnLineRow & string, header: string, size = 150, hidden = false): Col => ({
  id, accessorKey: id, header, size, ...(hidden ? { meta: { defaultVisible: false } } : {}), cell: ({ getValue }) => text(getValue()),
});
const date = (id: keyof ReturnLineRow & string, header: string, dateOnly = false): Col => ({
  id, accessorKey: id, header, size: DATE_TIME_COLUMN_WIDTH, minSize: DATE_TIME_COLUMN_WIDTH,
  cell: ({ getValue }) => <DateCell value={getValue() as string | null} dateOnly={dateOnly} />,
});
const qty = (id: "requestedQty" | "returnedQty", header: string): Col => ({
  id, accessorKey: id, header, size: 120, meta: { align: "right" },
  cell: ({ row }) => {
    const v = row.original[id];
    const short = id === "returnedQty" && row.original.returnedQty < row.original.requestedQty && row.original.status === "Completed";
    return <span className={short ? "w-full text-right font-medium tabular-nums text-warning" : "w-full text-right tabular-nums"}>{v.toLocaleString()}</span>;
  },
});

export function buildReturnColumns(): Col[] {
  return [
    {
      id: "shipmentOrderCode", accessorKey: "shipmentOrderCode", header: "Shipment order code", size: 150,
      cell: ({ row }) => (row.original.shipmentOrderId ? <LinkCell href={`/orders/${row.original.shipmentOrderId}`}>{row.original.shipmentOrderCode}</LinkCell> : <span className="text-secondary">Manual return</span>),
    },
    {
      id: "rmaCode", accessorKey: "rmaCode", header: "RMA code", size: 130, meta: { alwaysVisible: true },
      cell: ({ row }) => <LinkCell href={`/orders/returns/${row.original.returnOrderId}`}>{row.original.rmaCode}</LinkCell>,
    },
    plain("storeOrderNumber", "Store order number", 150),
    { id: "store", accessorKey: "store", header: "Store", size: 130, meta: { clip: false }, cell: ({ row }) => (row.original.store ? <ChannelCell channel={row.original.store} /> : dash) },
    plain("companyName", "Company name"),
    { ...plain("returnAddress", "Return address", 240), enableSorting: false },
    plain("fromCountry", "From country name", 130),
    { id: "status", accessorKey: "status", header: "Status", size: 120, meta: { clip: false }, cell: ({ row }) => <StatusPill status={row.original.status} domain="return" /> },
    qty("requestedQty", "Requested quantity"),
    qty("returnedQty", "Returned quantity"),
    {
      id: "sku", accessorKey: "sku", header: "SKU", size: 150,
      cell: ({ row }) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-medium">{row.original.sku}</span><span className="truncate text-[11px] text-secondary">{row.original.productName}</span></span>,
    },
    plain("customerName", "Customer name", 160),
    plain("carrierName", "Carrier name", 120),
    plain("carrierServiceName", "Carrier shipping option name", 200),
    plain("trackingNumber", "Tracking number", 170),
    plain("packType", "Pack type", 100),
    date("createdAt", "Return order created date"),
    date("shipmentOrderDate", "Shipment order date"),
    date("deliveryDate", "Shipment order delivery date"),
    date("expectedReturnDate", "Expected return date", true),
    date("actualReturnDate", "Actual return date"),
    plain("createdByName", "Created by", 140),
    plain("warehouseCode", "Warehouse", 110),
    plain("clientName", "Client", 160),
    {
      id: "tagNames", accessorKey: "tagNames", header: "Tags", size: 150, enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return dash;
        return <span className="flex min-w-0 gap-1 overflow-hidden">{v.split(", ").slice(0, 2).map((t) => <span key={t} className="truncate rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">{t}</span>)}</span>;
      },
    },
    { id: "lineStatus", accessorKey: "lineStatus", header: "Line status", size: 120, meta: { clip: false, defaultVisible: false }, cell: ({ row }) => <StatusPill status={row.original.lineStatus} domain="return" size="sm" /> },
    plain("source", "Source", 110, true),
    plain("disposition", "Disposition", 120, true),
    { ...plain("customerReturnReason", "Customer return reason", 180, true), enableSorting: false },
    { ...plain("actualReturnReason", "Actual return reason", 180, true), enableSorting: false },
  ];
}
