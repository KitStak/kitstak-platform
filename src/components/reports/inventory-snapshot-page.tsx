"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { CalendarClock, Download, Play, Printer, Tags } from "lucide-react";
import {
  type SnapshotGridRow,
  SNAPSHOT_WAREHOUSES,
  useSnapshotDataset,
} from "@/app/(app)/reports/inventory-snapshot/snapshot-data";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { ReportChip, ReportChipRow } from "./report-chips";
import { useDebouncedValue } from "./use-report-data";

/**
 * Right-aligned numeric cell. Every quantity column (On Hand, Allocated,
 * Damaged, Available) renders through this one component so they share the
 * exact same right edge: the td's `px-3` (12px) padding, `text-right`, and
 * `tabular-nums` so digit columns align vertically across rows.
 */
function QtyCell({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("block text-right tabular-nums", className)}>
      {formatNumber(value)}
    </span>
  );
}

interface SnapshotCsvColumn {
  header: string;
  value: (row: SnapshotGridRow, snapshotAt: string) => string;
}

const SNAPSHOT_CSV_COLUMNS: SnapshotCsvColumn[] = [
  { header: "Warehouse", value: (row) => row.warehouseName },
  { header: "Client", value: (row) => row.clientName },
  { header: "Snapshot Date", value: (_row, snapshotAt) => formatDateTime(snapshotAt) },
  { header: "SKU", value: (row) => row.sku },
  { header: "Product", value: (row) => row.productName },
  { header: "Locations", value: (row) => String(row.locationCount) },
  { header: "Lot #", value: (row) => row.lot ?? "" },
  { header: "On Hand", value: (row) => String(row.onHand) },
  { header: "Allocated", value: (row) => String(row.allocated) },
  { header: "Damaged", value: (row) => String(row.damaged) },
  { header: "Available", value: (row) => String(row.available) },
];

