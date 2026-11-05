"use client";

import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { Flag, UserPlus, XCircle } from "lucide-react";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { Button } from "@/components/ui/button";
import { JOB_COLUMNS } from "./job-grid-columns";
import {
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-5">
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
            <GridSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by job code, wave or rule"
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
    </div>
  );
}
