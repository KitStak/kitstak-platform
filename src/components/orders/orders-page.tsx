"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch, type FilterOption } from "@/components/grid/grid-toolbar";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { buildOrderColumns } from "./orders-columns";
import { OrdersBulkActions } from "./orders-bulk-actions";
import {
  CHANNEL_OPTIONS,
  ORDER_TABS,
  TAB_EMPTY_STATES,
  TAB_STATUS_OPTIONS,
  type ClientOption,
  type ClientsApiResponse,
  type OrderRow,
  type OrdersApiResponse,
  type OrdersTab,
} from "./orders-types";

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 50;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function OrdersPage() {
  const router = useRouter();

  const [tab, setTab] = React.useState<OrdersTab>("backlog");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});

  const [rows, setRows] = React.useState<OrderRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [tabCounts, setTabCounts] = React.useState<Partial<Record<OrdersTab, number>>>({});
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const columns = React.useMemo(() => buildOrderColumns(), []);

  /* ---- debounce search ---- */
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  /* ---- clients for the Client filter ---- */
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/clients?page=1&pageSize=100", { signal: controller.signal })
      .then((res) => res.json() as Promise<ClientsApiResponse>)
      .then((body) => {
        if (body.success && body.data) {
          setClients(
            body.data
              .map(({ id, name }) => ({ id, name }))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      })
      .catch((err: unknown) => {
        // Filter options are non-critical; grid still works without them.
        if (!isAbortError(err)) setClients([]);
      });
    return () => controller.abort();
  }, []);

  /* ---- live tab counts (pageSize=1 → meta.total only) ---- */
  React.useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const entries = await Promise.all(
        ORDER_TABS.map(async ({ key }) => {
          const res = await fetch(`/api/orders?page=1&pageSize=1&tab=${key}`, {
            signal: controller.signal,
          });
          const body = (await res.json()) as OrdersApiResponse;
          return [key, body.meta?.total ?? 0] as const;
        })
      );
      setTabCounts(Object.fromEntries(entries) as Record<OrdersTab, number>);
    };
    load().catch((err: unknown) => {
      // Counts are decorative; swallow non-abort failures silently.
      if (!isAbortError(err)) setTabCounts({});
    });
    return () => controller.abort();
  }, [refreshKey]);

  /* ---- main list fetch ---- */
  const clientFilterId = React.useMemo(() => {
    if (!filters.client) return "";
    return clients.find((c) => c.name === filters.client)?.id ?? "";
  }, [filters.client, clients]);

  const statusFilter = filters.status ?? "";
  const channelFilter = filters.channel ?? "";

  React.useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      tab,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    if (channelFilter) params.set("channel", channelFilter);
    if (clientFilterId) params.set("clientId", clientFilterId);

    setLoading(true);
    setError(null);
    fetch(`/api/orders?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<OrdersApiResponse>)
      .then((body) => {
        if (!body.success || !body.data) {
          throw new Error(body.error ?? "Failed to load shipment orders.");
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? 0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load shipment orders.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, pageSize, debouncedSearch, statusFilter, channelFilter, clientFilterId, refreshKey]);

  /* ---- handlers ---- */
  const handleTabChange = (key: string): void => {
    const next = key as OrdersTab;
    setTab(next);
    setPage(1);
    setSelection({});
    setFilters((prev) =>
      prev.status && !TAB_STATUS_OPTIONS[next].includes(prev.status)
        ? { ...prev, status: "" }
        : prev
    );
  };

  const handleFiltersChange = (next: Record<string, string>): void => {
    setFilters(next);
    setPage(1);
  };

  const handleRefresh = (): void => setRefreshKey((k) => k + 1);

  const filterOptions: FilterOption[] = React.useMemo(
    () => [
      { key: "status", label: "Status", options: [...TAB_STATUS_OPTIONS[tab]] },
      { key: "channel", label: "Channel", options: [...CHANNEL_OPTIONS] },
      { key: "client", label: "Client", options: clients.map((c) => c.name) },
    ],
    [tab, clients]
  );

  const emptyState = TAB_EMPTY_STATES[tab];

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-4">
      <PageHeader
        breadcrumbs={[{ label: "Orders" }, { label: "Shipment Orders" }]}
        title="Shipment Orders"
        helper="Manage, pick, pack and ship outbound orders across every channel."
        actions={
          <>
            <Dropdown
              align="end"
              trigger={(open) => (
                <Button
                  variant="secondary"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={cn(open && "border-primary text-primary")}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Import
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    aria-hidden
                  />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <DropdownItem onClick={close}>Import orders from CSV</DropdownItem>
                  <DropdownItem onClick={close}>Download import template</DropdownItem>
                </>
              )}
            </Dropdown>
            <Button variant="primary">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Shipment Order
            </Button>
          </>
        }
      />

      <UnderlineTabs
        className="mt-3"
        tabs={ORDER_TABS.map(({ key, label }) => ({ key, label, count: tabCounts[key] }))}
        active={tab}
        onChange={handleTabChange}
      />

      <DataGrid<OrderRow>
        columns={columns}
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
        onRetry={handleRefresh}
        emptyTitle={emptyState.title}
        emptyDescription={emptyState.description}
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        onRowClick={(row) => router.push(`/orders/${row.id}`)}
        exportName="shipment-orders"
        onRefresh={handleRefresh}
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by code or customer"
            />
            <FilterButton
              filters={filterOptions}
              applied={filters}
              onApply={handleFiltersChange}
            />
          </>
        }
        toolbarRight={(selectedCount) => (
          <OrdersBulkActions selectedCount={selectedCount} />
        )}
      />
    </div>
  );
}
