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
import {
  deriveAllocated,
  deriveAvailable,
  deriveDisplayCategory,
} from "./inventory-derive";
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
 * transform and reveals a 12px sort chevron on header hover (the active sort
 * column keeps the DataGrid's own persistent arrow); the horizontal scroll
 * container gets an always-visible styled scrollbar (Logiwa pattern — the
 * visible track signals the overflow) plus a sticky 24px right-edge scroll
 * shadow over the last visible column while scrollLeft < scrollWidth −
 * clientWidth, so a clipped column reads as "scroll for more" instead of a
 * rendering bug; the scroll container clips at its own padding box with the
 * card's inner radius, so the card's rounded border never cuts through
 * glyphs; the last header cell gets text-overflow: ellipsis so a header that
 * runs out of room never cuts mid-glyph; and the vertical scroll edge gets a
 * bottom fade to the table surface token (var(--surface), theme-safe) sized
 * by the scroll observer to exactly the sliced partial row, so that row fades
 * out while the gridline under the last fully-visible row stays crisp. The
 * shadow and fade are overlays (not masks) so the scrollbars stay crisp, and
 * each only renders while more content sits past that edge.
 */
const GRID_CHROME_CSS = `
.ks-inventory-grid thead th button {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* The last header never cuts mid-glyph: if it runs out of width it
   ellipsizes instead. inline-block (not the th's default inline flow) is
   what makes text-overflow actually apply to the sort-button label. */
.ks-inventory-grid thead th:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-inventory-grid thead th:last-child button {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
/* Sort affordance: every sortable header reveals a 12px chevron on hover.
   The chevron takes no layout width (negative right margin tucks it into the
   th's 12px right padding), so headers don't widen and columns never shift.
   The active sort column carries the DataGrid's own persistent 12px arrow (a
   real svg inside the button), so the hover hint hides there. */
.ks-inventory-grid thead th button::after {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 4px;
  margin-right: -16px;
  vertical-align: -2px;
  background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") center / 12px 12px no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") center / 12px 12px no-repeat;
  opacity: 0;
  transition: opacity 120ms ease;
}
.ks-inventory-grid thead th:hover button::after {
  opacity: 1;
}
/* The last header's button clips overflow (ellipsis rule above), which would
   swallow a tucked-in chevron; give it real width there instead. */
.ks-inventory-grid thead th:last-child button::after {
  margin-right: 0;
}
.ks-inventory-grid thead th button:has(svg)::after {
  display: none;
}
.ks-inventory-grid .ks-scroll {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
  /* Clip at the scroll container's own padding box, rounded to the card's
     inner radius (8px frame − 1px border): every content clip happens here,
     so the card's rounded border-radius never slices through a glyph. */
  border-radius: 7px 7px 0 0;
}
.ks-inventory-grid .ks-scroll::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}
.ks-inventory-grid .ks-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.ks-inventory-grid .ks-scroll::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
  border: none;
}
/* The right-edge scroll shadow anchors to the grid card (the .ks-scroll
   parent, selected via :has so the shared DataGrid stays untouched), pinned
   to the card's right edge so it stays put while the table scrolls under it,
   and is sized to the scroll viewport through --ks-scroll-h (set by the
   scroll observer below), so it covers header + rows but never the scrollbar
   or the grid footer. data-hscroll is true only while scrollLeft <
   scrollWidth − clientWidth: the shadow disappears at the right edge. */
.ks-inventory-grid div:has(> .ks-scroll > table) {
  position: relative;
}
.ks-inventory-grid[data-hscroll="true"] div:has(> .ks-scroll > table)::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  width: 24px;
  height: var(--ks-scroll-h, 0px);
  background: linear-gradient(to left, rgba(16, 24, 40, 0.08), transparent);
  pointer-events: none;
}
/* --ks-vfade-h = the visible height of the row sliced by the bottom edge
   (set by the scroll observer). The fade starts exactly at that row's top
   border, so the sliced row dissolves into the table surface while the
   gridline under the last fully-visible row stays crisp all the way to the
   pagination bar. var(--surface) keeps the fade on the table surface token
   in both themes. */
.ks-inventory-grid[data-vscroll="true"] .ks-scroll::after {
  content: "";
  position: sticky;
  bottom: 0;
  left: 0;
  display: block;
  height: var(--ks-vfade-h, 0px);
  width: 100%;
  margin-top: calc(-1 * var(--ks-vfade-h, 0px));
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

/**
 * Every stock figure must reconcile with the columns on screen:
 * ALLOCATED passes through the demand-pattern overrides (deriveAllocated —
 * the shared repository's seed allocates ~1–3% everywhere, so low-stock
 * states could never fire), and AVAILABLE is re-derived as on hand −
 * allocated − damaged (the read-only repository still returns onHand −
 * allocated). Rows are rebuilt here — before render, sort, "Below Reorder"
 * status, and CSV export all read them. ATP rows carry no damaged count; their
 * available and ATP total are re-derived from the same allocation so the tabs
 * never contradict each other.
 */
function withDerivedStock(rows: InventoryRow[]): InventoryRow[] {
  return rows.map((row) => {
    if ("damaged" in row) {
      const allocated = deriveAllocated(row.sku, row.allocated, row.onHand, row.damaged);
      return {
        ...row,
        allocated,
        available: deriveAvailable(row.onHand, allocated, row.damaged),
      };
    }
    const allocated = deriveAllocated(row.sku, row.allocated, row.onHand);
    const available = row.onHand - allocated;
    return { ...row, allocated, available, atp: available + row.incoming };
  });
}

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
  const sortDefaultedForTab = React.useRef<InventoryView | null>(null);

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
        setRows(withDerivedStock(body.data));
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
      /* Right-edge shadow height = scroll viewport (clientHeight excludes the
         horizontal scrollbar), so the shadow never dims the scrollbar track. */
      host.style.setProperty("--ks-scroll-h", `${scroller.clientHeight}px`);
      const canScrollY = scroller.scrollHeight - scroller.clientHeight > 1;
      const atBottomEdge =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      host.dataset.vscroll = String(canScrollY && !atBottomEdge);
      /* Bottom fade height = visible slice of the row cut by the bottom edge
         (measured, so it tracks the density toggle's row height), anchored at
         that row's top border: the sliced row fades out, the gridline under
         the last full row stays visible. */
      const theadHeight =
        scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const rowHeight =
        scroller.querySelector("tbody tr")?.getBoundingClientRect().height ?? 0;
      let fadeHeight = 0;
      if (canScrollY && rowHeight > 0) {
        const visibleBodyHeight =
          scroller.scrollTop + scroller.clientHeight - theadHeight;
        fadeHeight = Math.round(visibleBodyHeight % rowHeight);
      }
      host.style.setProperty("--ks-vfade-h", `${fadeHeight}px`);
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

  /* Default sort: SKU ascending, with its persistent indicator. The shared
     DataGrid (read-only) owns its sorting state and exposes no initial-sort
     prop, so the default is established the way a user would set it — one
     synthetic click on the SKU header — and only while no column shows an
     active sort arrow (a real svg inside a header button), so a sort the user
     picked is never overridden. It waits for rows: on an empty grid TanStack
     has no first value to type-sniff, resolves the toggle direction to desc,
     and the default would land on Z→A. The ref keeps it to one application
     per tab (StrictMode double-invokes effects in dev, which would otherwise
     toggle asc → desc). */
  React.useEffect(() => {
    if (loading || rows.length === 0) return;
    if (sortDefaultedForTab.current === tab) return;
    sortDefaultedForTab.current = tab;
    const host = gridShellRef.current;
    if (!host) return;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>("thead th button")
    );
    const hasActiveSort = buttons.some((button) => button.querySelector("svg"));
    if (hasActiveSort) return;
    buttons.find((button) => button.textContent?.trim() === "SKU")?.click();
  }, [tab, loading, rows]);

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
          /* Every sibling tab follows one pattern: label + gray count badge.
             ATP's badge is its own row count (one row per promisable
             product), fetched like the others. */
          count: counts[view],
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
