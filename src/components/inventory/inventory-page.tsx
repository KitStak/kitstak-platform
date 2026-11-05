"use client";

import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  ChevronDown,
  Plus,
  Printer,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type {
  AtpRow,
  InventoryView,
  LocationInventoryRow,
  TotalInventoryRow,
} from "@/server/repositories/inventory";
import type { ClientListRow } from "@/server/repositories/clients";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch, type FilterOption } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { atpColumns, byLocationColumns, totalColumns } from "./inventory-columns";
import { deriveDisplayCategory } from "./inventory-derive";
import { InventoryTabs } from "./inventory-tabs";

const SEARCH_DEBOUNCE_MS = 300;
/** Display categories (see deriveDisplayCategory), not raw server categories. */
const CATEGORY_OPTIONS = ["Apparel", "Headwear", "Accessories", "Coffee", "Electronics"];
const ZONE_OPTIONS = ["A", "B", "C", "D", "RECV", "SHIP", "RET"];
const VIEWS: InventoryView[] = ["total", "by-location", "atp"];

/** TopNav is h-14 (3.5rem); bounding the page to the rest of the viewport
 *  keeps the DataGrid footer pinned on screen instead of below the fold. */
const PAGE_HEIGHT_CLASS = "h-[calc(100dvh-3.5rem)]";

/**
 * Page-scoped grid chrome we cannot change inside the shared DataGrid
 * (read-only): the sortable header <button> drops the th's uppercase
 * transform, the horizontal scroll container needs a right scroll-edge
 * shadow while more columns sit off-screen, and the vertical scroll edge
 * needs a 24px bottom fade to the surface color so a row clipped by the
 * viewport never slices letterforms mid-glyph above the sticky footer.
 * The fade is a sticky overlay (not a mask) so the scrollbars stay crisp,
 * and it only renders while more rows sit below the fold.
 */
const GRID_CHROME_CSS = `
.ks-inventory-grid thead th button {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ks-inventory-grid[data-hscroll="true"] .ks-scroll {
  box-shadow: inset -12px 0 10px -10px rgba(16, 24, 40, 0.12);
}
.ks-inventory-grid[data-vscroll="true"] .ks-scroll::after {
  content: "";
  position: sticky;
  bottom: 0;
  left: 0;
  display: block;
  height: 24px;
  width: 100%;
  margin-top: -24px;
  background: linear-gradient(to bottom, transparent, var(--surface));
  pointer-events: none;
}
`;

type InventoryRow = TotalInventoryRow | LocationInventoryRow | AtpRow;

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: { total: number };
}

const TAB_LABELS: Record<InventoryView, string> = {
  total: "Total Inventory",
  "by-location": "Inventory by Location",
  atp: "Available to Promise",
};

const EMPTY_COPY: Record<InventoryView, { title: string; description: string }> = {
  total: {
    title: "No inventory found",
    description: "No products match the current search or filters.",
  },
  "by-location": {
    title: "No stock in these locations",
    description: "Try a different zone, client or SKU search.",
  },
  atp: {
    title: "Nothing to promise",
    description: "No products match the current search or filters.",
  },
};

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

