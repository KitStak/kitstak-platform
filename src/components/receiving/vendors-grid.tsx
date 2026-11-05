"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { PoGrid } from "./po-grid";

/** One vendor row, aggregated client-side from the PO dataset. */
export interface VendorRow {
  vendor: string;
  poCount: number;
  openCount: number;
  unitsOrdered: number;
  unitsReceived: number;
  purchaseValue: number;
  lastPoId: string;
  lastPoCode: string;
  lastPoDate: string;
}

const OPEN_STATUSES = new Set(["Pending", "Started", "Receiving"]);

/** Group purchase orders by vendor into aggregate rows (most POs first). */
export function deriveVendors(pos: PurchaseOrderListRow[]): VendorRow[] {
  const byVendor = new Map<string, VendorRow>();
  for (const po of pos) {
    const existing = byVendor.get(po.vendorName);
    const isNewer = !existing || po.createdAt > existing.lastPoDate;
    const base: VendorRow = existing ?? {
      vendor: po.vendorName,
      poCount: 0,
      openCount: 0,
      unitsOrdered: 0,
      unitsReceived: 0,
      purchaseValue: 0,
      lastPoId: po.id,
      lastPoCode: po.code,
      lastPoDate: po.createdAt,
    };
    byVendor.set(po.vendorName, {
      ...base,
      poCount: base.poCount + 1,
      openCount: base.openCount + (OPEN_STATUSES.has(po.status) ? 1 : 0),
      unitsOrdered: base.unitsOrdered + po.totalQuantity,
      unitsReceived: base.unitsReceived + po.receivedQuantity,
      purchaseValue: base.purchaseValue + po.purchasePrice,
      lastPoId: isNewer ? po.id : base.lastPoId,
      lastPoCode: isNewer ? po.code : base.lastPoCode,
      lastPoDate: isNewer ? po.createdAt : base.lastPoDate,
    });
  }
  return [...byVendor.values()].sort((a, b) => b.poCount - a.poCount);
}

const numeric = "block text-right text-[13px] tabular-nums text-body";

const VENDOR_COLUMNS: ColumnDef<VendorRow, unknown>[] = [
  {
    accessorKey: "vendor",
    header: "Vendor",
    cell: ({ row }) => (
      <span className="text-[13px] font-medium text-foreground">{row.original.vendor}</span>
    ),
  },
  {
    accessorKey: "poCount",
    header: "POs",
    meta: { align: "right" },
    cell: ({ row }) => <span className={numeric}>{formatNumber(row.original.poCount)}</span>,
  },
  {
    accessorKey: "openCount",
    header: "Open POs",
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.openCount > 0 ? (
        <span className="block text-right text-[13px] font-medium tabular-nums text-primary">
          {formatNumber(row.original.openCount)}
        </span>
      ) : (
        <span className="block text-right text-[12px] text-faint">—</span>
      ),
  },
  {
    accessorKey: "unitsOrdered",
    header: "Units Ordered",
    meta: { align: "right" },
    cell: ({ row }) => <span className={numeric}>{formatNumber(row.original.unitsOrdered)}</span>,
  },
  {
    accessorKey: "unitsReceived",
    header: "Units Received",
    meta: { align: "right" },
    cell: ({ row }) => <span className={numeric}>{formatNumber(row.original.unitsReceived)}</span>,
  },
  {
    accessorKey: "purchaseValue",
    header: "Purchase Value",
    meta: { align: "right" },
    cell: ({ row }) => <span className={numeric}>{formatMoney(row.original.purchaseValue)}</span>,
  },
  {
    accessorKey: "lastPoCode",
    header: "Last PO",
    cell: ({ row }) => (
      <Link
        href={`/receiving/${row.original.lastPoId}`}
        className="text-[13px] font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {row.original.lastPoCode}
      </Link>
    ),
  },
  {
    accessorKey: "lastPoDate",
    header: "Last PO Date",
    cell: ({ row }) => (
      <span className="text-[13px] text-secondary">{formatDate(row.original.lastPoDate)}</span>
    ),
  },
];

export interface VendorsGridProps {
  pos: PurchaseOrderListRow[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  search: string;
  toolbarLeft?: React.ReactNode;
}

/** VENDORS tab: client-side aggregation + paging over the PO dataset. */
export function VendorsGrid({
  pos,
  loading,
  error,
  onRetry,
  search,
  toolbarLeft,
}: VendorsGridProps) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);

  const vendors = React.useMemo(() => deriveVendors(pos ?? []), [pos]);
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.vendor.toLowerCase().includes(q));
  }, [vendors, search]);

  React.useEffect(() => {
    setPage(1);
  }, [search]);

  const pageRows = React.useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  return (
    <PoGrid<VendorRow>
      columns={VENDOR_COLUMNS}
      data={pageRows}
      total={filtered.length}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      loading={loading}
      error={error}
      onRetry={onRetry}
      getRowId={(row) => row.vendor}
      exportName="vendors"
      emptyTitle="No vendors found"
      emptyDescription="Vendors appear here once purchase orders reference them."
      toolbarLeft={toolbarLeft}
    />
  );
}
