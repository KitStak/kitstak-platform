"use client";

import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, Plus } from "lucide-react";
import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { HISTORY_COLUMNS, PO_COLUMNS } from "./po-columns";
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
    if (tab === "pos" && filters.client) {
      const clientId = clientIdByName.get(filters.client);
      if (clientId) params.set("clientId", clientId);
    }
    setLoading(true);
    setError(null);
    fetch(`/api/purchase-orders?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        setError(err instanceof Error ? err.message : "Unable to load purchase orders");
        setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, pageSize, debouncedSearch, filters, clientIdByName, refreshKey]);

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
      placeholder={
        tab === "vendors" ? "Search vendors" : "Search by PO, vendor, reference"
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "PO & Receiving", href: "/receiving" },
          { label: "Purchase Orders" },
        ]}
        title="Purchase Orders"
        helper="A purchase order is a document issued to a vendor specifying the products to be delivered to your warehouse."
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
      <UnderlineTabs
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
        <DataGrid<PurchaseOrderListRow>
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
