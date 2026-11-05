"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { CalendarClock, Play, Printer, Tags } from "lucide-react";
import type { InventorySnapshotRow } from "@/server/repositories/reports";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { ReportChip, ReportChipRow } from "./report-chips";
import { WAREHOUSE_NAME, lotNumberFor } from "./report-format";
import { useClientOptions, useDebouncedValue, useReportRows } from "./use-report-data";

function QtyCell({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("block text-right tabular-nums", className)}>
      {formatNumber(value)}
    </span>
  );
}

function buildColumns(snapshotAt: string): ColumnDef<InventorySnapshotRow, unknown>[] {
  return [
    {
      id: "warehouse",
      header: "Warehouse",
      enableSorting: false,
      size: 180,
      cell: () => <span className="text-secondary">{WAREHOUSE_NAME}</span>,
    },
    {
      accessorKey: "clientName",
      header: "Client",
      cell: ({ getValue }) => (
        <span className="block max-w-[160px] truncate text-body">{getValue<string>()}</span>
      ),
    },
    {
      id: "snapshotDate",
      header: "Snapshot Date",
      enableSorting: false,
      size: 170,
      cell: () => (
        <span className="tabular-nums text-secondary">{formatDateTime(snapshotAt)}</span>
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
      cell: ({ getValue }) => (
        <span className="block max-w-[240px] truncate text-body">{getValue<string>()}</span>
      ),
    },
    {
      id: "locations",
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
      size: 110,
      cell: ({ row }) => {
        const lot = lotNumberFor(row.original.sku);
        return lot ? (
          <span className="tabular-nums text-secondary">{lot}</span>
        ) : (
          <span className="text-faint">—</span>
        );
      },
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
      cell: ({ row }) => (
        <QtyCell value={row.original.allocated} className="text-secondary" />
      ),
    },
    {
      accessorKey: "damaged",
      header: "Damaged",
      size: 90,
      cell: ({ row }) => (
        <QtyCell
          value={row.original.damaged}
          className={row.original.damaged > 0 ? "text-danger" : "text-faint"}
        />
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
  const clients = useClientOptions();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const typed = debouncedSearch.trim();
  const clientId = clients.find((c) => c.name === filters.client)?.id;
  const params = React.useMemo(
    () => ({
      page,
      pageSize,
      search: typed !== "" ? typed : undefined,
      clientId,
    }),
    [page, pageSize, typed, clientId]
  );

  const { rows, total, loading, error, refetch } = useReportRows<InventorySnapshotRow>(
    "/api/reports/inventory-snapshot",
    params
  );

  const columns = React.useMemo(() => buildColumns(snapshotAt), [snapshotAt]);

  const applyFilters = (next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
    setSelection({});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-4">
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Inventory Snapshot" }]}
        title="Inventory Snapshot Report"
        helper="Point-in-time on hand, allocated and damaged quantities by SKU"
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
      <ReportChipRow>
        <ReportChip
          icon={CalendarClock}
          label="Snapshot date"
          value={formatDateTime(snapshotAt)}
          active
        />
        <ReportChip label="Within 1 day" />
        <ReportChip label="All zones" />
        <ReportChip label="All lots" />
      </ReportChipRow>
      <DataGrid<InventorySnapshotRow>
        columns={columns}
        data={rows}
        total={total}
        page={page}
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
        getRowId={(row) => row.productId}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="inventory-snapshot"
        emptyTitle="No inventory in this snapshot"
        emptyDescription="Try clearing the client filter or searching for a different SKU."
        toolbarLeft={
          <>
            <GridSearch value={search} onChange={setSearch} placeholder="Search by SKU" />
            <FilterButton
              filters={[{ key: "client", label: "Client", options: clients.map((c) => c.name) }]}
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
          </>
        )}
      />
    </div>
  );
}
