"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { CalendarClock, FileDown, Play, Printer } from "lucide-react";
import type { TransactionRow } from "@/server/repositories/reports";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { ReportChip, ReportChipRow } from "./report-chips";
import { WAREHOUSE_NAME, operatorFor } from "./report-format";
import { useClientOptions, useDebouncedValue, useReportRows } from "./use-report-data";

/** Soft-bg pill styles per transaction type (Shipment green / Receipt cyan / Adjustment gray). */
const TYPE_PILL: Record<string, string> = {
  Shipment: "bg-success-soft text-success",
  Receipt: "bg-info-soft text-info",
  Adjustment: "bg-neutral-soft text-neutral",
};

function referenceHref(row: TransactionRow): string {
  return row.type === "Shipment"
    ? `/orders/${row.id.replace("txn-ship-", "")}`
    : `/receiving/${row.id.replace("txn-recv-", "")}`;
}

const COLUMNS: ColumnDef<TransactionRow, unknown>[] = [
  {
    accessorKey: "date",
    header: "Date",
    size: 170,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-secondary">{formatDateTime(getValue<string>())}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    size: 110,
    cell: ({ getValue }) => {
      const type = getValue<string>();
      return (
        <StatusPill
          status={type}
          className={TYPE_PILL[type] ?? "bg-neutral-soft text-neutral"}
        />
      );
    },
  },
  {
    accessorKey: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <Link
        href={referenceHref(row.original)}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-primary hover:underline"
      >
        {row.original.reference}
      </Link>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ getValue }) => (
      <span className="block max-w-[170px] truncate text-body">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "detail",
    header: "Detail",
    cell: ({ getValue }) => (
      <span className="block max-w-[240px] truncate text-secondary">{getValue<string>()}</span>
    ),
  },
  {
    id: "warehouse",
    header: "Warehouse",
    enableSorting: false,
    size: 180,
    cell: () => <span className="text-secondary">{WAREHOUSE_NAME}</span>,
  },
  {
    accessorKey: "quantity",
    header: "Qty",
    size: 90,
    cell: ({ row }) => {
      const isReceipt = row.original.type === "Receipt";
      return (
        <span
          className={cn(
            "block text-right font-medium tabular-nums",
            isReceipt ? "text-success" : "text-body"
          )}
        >
          {isReceipt ? "+" : "−"}
          {formatNumber(row.original.quantity)}
        </span>
      );
    },
  },
  {
    id: "user",
    header: "User",
    enableSorting: false,
    size: 110,
    cell: ({ row }) => (
      <span className="text-secondary">{operatorFor(row.original.reference)}</span>
    ),
  },
];

export function TransactionHistoryPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});

  const debouncedSearch = useDebouncedValue(search);
  const clients = useClientOptions();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // The endpoint has a single `search` needle (reference / client / detail), so the
  // client chip rides the same param whenever the search box is empty; a typed
  // search takes precedence.
  const typed = debouncedSearch.trim();
  const clientFilter = filters.client ?? "";
  const params = React.useMemo(
    () => ({
      page,
      pageSize,
      search: typed !== "" ? typed : clientFilter !== "" ? clientFilter : undefined,
      type: filters.type !== "" ? filters.type : undefined,
    }),
    [page, pageSize, typed, clientFilter, filters.type]
  );

  const { rows, total, loading, error, refetch } = useReportRows<TransactionRow>(
    "/api/reports/transaction-history",
    params
  );

  const applyFilters = (next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
    setSelection({});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-4">
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Transaction History" }]}
        title="Transaction History Report"
        helper="Inbound receipts and outbound shipments with operator attribution"
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
        <ReportChip icon={CalendarClock} label="Date range" value="Last 30 days" active />
        <ReportChip label="Today" />
        <ReportChip label="Last 7 days" />
        <ReportChip label="Last 90 days" />
      </ReportChipRow>
      <DataGrid<TransactionRow>
        columns={COLUMNS}
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
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="transaction-history"
        emptyTitle="No transactions found"
        emptyDescription="Try widening the type filter or searching a different reference."
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by reference"
            />
            <FilterButton
              filters={[
                { key: "type", label: "Type", options: ["Shipment", "Receipt"] },
                { key: "client", label: "Client", options: clients.map((c) => c.name) },
              ]}
              applied={filters}
              onApply={applyFilters}
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              Export Selected
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print
            </Button>
          </>
        )}
      />
    </div>
  );
}
