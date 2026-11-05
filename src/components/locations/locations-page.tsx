"use client";

import * as React from "react";
import { ChevronDown, Plus, Upload } from "lucide-react";
import type { RowSelectionState } from "@tanstack/react-table";
import type {
  LocationListRow,
  ZoneSummaryRow,
} from "@/server/repositories/locations";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { LOCATION_COLUMNS } from "./locations-columns";
import { ZoneSummaryStrip } from "./zone-summary-strip";

interface ListEnvelope<T> {
  success: boolean;
  data?: T[];
  error?: string;
  meta?: { total: number };
}

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 50;

/** Mirrors LOCATION_TYPES from the repository (runtime import would pull in the DB). */
const LOCATION_TYPE_OPTIONS = [
  "Picking",
  "Reserve",
  "Receiving",
  "Shipping",
  "Returns",
  "Damaged",
];

export function LocationsPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [zone, setZone] = React.useState("");
  const [type, setType] = React.useState("");
  const [rows, setRows] = React.useState<LocationListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [zones, setZones] = React.useState<ZoneSummaryRow[]>([]);
  const [zonesLoading, setZonesLoading] = React.useState(true);
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
    if (zone) params.set("zone", zone);
    if (type) params.set("type", type);
    setLoading(true);
    setError(null);
    fetch(`/api/locations?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<ListEnvelope<LocationListRow>>)
      .then((body) => {
        if (!body.success || !body.data) {
          throw new Error(body.error ?? "Failed to load locations.");
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load locations.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, pageSize, debouncedSearch, zone, type, refreshKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    setZonesLoading(true);
    fetch("/api/locations?view=zones", { signal: controller.signal })
      .then((res) => res.json() as Promise<ListEnvelope<ZoneSummaryRow>>)
      .then((body) => {
        if (body.success && body.data) setZones(body.data);
        setZonesLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // The strip simply hides itself when the summary is unavailable.
        setZonesLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const applyFilters = (next: Record<string, string>) => {
    setZone(next.zone ?? "");
    setType(next.type ?? "");
    setPage(1);
    setSelection({});
  };

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const filterOptions = [
    {
      key: "zone",
      label: "Zone",
      options: zones.map((z) => z.zone),
    },
    { key: "type", label: "Type", options: LOCATION_TYPE_OPTIONS },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-4">
      <PageHeader
        breadcrumbs={[{ label: "Settings" }, { label: "Locations" }]}
        title="Locations"
        helper="Zones, aisles, bays and bins across MLT1 — Main Fulfillment"
        actions={
          <>
            <Button variant="secondary">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
              <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            </Button>
            <Button variant="primary">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Location
            </Button>
          </>
        }
      />
      <ZoneSummaryStrip
        zones={zones}
        loading={zonesLoading}
        activeZone={zone}
        onZoneSelect={(next) => {
          setZone(next);
          setPage(1);
          setSelection({});
        }}
      />
      <DataGrid<LocationListRow>
        columns={LOCATION_COLUMNS}
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
        exportName="locations"
        emptyTitle="No locations found"
        emptyDescription="Adjust your search or filters, or create a new location to get started."
        toolbarLeft={
          <>
            <GridSearch value={search} onChange={changeSearch} placeholder="Search by code" />
            <FilterButton
              filters={filterOptions}
              applied={{ zone, type }}
              onApply={applyFilters}
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" disabled={selectedCount === 0}>
              Assign Capacity
              <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              Print Labels
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
