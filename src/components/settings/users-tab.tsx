"use client";

import * as React from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { useDebounced, useListQuery } from "./use-list-query";
import type { UserRole, UserRow } from "./types";

const ROLE_STYLES: Record<UserRole, string> = {
  admin: "bg-primary-soft text-primary",
  manager: "bg-info-soft text-info",
  operator: "bg-neutral-soft text-neutral",
  viewer: "border border-border bg-surface-sunken text-faint",
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
  viewer: "Viewer",
};

const ROLE_SUMMARIES: Record<UserRole, string> = {
  admin: "Full access — settings, users, billing and every warehouse operation.",
  manager: "Runs daily ops — orders, receiving, inventory and job assignment.",
  operator: "Executes floor work — picking, packing, counting and receiving.",
  viewer: "Read-only access to dashboards, orders and reports.",
};

const AVATAR_TILES = [
  "bg-primary-soft text-primary",
  "bg-info-soft text-info",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-neutral-soft text-neutral",
] as const;

function RoleChip({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        ROLE_STYLES[role]
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

function Avatar({ name }: { name: string }) {
  const hue = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        AVATAR_TILES[hue % AVATAR_TILES.length]
      )}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

function RoleLegend() {
  return (
    <Card className="mx-6 mt-4">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        {(Object.keys(ROLE_SUMMARIES) as UserRole[]).map((role) => (
          <div key={role} className="flex flex-col gap-1.5 px-5 py-3.5">
            <RoleChip role={role} />
            <p className="text-[12px] leading-4.5 text-secondary">
              {ROLE_SUMMARIES[role]}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const COLUMNS: ColumnDef<UserRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2.5">
        <Avatar name={row.original.name} />
        <button
          type="button"
          className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.original.name}
        </button>
      </span>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => <span className="text-secondary">{row.original.email}</span>,
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => <RoleChip role={row.original.role} />,
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (
      <StatusPill status={row.original.isActive ? "Active" : "Inactive"} />
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
];

export function UsersTab() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const debouncedSearch = useDebounced(search, 300);

  const query = React.useMemo(
    () => ({
      page: String(page),
      pageSize: String(pageSize),
      search: debouncedSearch,
      role: (filters.role ?? "").toLowerCase(),
    }),
    [page, pageSize, debouncedSearch, filters]
  );

  const { rows, total, loading, error, refetch } = useListQuery<UserRow>(
    "/api/users",
    query
  );

  return (
    <>
      <RoleLegend />
      <DataGrid<UserRow>
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
        exportName="kitstak-users"
        emptyTitle="No users match"
        emptyDescription="Adjust your search or role filter, or invite a new teammate."
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search by name or email"
            />
            <FilterButton
              filters={[
                {
                  key: "role",
                  label: "Role",
                  options: ["Admin", "Manager", "Operator", "Viewer"],
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
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              Reset Password
            </Button>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              Deactivate
            </Button>
          </>
        )}
      />
    </>
  );
}
