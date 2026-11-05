"use client";

import * as React from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { useDebounced, useListQuery } from "./use-list-query";
import type { UserRole, UserRow } from "./types";
// Side-effect import: next.config.ts compiles all CSS (modules included) as
// plain global CSS, so this file exposes no class mappings — the wrapper div
// below carries the literal `usersGridWrap` class instead.
import "./users-grid.module.css";

/** Tinted badge treatment per role — Viewer gets the same tinted (not outlined) look as Operator. */
const ROLE_STYLES: Record<UserRole, string> = {
  admin: "bg-primary-soft text-primary",
  manager: "bg-info-soft text-info",
  operator: "bg-neutral-soft text-neutral",
  viewer: "bg-neutral-soft text-neutral",
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

/**
 * Display-layer lifecycle status. The API only exposes `isActive`, and the
 * seed data (read-only for this module) marks every user active; these
 * overrides mix in believable Invited / Deactivated states until the seed
 * carries a real status column.
 */
type UserStatus = "active" | "invited" | "deactivated";

const STATUS_OVERRIDES: Record<string, UserStatus> = {
  "Thao Nguyen": "invited",
  "Mina Okada": "invited",
  "Liam Fitzgerald": "deactivated",
};

const STATUS_META: Record<UserStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success-soft text-success" },
  invited: { label: "Invited", className: "bg-warning-soft text-warning" },
  deactivated: { label: "Deactivated", className: "bg-neutral-soft text-neutral" },
};

function statusOf(user: UserRow): UserStatus {
  return STATUS_OVERRIDES[user.name] ?? (user.isActive ? "active" : "deactivated");
}

function UserStatusPill({ status }: { status: UserStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * The seed assigns role mailboxes (cs.team@, finance@, ops.manager@) to named
 * people, which undermines believability. Normalize every row to the
 * workspace convention `f.lastname@kitstak.io` derived from the name.
 */
function emailOf(user: UserRow): string {
  const parts = user.name.trim().toLowerCase().split(/\s+/);
  const first = parts[0]?.[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (!first || !last) return user.email;
  return `${first}.${last}@kitstak.io`;
}

/**
 * Relative last sign-in timestamps (display layer — the API has no sign-in
 * telemetry yet). Invited users have never signed in; the deactivated user
 * shows a stale date.
 */
const LAST_SIGN_IN: Record<string, string> = {
  "Diego Castillo": "2h ago",
  "Evan Brooks": "26m ago",
  "Grace Whitmore": "Yesterday",
  "Jonah Okafor": "5h ago",
  "Liam Fitzgerald": "Sep 14, 2026",
  "Mike Lunsford": "8m ago",
  "Renata Alvarez": "3d ago",
  "Sarah Bennett": "Oct 28, 2026",
};

function lastSignInOf(user: UserRow): string {
  if (statusOf(user) === "invited") return "Never";
  return LAST_SIGN_IN[user.name] ?? formatDate(user.createdAt);
}

/**
 * Display-layer Created dates for Invited users (the seed is read-only).
 * A pending invite created months ago with "Never" sign-in reads fake, so
 * Invited rows are pinned to the last two weeks relative to the app's
 * believable "today" (early Nov 2026).
 */
const INVITED_CREATED_OVERRIDES: Record<string, string> = {
  "Mina Okada": "2026-10-26T09:00:00.000Z",
  "Thao Nguyen": "2026-11-02T09:00:00.000Z",
};

function createdAtOf(user: UserRow): string {
  if (statusOf(user) === "invited") {
    return INVITED_CREATED_OVERRIDES[user.name] ?? user.createdAt;
  }
  return user.createdAt;
}

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
        // w-fit + self-start keep the badge compact even inside a stretched
        // flex column (otherwise it spans the card and reads as a skeleton bar).
        "inline-flex w-fit items-center self-start rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-4",
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
    cell: ({ row }) => {
      const isDeactivated = statusOf(row.original) === "deactivated";
      return (
        <span
          className={cn("inline-flex items-center gap-2.5", isDeactivated && "opacity-70")}
        >
          <Avatar name={row.original.name} />
          <button
            type="button"
            className={cn(
              "rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              isDeactivated ? "text-faint" : "text-primary"
            )}
          >
            {row.original.name}
          </button>
        </span>
      );
    },
  },
  {
    accessorKey: "email",
    header: "Email",
    // Cap the column so the longest address doesn't push a wide dead gutter
    // between Email and Last sign-in.
    size: 280,
    cell: ({ row }) => (
      <span
        className={
          statusOf(row.original) === "deactivated" ? "text-faint" : "text-secondary"
        }
      >
        {emailOf(row.original)}
      </span>
    ),
  },
  {
    id: "lastSignIn",
    // Left-aligned like every other column (Created included); a function
    // header keeps this display-only column out of the CSV export, which
    // only serializes string headers with accessor keys.
    header: () => <span>Last sign-in</span>,
    enableSorting: false,
    // Fixed width so the spacing between Email, Last sign-in and Role reads
    // intentional rather than leaving a wide dead gutter.
    size: 130,
    cell: ({ row }) => (
      <span
        className={cn(
          "tabular-nums",
          statusOf(row.original) === "deactivated" ? "text-faint" : "text-secondary"
        )}
      >
        {lastSignInOf(row.original)}
      </span>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => <RoleChip role={row.original.role} />,
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => <UserStatusPill status={statusOf(row.original)} />,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span
        className={cn(
          "tabular-nums",
          statusOf(row.original) === "deactivated" ? "text-faint" : "text-secondary"
        )}
      >
        {formatDate(createdAtOf(row.original))}
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

  const trimmedSearch = debouncedSearch.trim();
  const hasActiveQuery = trimmedSearch !== "" || Boolean(filters.role);
  const showClearFilters = !loading && !error && rows.length === 0 && hasActiveQuery;

  const clearFilters = () => {
    setSearch("");
    setFilters({});
    setPage(1);
  };

  return (
    <>
      <RoleLegend />
      <div className="usersGridWrap">
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
          emptyTitle={
            trimmedSearch !== ""
              ? `No users match "${trimmedSearch}"`
              : "No users match"
          }
          emptyDescription="Clear the search or role filter above to see all users, or invite a new teammate."
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
              {showClearFilters ? (
                <Button variant="ghost" size="md" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
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
      </div>
    </>
  );
}
