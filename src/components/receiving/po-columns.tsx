"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

/**
 * Received qty + thin inline progress bar + percentage, Logiwa-style.
 *
 * Zero-progress rows are deliberately quiet: a faint em-dash replaces the
 * "0" numeral and the empty track drops to 50% opacity, so across a page of
 * mostly-pending POs the eye lands on the rows with actual progress instead
 * of seven full-width gray tracks all announcing "0 / 0%".
 */
export function ReceivedProgress({
  received,
  total,
}: {
  received: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const hasProgress = received > 0;
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "w-14 text-right text-[13px] tabular-nums",
          hasProgress ? "text-body" : "text-faint"
        )}
      >
        {hasProgress ? formatNumber(received) : "—"}
      </span>
      <span
        className={cn(
          "h-1 w-16 shrink-0 overflow-hidden rounded-full bg-neutral-soft",
          !hasProgress && "opacity-50"
        )}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% received`}
      >
        {hasProgress ? (
          <span
            className={cn(
              "block h-full rounded-full",
              pct >= 100 ? "bg-success" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        ) : null}
      </span>
      <span className="w-9 text-right text-[11px] tabular-nums text-faint">{pct}%</span>
    </div>
  );
}

function PoCodeLink({ id, code }: { id: string; code: string }) {
  return (
    <Link
      href={`/receiving/${id}`}
      className="text-[13px] font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
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
    size: 110,
    cell: ({ row }) =>
      row.original.referenceNumber ? (
        <span
          className={cn(muted, "inline-block max-w-[110px] truncate align-middle")}
          title={row.original.referenceNumber}
        >
          {row.original.referenceNumber}
        </span>
      ) : (
        <span className="text-[12px] text-faint">—</span>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusPill
        status={row.original.status}
        /*
         * "Started" and "Receiving" are both blue in the shared StatusPill
         * palette (read-only src/components/ui/status-pill.tsx) and read as
         * the same state at a glance. Locally tint "Started" indigo
         * (#4F46E5 on #EEF2FF) so the two in-progress states are scannable;
         * the palette-level fix is listed as a shared-component request.
         */
        className={
          row.original.status === "Started"
            ? "bg-[#EEF2FF] text-[#4F46E5]"
            : undefined
        }
      />
    ),
  },
  /*
   * "PO Type" column intentionally removed: every row in the current dataset
   * carries the same value ("Purchase Order"), so the column added ~120px of
   * zero-information width that pushed "Created" past the right viewport edge.
   * The value still shows on the PO detail summary. If mixed types return to
   * the dataset (e.g. Transfer Orders), reintroduce it behind column config.
   */
  {
    accessorKey: "totalQuantity",
    header: "Total Qty",
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.totalQuantity)}</span>
    ),
  },
  {
    accessorKey: "receivedQuantity",
    header: "Received",
    enableSorting: false,
    /* Right-align the header label to the right edge of the w-14 numeral
       slot below it (same treatment as the Total Qty header) so the column
       scans cleanly instead of a left header over right-aligned numbers. */
    meta: { headerClassName: "inline-block w-14 text-right" },
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
    meta: { align: "right" },
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
    size: 160,
    cell: ({ row }) => (
      /* min-width + nowrap: the last column must render fully legible dates,
         never glyphs sliced at the viewport edge. */
      <span className={cn(muted, "inline-block min-w-[100px] whitespace-nowrap")}>
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
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
    size: 110,
    cell: ({ row }) =>
      row.original.referenceNumber ? (
        <span
          className={cn(muted, "inline-block max-w-[110px] truncate align-middle")}
          title={row.original.referenceNumber}
        >
          {row.original.referenceNumber}
        </span>
      ) : (
        <span className="text-[12px] text-faint">—</span>
      ),
  },
  /* "PO Type" removed here too — see note on PO_COLUMNS. */
  {
    accessorKey: "totalQuantity",
    header: "Ordered Qty",
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.totalQuantity)}</span>
    ),
  },
  {
    accessorKey: "receivedQuantity",
    header: "Received Qty",
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className={numeric}>{formatNumber(row.original.receivedQuantity)}</span>
    ),
  },
  {
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    meta: { align: "right" },
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
    size: 160,
    cell: ({ row }) => (
      <span className={cn(muted, "inline-block min-w-[100px] whitespace-nowrap")}>
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
];