function csvEscape(value: string): string {
  return value.includes(",") || value.includes('"') || value.includes("\n")
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/** Downloads the currently loaded snapshot rows as a CSV file. */
function exportSnapshotCsv(rows: SnapshotGridRow[], snapshotAt: string): void {
  const lines = [
    SNAPSHOT_CSV_COLUMNS.map((col) => csvEscape(col.header)).join(","),
    ...rows.map((row) =>
      SNAPSHOT_CSV_COLUMNS.map((col) => csvEscape(col.value(row, snapshotAt))).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "inventory-snapshot.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function buildColumns(snapshotAt: string): ColumnDef<SnapshotGridRow, unknown>[] {
  return [
    {
      accessorKey: "warehouseCode",
      header: "Warehouse",
      enableSorting: false,
      /*
       * Short warehouse code with the full name in a tooltip. The old 148px
       * column truncated "MLT1 – Main Fulfillment" identically on every row;
       * the ~58px reclaimed here keeps the Available column on screen at
       * 1440px wide.
       */
      size: 90,
      cell: ({ row }) => (
        <span
          className="cursor-help font-medium text-secondary"
          title={row.original.warehouseName}
        >
          {row.original.warehouseCode}
        </span>
      ),
    },
    {
      accessorKey: "clientName",
      header: "Client",
      size: 140,
      cell: ({ getValue }) => (
        <span className="block max-w-[130px] truncate text-body" title={getValue<string>()}>
          {getValue<string>()}
        </span>
      ),
    },
    {
      id: "snapshotDate",
      header: "Snapshot Date",
      enableSorting: false,
      /*
       * Every row shares the run timestamp (it is also the active filter
       * chip), so the column is de-emphasized — 12px, faint ink — and
       * narrowed; the reclaimed width goes to keeping Available on screen.
       */
      size: 130,
      cell: () => (
        <span className="text-[12px] tabular-nums text-faint">
          {formatDateTime(snapshotAt)}
        </span>
      ),
    },
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => (
        <Link
          href={`/products/${row.original.productId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-primary hover:underline"
        >
          {row.original.sku}
        </Link>
      ),
    },
    {
      accessorKey: "productName",
      header: "Product",
      size: 210,
      cell: ({ getValue }) => (
        <span className="block max-w-[200px] truncate text-body" title={getValue<string>()}>
          {getValue<string>()}
        </span>
      ),
    },
    {
      accessorKey: "locationCount",
      header: "Locations",
      enableSorting: false,
      size: 90,
      cell: ({ row }) => (
        <QtyCell value={row.original.locationCount} className="text-secondary" />
      ),
    },
    {
      id: "lot",
      header: "Lot #",
      enableSorting: false,
      size: 100,
      cell: ({ row }) =>
        row.original.lot ? (
          <span className="tabular-nums text-secondary">{row.original.lot}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      accessorKey: "onHand",
      header: "On Hand",
      size: 90,
      cell: ({ row }) => <QtyCell value={row.original.onHand} className="text-body" />,
    },
    {
      accessorKey: "allocated",
      header: "Allocated",
      size: 90,
      cell: ({ row }) => <QtyCell value={row.original.allocated} className="text-body" />,
    },
    {
      accessorKey: "damaged",
      header: "Damaged",
      size: 90,
      /*
       * Zero damaged units read as "—" (same empty-value language as Lot #),
       * still right-aligned through QtyCell's text-right so the em dash sits
       * on the same edge as the red nonzero counts.
       */
      cell: ({ row }) =>
        row.original.damaged > 0 ? (
          <QtyCell value={row.original.damaged} className="text-danger" />
        ) : (
          <span aria-label="No damaged units" className="block text-right text-faint">
            —
          </span>
        ),
    },
    {
      accessorKey: "available",
      header: "Available",
      size: 95,
      cell: ({ row }) => (
        <QtyCell value={row.original.available} className="font-semibold text-foreground" />
      ),
    },
  ];
}

export function InventorySnapshotPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  /** One stable timestamp per run — every row shares the snapshot moment. */
  const [snapshotAt] = React.useState(() => new Date().toISOString());

  const debouncedSearch = useDebouncedValue(search);
  const { rows: allRows, loading, error, refetch } = useSnapshotDataset();

  const typed = debouncedSearch.trim().toLowerCase();
  const clientFilter = filters.client;

  const filteredRows = React.useMemo(
    () =>
      allRows.filter(
        (row) =>
          (typed === "" ||
            row.sku.toLowerCase().includes(typed) ||
            row.productName.toLowerCase().includes(typed)) &&
          (clientFilter === undefined || row.clientName === clientFilter)
      ),
    [allRows, typed, clientFilter]
  );

  const total = filteredRows.length;
  /* Clamp instead of resetting in an effect: if a search or filter shrinks
   * the result set below the current page, the view snaps to the last page. */
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = React.useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage, pageSize]
  );

  const clientOptions = React.useMemo(
    () => Array.from(new Set(allRows.map((row) => row.clientName))).sort(),
    [allRows]
  );

  const columns = React.useMemo(() => buildColumns(snapshotAt), [snapshotAt]);

  const applyFilters = (next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
    setSelection({});
  };

  return (
    /*
     * h-[calc(100dvh-3.5rem)] bounds the page to the viewport below the 56px
     * top nav so the grid footer (totals, rows-per-page, pager, export) is
     * always on screen; the table body scrolls inside the grid instead.
     */
    <div className="ks-snapshot-report flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col pb-4">
      {/*
       * Local fixes scoped to this page because the shared DataGrid and
       * app shell are read-only here:
       * 1. Sortable headers render inside a <button>, and the UA stylesheet's
       *    `text-transform: none` blocks the <th>'s `uppercase` from
       *    inheriting.
       * 2. The top-nav global search pill (app-shell) is 224px wide, which
       *    wraps its placeholder onto two lines; widening it to 280px and
       *    forcing nowrap keeps "Search orders, SKUs, locations…" on one
       *    line. The durable fix belongs in app-shell (see
       *    sharedComponentRequests).
       */}
      <style>{`
        .ks-snapshot-report th button { text-transform: inherit; }
        button.w-56.rounded-full { width: 280px; white-space: nowrap; }
      `}</style>
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Inventory Snapshot" }]}
        title="Inventory Snapshot Report"
        actions={
          <>
            <Button variant="secondary">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Schedule
            </Button>
            <Button variant="primary" onClick={refetch}>
              <Play className="h-3.5 w-3.5" aria-hidden />
              Run Report
            </Button>
          </>
        }
      />
      <p className="mt-1 px-6 text-left text-[13px] text-secondary">
        Point-in-time on hand, allocated and damaged quantities by SKU
      </p>
      <ReportChipRow>
        <ReportChip
          icon={CalendarClock}
          label="Snapshot date"
          value={formatDateTime(snapshotAt)}
          active
        />
        <ReportChip label={`All warehouses (${SNAPSHOT_WAREHOUSES.length})`} />
        <ReportChip label="Within 1 day" />
        <ReportChip label="All zones" />
        <ReportChip label="All lots" />
      </ReportChipRow>
      <DataGrid<SnapshotGridRow>
        columns={columns}
        data={pageRows}
        total={total}
        page={currentPage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        loading={loading}
        error={error}
        onRetry={refetch}
        onRefresh={refetch}
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="inventory-snapshot"
        emptyTitle="No inventory in this snapshot"
        emptyDescription="Try clearing the client filter or searching for a different SKU."
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search by SKU"
            />
            <FilterButton
              filters={[{ key: "client", label: "Client", options: clientOptions }]}
              applied={filters}
              onApply={applyFilters}
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print Labels
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <Tags className="h-3.5 w-3.5" aria-hidden />
              Tag
            </Button>
            <Button
              variant="secondary"
              disabled={pageRows.length === 0}
              onClick={() => exportSnapshotCsv(pageRows, snapshotAt)}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export
            </Button>
          </>
        )}
      />
    </div>
  );
}
