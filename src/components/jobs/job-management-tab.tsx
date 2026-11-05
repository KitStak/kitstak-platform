"use client";

import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { Flag, UserPlus, XCircle } from "lucide-react";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton } from "@/components/grid/grid-toolbar";
import { Button } from "@/components/ui/button";
import { JOB_COLUMNS } from "./job-grid-columns";
import {
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
  JobsGridSearch,
  useGridOverflowFade,
  type JobListRow,
  type ListEnvelope,
} from "./jobs-shared";

const SEARCH_DEBOUNCE_MS = 300;

export function JobManagementTab() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [rows, setRows] = React.useState<JobListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filters.status) params.set("status", filters.status);
    if (filters.jobType) params.set("jobType", filters.jobType);

    fetch(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope<JobListRow>;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load jobs");
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, pageSize, debouncedSearch, filters, refreshKey]);

  const applyFilters = React.useCallback((next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
  }, []);

  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const overflowFade = useGridOverflowFade(rootRef);

  return (
    /* Explicit viewport-bound height: the app shell is min-h-screen (not
       height-bound), so without this the grid grows past the fold and the
       footer bar is never visible. 173px = top nav + page header + tabs. */
    <div
      ref={rootRef}
      className="jobs-rows-zebra relative flex h-[calc(100vh-173px)] min-h-[420px] flex-col pb-5"
    >
      {/*
        Consistent zebra striping for the jobs grid, scoped to this tab (the
        shared DataGrid is read-only). A single hover-tinted row in a capture
        read as a one-off bug; with even rows carrying a faint, token-derived
        tint the row backgrounds are uniform and intentional. :not(:hover)
        keeps the shared hover state (full --surface-sunken) visibly stronger,
        and the bg-primary-soft guard leaves selected-row highlighting alone.
        color-mix over tokens tracks dark mode automatically.
      */}
      <style>{`
        .jobs-rows-zebra tbody tr:nth-child(even):not(:hover):not([class*="bg-primary-soft"]) {
          background-color: color-mix(in srgb, var(--surface-sunken) 55%, var(--surface));
        }
      `}</style>
      <DataGrid<JobListRow>
        columns={JOB_COLUMNS}
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
        onRetry={refresh}
        onRefresh={refresh}
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="jobs"
        emptyTitle="No jobs found"
        emptyDescription="Adjust your search or filters, or create a job to start allocating work."
        toolbarLeft={
          <>
            <JobsGridSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by job code or wave"
            />
            <FilterButton
              filters={[
                { key: "status", label: "Status", options: [...JOB_STATUS_OPTIONS] },
                { key: "jobType", label: "Job Type", options: [...JOB_TYPE_OPTIONS] },
              ]}
              applied={filters}
              onApply={applyFilters}
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Update Priority
            </Button>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Assign Users
            </Button>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </Button>
          </>
        )}
      />
      {overflowFade ? (
        /* Right-edge fade signalling more columns off-screen; sits just
           inside the grid card's border (card is mx-6 + 1px border). */
        <div
          aria-hidden
          className="pointer-events-none absolute right-[25px] z-20 w-6 rounded-tr-lg bg-gradient-to-r from-transparent to-surface"
          style={{ top: overflowFade.top, height: overflowFade.height }}
        />
      ) : null}
    </div>
  );
}