export function InventoryPage() {
  const [tab, setTab] = React.useState<InventoryView>("total");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [search, setSearch] = React.useState("");
  const [applied, setApplied] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [rows, setRows] = React.useState<InventoryRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [clients, setClients] = React.useState<ClientListRow[]>([]);
  const [counts, setCounts] = React.useState<Partial<Record<InventoryView, number>>>({});
  const [reloadKey, setReloadKey] = React.useState(0);
  const gridShellRef = React.useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const clientId = clients.find((c) => c.name === applied.client)?.id;
  const zone = tab === "by-location" ? applied.zone : undefined;

  /* clients for the filter dropdown + unfiltered tab counts, once */
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/clients?pageSize=100", { signal: controller.signal })
      .then((res) => res.json())
      .then((body: Envelope<ClientListRow[]>) => {
        if (body.success && body.data) setClients(body.data);
      })
      .catch(() => undefined);
    Promise.all(
      VIEWS.map((view) =>
        fetch(`/api/inventory?view=${view}&page=1&pageSize=1`, {
          signal: controller.signal,
        })
          .then((res) => res.json())
          .then((body: Envelope<InventoryRow[]>) => [view, body.meta?.total] as const)
      )
    )
      .then((pairs) => {
        setCounts((prev) => {
          const next = { ...prev };
          for (const [view, n] of pairs) {
            if (typeof n === "number") next[view] = n;
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  /* main grid fetch */
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      view: tab,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (clientId) params.set("clientId", clientId);
    if (zone) params.set("zone", zone);
    fetch(`/api/inventory?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as Envelope<InventoryRow[]>;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load inventory");
        setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, pageSize, debouncedSearch, clientId, zone, reloadKey]);

  /* scroll-edge treatment: flag the grid shell while columns overflow to the
     right (edge shadow) or rows overflow below (16px bottom fade), so the
     viewport cut reads as "more content" instead of a clipped glyph. The
     scroll container lives inside the shared DataGrid, so we observe it from
     outside rather than editing the shared component. */
  React.useEffect(() => {
    const host = gridShellRef.current;
    if (!host) return;
    const scroller = host.querySelector<HTMLElement>(".ks-scroll");
    if (!scroller) return;
    const update = () => {
      const canScrollX = scroller.scrollWidth - scroller.clientWidth > 1;
      const atRightEdge =
        scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
      host.dataset.hscroll = String(canScrollX && !atRightEdge);
      const canScrollY = scroller.scrollHeight - scroller.clientHeight > 1;
      const atBottomEdge =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      host.dataset.vscroll = String(canScrollY && !atBottomEdge);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, [tab]);

  /* reset paging + selection whenever the result set changes shape */
  React.useEffect(() => {
    setPage(1);
    setSelection({});
  }, [tab, debouncedSearch, clientId, zone, pageSize]);

  const switchTab = (key: string) => {
    setTab(key as InventoryView);
    setApplied({});
    setSearch("");
  };

  const filterOptions: FilterOption[] = React.useMemo(() => {
    const client: FilterOption = {
      key: "client",
      label: "Client",
      options: clients.map((c) => c.name),
    };
    if (tab === "total") {
      return [client, { key: "category", label: "Category", options: CATEGORY_OPTIONS }];
    }
    if (tab === "by-location") {
      return [client, { key: "zone", label: "Zone", options: ZONE_OPTIONS }];
    }
    return [client];
  }, [tab, clients]);

  /* category isn't a server-side param; narrow the current page locally,
     matching against the derived display category the grid renders */
  const visibleRows = React.useMemo(() => {
    if (tab !== "total" || !applied.category) return rows;
    return rows.filter(
      (r) =>
        "category" in r &&
        deriveDisplayCategory(r.sku, r.category) === applied.category
    );
  }, [rows, tab, applied.category]);

  const gridShared = {
    total,
    page,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
    loading,
    error,
    onRetry: () => setReloadKey((k) => k + 1),
    onRefresh: () => setReloadKey((k) => k + 1),
    selection,
    onSelectionChange: setSelection,
    emptyTitle: EMPTY_COPY[tab].title,
    emptyDescription: EMPTY_COPY[tab].description,
    exportName: `inventory-${tab}`,
    toolbarLeft: (
      <>
        <GridSearch value={search} onChange={setSearch} placeholder="Search by SKU" />
        <FilterButton filters={filterOptions} applied={applied} onApply={setApplied} />
      </>
    ),
    toolbarRight: (selectedCount: number) => (
      <>
        <Button variant="secondary" size="md" disabled={selectedCount === 0}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Adjust Inventory
        </Button>
        <Button variant="secondary" size="md" disabled={selectedCount === 0}>
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
          Transfer
        </Button>
        <Button variant="secondary" size="md" disabled={selectedCount === 0}>
          <Printer className="h-3.5 w-3.5" aria-hidden />
          Print Labels
        </Button>
      </>
    ),
  };

  return (
    <div className={`flex ${PAGE_HEIGHT_CLASS} min-h-0 flex-col overflow-hidden pb-4`}>
      <PageHeader
        breadcrumbs={[{ label: "Inventory" }, { label: TAB_LABELS[tab] }]}
        title="Inventory"
        actions={
          <>
            <Button variant="secondary" size="md">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
              <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
            </Button>
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Adjustment
            </Button>
          </>
        }
      />
      {/* Subtitle sits directly under the H1 (the shared PageHeader's helper
          slot centers it between title and actions, which we can't change),
          so the header row stays H1 + right-aligned actions. */}
      <p className="mt-1 px-6 text-[13px] leading-5 text-secondary">
        You can see and manage your inventory levels.
      </p>
      <InventoryTabs
        className="mt-2.5"
        active={tab}
        onChange={switchTab}
        tabs={VIEWS.map((view) => ({
          key: view,
          label: TAB_LABELS[view],
          /* ATP shares Total Inventory's product count, and an identical
             "70 / 70" badge pair reads as a duplicated number — so the ATP
             tab carries no count badge. */
          count: view === "atp" ? undefined : counts[view],
        }))}
      />
      <div
        ref={gridShellRef}
        data-hscroll="false"
        data-vscroll="false"
        className="ks-inventory-grid flex min-h-0 flex-1 flex-col"
      >
        <style>{GRID_CHROME_CSS}</style>
        <InventoryGrid tab={tab} rows={visibleRows} shared={gridShared} />
      </div>
    </div>
  );
}

interface GridSharedProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  selection: RowSelectionState;
  onSelectionChange: (next: RowSelectionState) => void;
  emptyTitle: string;
  emptyDescription: string;
  exportName: string;
  toolbarLeft: React.ReactNode;
  toolbarRight: (selectedCount: number) => React.ReactNode;
}

function InventoryGrid({
  tab,
  rows,
  shared,
}: {
  tab: InventoryView;
  rows: InventoryRow[];
  shared: GridSharedProps;
}) {
  if (tab === "by-location") {
    return (
      <DataGrid<LocationInventoryRow>
        {...shared}
        columns={byLocationColumns}
        data={rows as LocationInventoryRow[]}
        getRowId={(row) => row.id}
      />
    );
  }
  if (tab === "atp") {
    return (
      <DataGrid<AtpRow>
        {...shared}
        columns={atpColumns}
        data={rows as AtpRow[]}
        getRowId={(row) => row.productId}
      />
    );
  }
  return (
    <DataGrid<TotalInventoryRow>
      {...shared}
      columns={totalColumns}
      data={rows as TotalInventoryRow[]}
      getRowId={(row) => row.productId}
    />
  );
}
