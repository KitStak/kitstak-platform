"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { ChannelBadge } from "@/components/ui/status-pill";
import type { ListingRow, ListingStatus } from "./types";

function ListingStatusChip({ status }: { status: ListingStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap",
        status === "Live" ? "bg-success-soft text-success" : "bg-neutral-soft text-neutral"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "Live" ? "bg-success" : "bg-neutral"
        )}
        aria-hidden
      />
      {status}
    </span>
  );
}

export const listingColumns: ColumnDef<ListingRow, unknown>[] = [
  {
    accessorKey: "listingSku",
    header: "Listing SKU",
    cell: ({ row }) => (
      <Link
        href={`/products/${row.original.productId}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {row.original.listingSku}
      </Link>
    ),
  },
  {
    accessorKey: "channel",
    header: "Channel",
    cell: ({ row }) => (
      <ChannelBadge channel={row.original.channel} store={row.original.store} />
    ),
  },
  {
    accessorKey: "productName",
    header: "Product Name",
    cell: ({ row }) => (
      <span
        className="block max-w-[260px] truncate text-body"
        title={row.original.productName}
      >
        {row.original.productName}
      </span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => (
      <span className="block max-w-[140px] truncate text-body" title={row.original.clientName}>
        {row.original.clientName}
      </span>
    ),
  },
  {
    accessorKey: "masterSku",
    header: "Master SKU",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-secondary">{row.original.masterSku}</span>
    ),
  },
  {
    accessorKey: "price",
    header: "Listing Price",
    size: 100,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-body">
        {formatMoney(row.original.price)}
      </div>
    ),
  },
  {
    accessorKey: "qtyAvailable",
    header: "Available Qty",
    size: 100,
    cell: ({ row }) => (
      <div
        className={cn(
          "text-right tabular-nums",
          row.original.qtyAvailable === 0 ? "font-medium text-danger" : "text-body"
        )}
      >
        {formatNumber(row.original.qtyAvailable)}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 88,
    cell: ({ row }) => <ListingStatusChip status={row.original.status} />,
  },
  {
    accessorKey: "lastSyncedAt",
    header: "Last Synced",
    cell: ({ row }) => (
      <span className="text-secondary">{formatDateTime(row.original.lastSyncedAt)}</span>
    ),
  },
];
