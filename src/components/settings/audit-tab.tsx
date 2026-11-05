"use client";

import * as React from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { formatDateTime } from "@/lib/utils";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { useDebounced, useListQuery } from "./use-list-query";
import type { AuditRow } from "./types";

const ENTITY_OPTIONS = [
  "user",
  "shipment_order",
  "purchase_order",
  "inventory",
  "job",
  "warehouse",
] as const;

const ENTITY_LABELS: Record<string, string> = {
  user: "User",
  shipment_order: "Shipment Order",
  purchase_order: "Purchase Order",
  inventory: "Inventory",
  job: "Job",
  warehouse: "Warehouse",
};

const COLUMNS: ColumnDef<AuditRow, unknown>[] = [
  {
    accessorKey: "at",
    header: "Timestamp",
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">
        {formatDateTime(row.original.at)}
      </span>
    ),
  },
  {
    accessorKey: "userName",
    header: "User",
    cell: ({ row }) =>
      row.original.userName ? (
        <span className="font-medium text-body">{row.original.userName}</span>
      ) : (
        <span className="text-faint">System</span>
      ),
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => (
      <span className="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-secondary">
        {row.original.action}
      </span>
    ),
  },
  {
    accessorKey: "entity",
    header: "Entity",
    cell: ({ row }) => (
      <span className="text-secondary">
        {ENTITY_LABELS[row.original.entity] ?? row.original.entity}
      </span>
    ),
  },
  {
    accessorKey: "entityId",
    header: "Entity ID",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-secondary">
        {row.original.entityId}
      </span>
    ),
  },
  {
    accessorKey: "detail",
    header: "Detail",
    cell: ({ row }) => (
      <span
        className="block max-w-[340px] truncate text-secondary"
        title={row.original.detail ?? undefined}
      >
        {row.original.detail ?? "—"}
      </span>
    ),
  },
];

export function AuditTab() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const debouncedSearch = useDebounced(search, 300);

  const entityKey = React.useMemo(() => {
    const label = filters.entity ?? "";
    const match = ENTITY_OPTIONS.find((key) => ENTITY_LABELS[key] === label);
    return match ?? "";
  }, [filters]);

  const query = React.useMemo(
    () => ({
      page: String(page),
      pageSize: String(pageSize),
      search: debouncedSearch,
      entity: entityKey,
    }),
    [page, pageSize, debouncedSearch, entityKey]
  );

  const { rows, total, loading, error, refetch } = useListQuery<AuditRow>(
    "/api/audit",
    query
  );

  return (
    <DataGrid<AuditRow>
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
      exportName="kitstak-audit-log"
      emptyTitle="No audit events"
      emptyDescription="Events appear here as users sign in and change orders, inventory or settings."
      toolbarLeft={
        <>
          <GridSearch
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search action or entity ID"
          />
          <FilterButton
            filters={[
              {
                key: "entity",
                label: "Entity",
                options: ENTITY_OPTIONS.map((key) => ENTITY_LABELS[key] ?? key),
              },
            ]}
            applied={filters}
            onApply={(next) => {
              setFilters(next);
              setPage(1);
            }}
          />
        </>
      }
    />
  );
}
