"use client";

import * as React from "react";
import { ChevronDown, Plus, Upload } from "lucide-react";
import type { RowSelectionState } from "@tanstack/react-table";
import type { ClientListRow } from "@/server/repositories/clients";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { CLIENT_COLUMNS } from "./clients-columns";

interface ListEnvelope<T> {
  success: boolean;
  data?: T[];
  error?: string;
  meta?: { total: number };
}

type StatusTab = "all" | "Active" | "Inactive";

interface TabCounts {
  all?: number;
  active?: number;
  inactive?: number;
}

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 50;

const STATUS_FILTERS = [{ key: "status", label: "Status", options: ["Active", "Inactive"] }];

export function ClientsPage() {
  const [tab, setTab] = React.useState<StatusTab>("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [rows, setRows] = React.useState<ClientListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [counts, setCounts] = React.useState<TabCounts>({});
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (tab !== "all") params.set("status", tab);
    setLoading(true);
    setError(null);
    fetch(`/api/clients?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<ListEnvelope<ClientListRow>>)
      .then((body) => {
        if (!body.success || !body.data) {
          throw new Error(body.error ?? "Failed to load clients.");
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load clients.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, pageSize, debouncedSearch, tab, refreshKey]);

  // Cheap tab counts: two pageSize=1 queries read only meta.total.
  React.useEffect(() => {
    const controller = new AbortController();
    async function loadCounts(): Promise<void> {
      try {
        const [allRes, activeRes] = await Promise.all([
          fetch("/api/clients?page=1&pageSize=1", { signal: controller.signal }),
          fetch("/api/clients?page=1&pageSize=1&status=Active", {
            signal: controller.signal,
          }),
        ]);
        const all = (await allRes.json()) as ListEnvelope<ClientListRow>;
        const active = (await activeRes.json()) as ListEnvelope<ClientListRow>;
        const allTotal = all.meta?.total;
        const activeTotal = active.meta?.total;
        if (typeof allTotal === "number" && typeof activeTotal === "number") {
          setCounts({
            all: allTotal,
            active: activeTotal,
            inactive: allTotal - activeTotal,
          });
        }
      } catch {
        // Counts are decorative; the grid surfaces real fetch errors.
      }
    }
    void loadCounts();
    return () => controller.abort();
  }, [refreshKey]);

  const changeTab = (next: StatusTab) => {
    setTab(next);
    setPage(1);
    setSelection({});
  };

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const appliedFilters: Record<string, string> =
    tab === "all" ? {} : { status: tab };

  return (
    // No flex-1/min-h-0 stretch here on purpose: the DataGrid card hugs its
    // rows, so the density/pagination/export footer sits directly under the
    // last row instead of pinning to the viewport bottom with a dead white
    // zone inside the card. At 8 demo rows that gap was ~230px of blank card.
    <div className="ks-clients flex flex-col pb-4">
      {/*
        Scoped override for DataGrid's footer page-size <select> (shared
        component, read-only): design-system sizing plus a custom lucide
        chevron-down so it stops reading as a default browser control.
      */}
      <style>{`
        .ks-clients select[aria-label="Rows per page"] {
          height: 32px;
          appearance: none;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0 28px 0 10px;
          font-size: 13px;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
          background-repeat: no-repeat;
          background-position: right 8px center;
          background-size: 14px 14px;
        }
        /*
          Local shim for the global header search pill (app-shell.tsx is a
          read-only shared component): widen it to 280px and forbid wrapping
          so "Search orders, SKUs, locations…" can never break onto two
          lines. The pill is the only header button with an embedded <kbd>
          shortcut hint. The real fix belongs in TopNav — see the shared
          component request accompanying this change.
        */
        header button:has(> kbd) {
          width: 280px !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /*
          UnderlineTabs (read-only shared component) paints a faint grey 2px
          bar under unselected tabs; only the selected tab should draw the
          indigo indicator. Scoped kill-switch pinning inactive tabs to a
          transparent border-bottom until the shared component drops the
          visible inactive bar — see the shared component request.
        */
        .ks-clients [role="tablist"] [role="tab"][aria-selected="false"] {
          border-bottom-color: transparent !important;
        }
      `}</style>
      {/*
        Breadcrumb parent must match the top-nav section that owns /clients.
        NAV_MENUS (read-only) files Clients under Inventory > Facility, so the
        active white pill lands on "Inventory" — the stale "Settings" crumb
        here was the mismatch. If Clients should instead live under Settings,
        nav-config.ts has to move, which is a shared-component change.
      */}
      <PageHeader
        breadcrumbs={[{ label: "Inventory" }, { label: "Clients" }]}
        title="Clients"
        actions={
          <>
            <Button variant="secondary">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
              <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            </Button>
            <Button variant="primary">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Client
            </Button>
          </>
        }
      />
      <p className="mt-1 px-6 text-[13px] text-secondary">
        3PL depositors fulfilled from this facility
      </p>
      <UnderlineTabs
        className="mt-2"
        active={tab}
        onChange={(key) => changeTab(key as StatusTab)}
        tabs={[
          { key: "all", label: "All Clients", count: counts.all },
          { key: "Active", label: "Active", count: counts.active },
          { key: "Inactive", label: "Inactive", count: counts.inactive },
        ]}
      />
      <DataGrid<ClientListRow>
        columns={CLIENT_COLUMNS}
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
        onRetry={() => setRefreshKey((k) => k + 1)}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="clients"
        emptyTitle="No clients found"
        emptyDescription="Adjust your search or filters, or create a new client to get started."
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={changeSearch}
              placeholder="Search by name or code"
            />
            <FilterButton
              filters={STATUS_FILTERS}
              applied={appliedFilters}
              onApply={(next) =>
                changeTab(
                  next.status === "Active" || next.status === "Inactive"
                    ? next.status
                    : "all"
                )
              }
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" disabled={selectedCount === 0}>
              Tag
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              Assign Plan
              <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              Deactivate
            </Button>
          </>
        )}
      />
    </div>
  );
}
