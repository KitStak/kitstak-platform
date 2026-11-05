"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, FileSpreadsheet, FileUp, Plus, Tags, Trash2 } from "lucide-react";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch, type FilterOption } from "@/components/grid/grid-toolbar";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { synthesizeListings } from "./derive";
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

  const listings: ListingRow[] = React.useMemo(
    () => (tab === "listings" ? synthesizeListings(rows) : []),
    [tab, rows]
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Products" }]}
        title="Products"
        helper="You can create, edit, or delete your products here."
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
            data={rows}
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
