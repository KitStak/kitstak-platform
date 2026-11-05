"use client";

import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, Plus } from "lucide-react";
import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { spreadClampedExpectedDates } from "./expected-dates";
import { HISTORY_COLUMNS, PO_COLUMNS } from "./po-columns";
import { PoGrid } from "./po-grid";
import { PoTabs } from "./po-tabs";
import { VendorsGrid } from "./vendors-grid";

type TabKey = "pos" | "vendors" | "history";

const PO_STATUS_OPTIONS = ["Pending", "Started", "Receiving", "Completed", "Cancelled"];
const SEARCH_DEBOUNCE_MS = 300;
/** API caps pageSize at 200; one capped fetch backs the Vendors tab + tab counts. */
const AGGREGATE_PAGE_SIZE = 200;

interface ListMeta {
  total: number;
  page: number;
  pageSize: number;
}

interface ListEnvelope {
  success: boolean;
  data?: PurchaseOrderListRow[];
  error?: string;
  meta?: ListMeta;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ReceivingPage() {
  const [tab, setTab] = React.useState<TabKey>("pos");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [rows, setRows] = React.useState<PurchaseOrderListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  /* full (capped) PO dataset: feeds the Vendors tab and live tab counts */
  const [allPos, setAllPos] = React.useState<PurchaseOrderListRow[] | null>(null);
  const [allTotal, setAllTotal] = React.useState<number | null>(null);
  const [allError, setAllError] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const clientIdByName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const po of allPos ?? []) map.set(po.clientName, po.clientId);
    return map;
  }, [allPos]);

  const clientOptions = React.useMemo(
    () => [...clientIdByName.keys()].sort((a, b) => a.localeCompare(b)),
    [clientIdByName]
  );

  /* reset paging + selection when the query context changes */
  React.useEffect(() => {
    setPage(1);
    setSelection({});
  }, [debouncedSearch, filters, tab]);

  /*
   * Resolve the client filter to a stable id string. The main fetch effect
   * must NOT depend on `clientIdByName` directly: the map gets a new identity
   * whenever the aggregate fetch lands, which used to retrigger the main
   * fetch and flash the grid back into its skeleton state after every load.
   */
  const activeClientId = React.useMemo(
    () => (tab === "pos" && filters.client ? clientIdByName.get(filters.client) : undefined),
    [tab, filters, clientIdByName]
  );

  /* main grid fetch (PURCHASE ORDERS + RECEIVING HISTORY tabs) */
  React.useEffect(() => {
    if (tab === "vendors") return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const status = tab === "history" ? "Completed" : filters.status;
    if (status) params.set("status", status);
    if (activeClientId) params.set("clientId", activeClientId);
    setLoading(true);
    setError(null);
    fetch(`/api/purchase-orders?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        /* Respread seed-clamped expected dates (see expected-dates.ts). */
        setRows(spreadClampedExpectedDates(body.data));
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        setError(err instanceof Error ? err.message : "Unable to load purchase orders");
        setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, pageSize, debouncedSearch, filters, activeClientId, refreshKey]);

  /* aggregate fetch for vendor grouping + tab counts */
  React.useEffect(() => {
    const controller = new AbortController();
    setAllError(null);
    fetch(`/api/purchase-orders?page=1&pageSize=${AGGREGATE_PAGE_SIZE}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setAllPos(body.data);
        setAllTotal(body.meta?.total ?? body.data.length);
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        setAllError(err instanceof Error ? err.message : "Unable to load vendors");
      });
    return () => controller.abort();
  }, [refreshKey]);

  const vendorCount = React.useMemo(() => {
    if (!allPos) return undefined;
    return new Set(allPos.map((po) => po.vendorName)).size;
  }, [allPos]);

  const completedCount = React.useMemo(() => {
    if (!allPos) return undefined;
    return allPos.filter((po) => po.status === "Completed").length;
  }, [allPos]);

  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleTabChange = React.useCallback((key: string) => {
    setTab(key as TabKey);
    setSearch("");
    setFilters({});
  }, []);

  const searchBox = (
    <GridSearch
      value={search}
      onChange={setSearch}
      /* Short enough to fit the 240px search input without mid-word clipping
         (the long copy rendered as "Search by PO, vendor, referei"). */
      placeholder={tab === "vendors" ? "Search vendors" : "Search PO, vendor, ref #"}
    />
  );

  return (
    /* Bounded to the viewport (minus the 56px top nav) so the grid scrolls
       internally and its pagination footer stays pinned on screen. */
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col pb-4">
      {/*
        Local shim for the global header search pill (app-shell.tsx is a
        read-only shared component): widen it to 280px and forbid wrapping so
        "Search orders, SKUs, locations…" can never break onto two lines
        inside the pill. Same scoped workaround the Clients and Inventory
        Snapshot pages ship; the real fix (plus shortening the copy to
        "Search orders, SKUs…") belongs in the shared TopNav — see the shared
        component request accompanying this change.
      */}
      <style>{`
        header button:has(> kbd) {
          width: 280px !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
      <PageHeader
        breadcrumbs={[
          { label: "PO & Receiving", href: "/receiving" },
          { label: "Purchase Orders" },
        ]}
        title="Purchase Orders"
        actions={
          <>
            <Button variant="secondary" size="md">
              Import
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Purchase Order
            </Button>
          </>
        }
      />
      {/* Helper copy sits directly under the H1 (left-aligned, muted) instead
          of floating between the title and the action buttons. Copy is kept
          short and the measure wide enough (72ch) that it renders as a single
          line — the longer phrasing used to orphan "to your warehouse." onto
          a second line despite ample free width. */}
      <p className="mx-6 mt-1 max-w-[72ch] text-[13px] leading-5 text-secondary">
        A purchase order specifies the products a vendor will deliver to your warehouse.
      </p>
      <PoTabs
        className="mt-3"
        active={tab}
        onChange={handleTabChange}
        tabs={[
          { key: "pos", label: "Purchase Orders", count: allTotal ?? undefined },
          { key: "vendors", label: "Vendors", count: vendorCount },
          { key: "history", label: "Receiving History", count: completedCount },
        ]}
      />

      {tab === "vendors" ? (
        <VendorsGrid
          pos={allPos}
          loading={allPos === null && !allError}
          error={allError}
          onRetry={refresh}
          search={search}
          toolbarLeft={searchBox}
        />
      ) : (
        <PoGrid<PurchaseOrderListRow>
          columns={tab === "history" ? HISTORY_COLUMNS : PO_COLUMNS}
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
          /* API returns rows ordered by createdAt desc; surface that as the
             active sort so the "Created" header shows its direction chevron. */
          initialSorting={[{ id: "createdAt", desc: true }]}
          selection={selection}
          onSelectionChange={setSelection}
          exportName={tab === "history" ? "receiving-history" : "purchase-orders"}
          emptyTitle={tab === "history" ? "No receipts yet" : "No purchase orders found"}
          emptyDescription={
            tab === "history"
              ? "Completed purchase orders appear here once receiving is finished."
              : "Adjust your filters or create a purchase order to get started."
          }
          toolbarLeft={
            <>
              {searchBox}
              {tab === "pos" ? (
                <FilterButton
                  filters={[
                    { key: "status", label: "Status", options: PO_STATUS_OPTIONS },
                    { key: "client", label: "Client", options: clientOptions },
                  ]}
                  applied={filters}
                  onApply={setFilters}
                />
              ) : null}
            </>
          }
          toolbarRight={
            tab === "pos"
              ? (selectedCount) => (
                  <>
                    <Button
                      variant="secondary"
                      size="md"
                      disabled={selectedCount === 0}
                      className={
                        selectedCount > 0 ? "border-primary/40 text-primary" : undefined
                      }
                    >
                      Receive PO
                    </Button>
                    <Button variant="secondary" size="md" disabled={selectedCount === 0}>
                      Cancel Order
                    </Button>
                    <Button variant="secondary" size="md" disabled={selectedCount === 0}>
                      Delete
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}
    </div>
  );
}
