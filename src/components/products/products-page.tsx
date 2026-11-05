"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, FileSpreadsheet, FileUp, Plus, Tags, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch, type FilterOption } from "@/components/grid/grid-toolbar";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { orderForBrowsing, synthesizeListings } from "./derive";
import { listingColumns } from "./listing-columns";
import { productColumns } from "./product-columns";
import type { ApiEnvelope, ClientOption, ListingRow, ProductRow } from "./types";

const SEARCH_DEBOUNCE_MS = 300;
const LISTINGS_FETCH_SIZE = 200;
const CATEGORY_OPTIONS = ["Apparel", "Coffee", "Electronics"];
const STATUS_OPTIONS = ["Active", "Inactive"];

type ProductsTab = "products" | "listings";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function BulkImportMenu() {
  return (
    <Dropdown
      align="end"
      trigger={(open) => (
        <Button variant="secondary" size="md" aria-expanded={open}>
          <FileUp className="h-3.5 w-3.5" aria-hidden />
          Bulk Import/Update
          <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem onClick={close}>
            <FileUp className="h-3.5 w-3.5" aria-hidden /> Import products (CSV)
          </DropdownItem>
          <DropdownItem onClick={close}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Update prices &amp; barcodes
          </DropdownItem>
          <DropdownItem onClick={close}>
            <Tags className="h-3.5 w-3.5" aria-hidden /> Update channel listings
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem onClick={close}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Download template
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

export function ProductsPage() {
  const router = useRouter();
  const [tab, setTab] = React.useState<ProductsTab>("products");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [rows, setRows] = React.useState<ProductRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [refreshTick, setRefreshTick] = React.useState(0);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const clientId = clients.find((c) => c.name === filters.client)?.id;

  /* clients for the filter dropdown (names → ids) */
  React.useEffect(() => {
    const controller = new AbortController();
    async function loadClients() {
      try {
        const res = await fetch("/api/clients?page=1&pageSize=200", {
          signal: controller.signal,
        });
        const json = (await res.json()) as ApiEnvelope<ClientOption[]>;
        if (res.ok && json.success && json.data) {
          setClients(json.data.map((c) => ({ id: c.id, name: c.name })));
        }
      } catch {
        /* filter options are a nicety — the grid still works without them */
      }
    }
    void loadClients();
    return () => controller.abort();
  }, []);

  /* product rows (listings are synthesized from the full product set) */
  React.useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(tab === "products" ? page : 1),
          pageSize: String(tab === "products" ? pageSize : LISTINGS_FETCH_SIZE),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (clientId) params.set("clientId", clientId);
        if (filters.category) params.set("category", filters.category);
        if (filters.status) params.set("status", filters.status);
        const res = await fetch(`/api/products?${params.toString()}`, {
          signal: controller.signal,
        });
        const json = (await res.json()) as ApiEnvelope<ProductRow[]>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? "Failed to load products");
        }
        setRows(json.data);
        setTotal(json.meta?.total ?? json.data.length);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load products");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [tab, page, pageSize, debouncedSearch, clientId, filters.category, filters.status, refreshTick]);

  /* reset paging + selection when the data scope changes */
  React.useEffect(() => {
    setPage(1);
    setSelection({});
  }, [tab, debouncedSearch, clientId, filters.category, filters.status]);

  /*
   * Default browse order: the API returns SKU-ascending, which fills the
   * first viewport with near-identical rows (12 tee variants in a row).
   * Re-order newest-first by the derived created date so page 1 interleaves
   * clients, categories, prices, kits, and statuses. Deterministic.
   */
  const orderedRows = React.useMemo(() => orderForBrowsing(rows), [rows]);

  const listings: ListingRow[] = React.useMemo(
    () => (tab === "listings" ? synthesizeListings(orderedRows) : []),
    [tab, orderedRows]
  );
  const pagedListings = React.useMemo(
    () => listings.slice((page - 1) * pageSize, page * pageSize),
    [listings, page, pageSize]
  );

  const filterOptions: FilterOption[] = React.useMemo(
    () => [
      { key: "client", label: "Client", options: clients.map((c) => c.name) },
      { key: "category", label: "Category", options: CATEGORY_OPTIONS },
      { key: "status", label: "Status", options: STATUS_OPTIONS },
    ],
    [clients]
  );

  const isProducts = tab === "products";

  return (
    /*
     * h-[calc(100dvh-3.5rem)] (viewport minus the h-14 top nav) caps the page
     * at the fold so the DataGrid's internal scroll region takes over and its
     * pagination footer stays pinned on screen. The app layout wraps pages in
     * min-h-screen (grows past the fold), so the cap must live here.
     */
    <div
      className={cn(
        "flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col",
        isProducts && "ks-products-actions-rail"
      )}
    >
      {/*
        Local shim for the global header search pill (app-shell.tsx is a
        read-only shared component): widen it to 280px and forbid wrapping so
        "Search orders, SKUs, locations…" can never break onto two lines
        inside the pill at 800px or 1440px. Same scoped workaround the
        Orders, Clients, Jobs, Receiving, Settings and Inventory Snapshot
        pages ship; the real fix (plus shortening the copy to
        "Search orders, SKUs…") belongs in the shared TopNav — see the shared
        component request accompanying this change.

        The .ks-products-actions-rail rules style the kebab actions column of
        the Products grid as a pinned actions rail (the shared DataGrid has
        no per-column cell/header class hooks): a hairline slate-200 left
        border separating it from PRICE, plus 8px right padding so the "…"
        trigger no longer sits flush against the grid's right edge. The
        :not([colspan]) guard keeps the border off full-width loading/empty/
        error cells, and the class is only applied on the Products tab so the
        Listings grid (whose last column is LAST SYNCED, not actions) is
        untouched.
      */}
      <style>{`
        header button:has(> kbd) {
          width: 280px !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ks-products-actions-rail thead th:last-child,
        .ks-products-actions-rail tbody td:last-child:not([colspan]) {
          border-left: 1px solid var(--color-slate-200, #e2e8f0);
          padding-right: 8px;
        }
      `}</style>
      <PageHeader
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Products" }]}
        title="Products"
        /*
         * No helper subtitle: PageHeader centers it in the gap between the H1
         * and the action buttons, where it floats unanchored. The shared
         * component has no "left of title, baseline-aligned" slot, and the
         * Logiwa-equivalent copy is noise anyway — dropped per design review.
         */
        actions={
          <>
            <BulkImportMenu />
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create New Product
            </Button>
          </>
        }
      />
      <UnderlineTabs
        className="mt-2"
        tabs={[
          { key: "products", label: "Products", count: isProducts && !loading ? total : undefined },
          {
            key: "listings",
            label: "Product Listings",
            count: !isProducts && !loading ? listings.length : undefined,
          },
        ]}
        active={tab}
        onChange={(key) => setTab(key as ProductsTab)}
      />
      {(() => {
        const toolbarLeft = (
          <>
            <GridSearch
              value={search}
              onChange={setSearch}
              placeholder={isProducts ? "Search by SKU" : "Search by listing SKU"}
            />
            <FilterButton filters={filterOptions} applied={filters} onApply={setFilters} />
          </>
        );
        const toolbarRight = (selectedCount: number) => (
          <>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </Button>
            <Button variant="secondary" size="md" disabled={selectedCount === 0}>
              <Tags className="h-3.5 w-3.5" aria-hidden />
              Label
            </Button>
          </>
        );
        const shared = {
          page,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (size: number) => {
            setPageSize(size);
            setPage(1);
          },
          loading,
          error,
          onRetry: () => setRefreshTick((t) => t + 1),
          onRefresh: () => setRefreshTick((t) => t + 1),
          selection,
          onSelectionChange: setSelection,
          toolbarLeft,
          toolbarRight,
        };
        return isProducts ? (
          <DataGrid<ProductRow>
            {...shared}
            columns={productColumns}
            data={orderedRows}
            total={total}
            emptyTitle="No products found"
            emptyDescription="Adjust your search or filters, or create a new product to get started."
            getRowId={(row) => row.id}
            onRowClick={(row) => router.push(`/products/${row.id}`)}
            exportName="products"
          />
        ) : (
          <DataGrid<ListingRow>
            {...shared}
            columns={listingColumns}
            data={pagedListings}
            total={listings.length}
            emptyTitle="No listings found"
            emptyDescription="Listings appear once products are connected to a sales channel."
            getRowId={(row) => row.id}
            exportName="product-listings"
          />
        );
      })()}
    </div>
  );
}
