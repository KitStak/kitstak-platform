"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

/** Received qty + thin inline progress bar + percentage, Logiwa-style. */
export function ReceivedProgress({
  received,
  total,
}: {
  received: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-[13px] tabular-nums text-body">
        {formatNumber(received)}
      </span>
      <span
        className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-neutral-soft"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% received`}
      >
        <span
          className={cn(
            "block h-full rounded-full",
            pct >= 100 ? "bg-success" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-9 text-right text-[11px] tabular-nums text-faint">{pct}%</span>
    </div>
  );
}

function PoCodeLink({ id, code }: { id: string; code: string }) {
  return (
    <Link
      href={`/receiving/${id}`}
      className="text-[13px] font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
      onClick={(e) => e.stopPropagation()}
    >
      {code}
    </Link>
  );
}

const muted = "text-[13px] text-secondary";
const numeric = "block text-right text-[13px] tabular-nums text-body";

/** Columns for the PURCHASE ORDERS tab. */
export const PO_COLUMNS: ColumnDef<PurchaseOrderListRow, unknown>[] = [
  {
    accessorKey: "code",
    header: "PO Number",
    cell: ({ row }) => <PoCodeLink id={row.original.id} code={row.original.code} />,
  },
  {
    accessorKey: "vendorName",
    header: "Vendor",
    cell: ({ row }) => (
      <span className="max-w-[180px] truncate text-[13px] text-body">
        {row.original.vendorName}
      </span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => <span className={muted}>{row.original.clientName}</span>,
  },
  {
    accessorKey: "referenceNumber",
    header: "Reference #",
    cell: ({ row }) =>
      row.original.referenceNumber ? (
        <span className={muted}>{row.original.referenceNumber}</span>
      ) : (
        <span className="text-[12px] text-faint">—</span>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "poType",
    header: "PO Type",
    cell: ({ row }) => <span className={muted}>{row.original.poType}</span>,
  },
  {
    accessorKey: "totalQuantity",
    header: "Total Qty",
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.totalQuantity)}</span>
    ),
  },
  {
    accessorKey: "receivedQuantity",
    header: "Received",
    enableSorting: false,
    cell: ({ row }) => (
      <ReceivedProgress
        received={row.original.receivedQuantity}
        total={row.original.totalQuantity}
      />
    ),
  },
  {
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    cell: ({ row }) => (
      <span className={numeric}>{formatMoney(row.original.purchasePrice)}</span>
    ),
  },
  {
    accessorKey: "expectedDate",
    header: "Expected Date",
    cell: ({ row }) => <span className={muted}>{formatDate(row.original.expectedDate)}</span>,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <span className={muted}>{formatDateTime(row.original.createdAt)}</span>,
  },
];

/** Columns for the RECEIVING HISTORY tab (completed POs). */
export const HISTORY_COLUMNS: ColumnDef<PurchaseOrderListRow, unknown>[] = [
  {
    accessorKey: "code",
    header: "PO Number",
    cell: ({ row }) => <PoCodeLink id={row.original.id} code={row.original.code} />,
  },
  {
    accessorKey: "vendorName",
    header: "Vendor",
    cell: ({ row }) => (
      <span className="max-w-[180px] truncate text-[13px] text-body">
        {row.original.vendorName}
      </span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => <span className={muted}>{row.original.clientName}</span>,
  },
  {
    accessorKey: "referenceNumber",
    header: "Reference #",
    cell: ({ row }) =>
      row.original.referenceNumber ? (
        <span className={muted}>{row.original.referenceNumber}</span>
      ) : (
        <span className="text-[12px] text-faint">—</span>
      ),
  },
  {
    accessorKey: "poType",
    header: "PO Type",
    cell: ({ row }) => <span className={muted}>{row.original.poType}</span>,
  },
  {
    accessorKey: "totalQuantity",
    header: "Ordered Qty",
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.totalQuantity)}</span>
    ),
  },
  {
    accessorKey: "receivedQuantity",
    header: "Received Qty",
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.receivedQuantity)}</span>
    ),
  },
  {
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    cell: ({ row }) => (
      <span className={numeric}>{formatMoney(row.original.purchasePrice)}</span>
    ),
  },
  {
    accessorKey: "receivedAt",
    header: "Received At",
    cell: ({ row }) => <span className={muted}>{formatDateTime(row.original.receivedAt)}</span>,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <span className={muted}>{formatDate(row.original.createdAt)}</span>,
  },
];
