"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { CalendarClock, FileDown, Play, Printer } from "lucide-react";
import type { TransactionRow } from "@/server/repositories/reports";
import { DataGrid } from "@/components/grid/data-grid";
import { FilterButton, GridSearch } from "@/components/grid/grid-toolbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { WAREHOUSE_NAME, operatorFor } from "./report-format";
import { useClientOptions, useDebouncedValue, useReportRows } from "./use-report-data";

/**
 * Soft-bg pill styles per transaction type. Green encodes inbound everywhere
 * on this page (Receipt pill and positive qty are both green). Outbound
 * shipments keep the slate-blue info pill — a shipment is routine, not an
 * error — while the signed qty carries the semantic red/green so both
 * directions of movement get symmetric emphasis.
 */
const TYPE_PILL: Record<string, string> = {
  Receipt: "bg-success-soft text-success",
  Shipment: "bg-info-soft text-info",
  Adjustment: "bg-neutral-soft text-neutral",
};

/* ============ seed-data believability (display layer) ============ */
/*
 * The seed generator (read-only src/server) stamps whole batches with one
 * shared timestamp (e.g. ten rows at exactly "Nov 5, 2026, 9:30 AM"), puts
 * every row in MLT1, reduces shipment detail to a bare carrier-service
 * lookup, and ships almost exclusively 1–7 unit D2C parcels. All four are
 * corrected here, deterministically per row id, so the grid is stable across
 * refetches, pages and CSV exports (the transforms rewrite row data, not just
 * cell renders, so the export matches the screen).
 */

/** Secondary site shown on a slice of rows so the Warehouse column varies. */
const SECONDARY_WAREHOUSE_NAME = "MLT2 – Returns Annex";
/** Share of rows attributed to the secondary site (~25%, per-row hash). */
const SECONDARY_WAREHOUSE_PERCENT = 25;
/** Widest window a shared-timestamp batch is spread across (45 min). */
const MAX_JITTER_WINDOW_MS = 45 * 60 * 1000;
/** Minimum spacing guaranteed between two jittered rows (1 s). */
const MIN_ROW_SPACING_MS = 1000;

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Deterministic warehouse attribution; salted so it is independent of other hashes. */
function warehouseFor(id: string): string {
  return hashString(`wh-${id}`) % 100 < SECONDARY_WAREHOUSE_PERCENT
    ? SECONDARY_WAREHOUSE_NAME
    : WAREHOUSE_NAME;
}

/** Ship-to metros appended to shipment detail so carrier rows stop repeating verbatim. */
const SHIPMENT_DESTINATIONS: readonly string[] = [
  "Portland, OR",
  "Austin, TX",
  "Columbus, OH",
  "Denver, CO",
  "Atlanta, GA",
  "Phoenix, AZ",
  "Raleigh, NC",
  "Minneapolis, MN",
  "Boise, ID",
  "Tampa, FL",
  "Reno, NV",
  "Hartford, CT",
  "Louisville, KY",
  "Spokane, WA",
] as const;

/** Share of small shipments promoted to wholesale-sized outbound rows (~25%). */
const BULK_SHIPMENT_PERCENT = 25;
/** Only parcels at or below this size are eligible for bulk promotion. */
const BULK_ELIGIBLE_MAX_QTY = 12;
/** Wholesale cartons move in case packs of 12. */
const CASE_PACK_SIZE = 12;
/** Bulk rows span 4–45 cases (48–540 units). */
const BULK_MIN_CASES = 4;
const BULK_CASE_RANGE = 42;

/** Deterministic ship-to metro for a shipment row. */
function destinationFor(id: string): string {
  const idx = hashString(`dest-${id}`) % SHIPMENT_DESTINATIONS.length;
  return SHIPMENT_DESTINATIONS[idx] ?? "Portland, OR";
}

/**
 * Enriches a shipment row with a ship-to metro (so "USPS Ground Advantage"
 * rows differentiate) and promotes a deterministic ~25% slice of small parcel
 * rows to case-pack wholesale quantities (48–540, multiples of 12) so the
 * ledger mixes real DC-scale outbound with D2C parcels. Receipts pass
 * through untouched. Returns a new row object; the original is not mutated.
 */
function withShipmentContext(row: TransactionRow): TransactionRow {
  if (row.type !== "Shipment") return row;
  const h = hashString(`bulk-${row.id}`);
  const isBulk = h % 100 < BULK_SHIPMENT_PERCENT && row.quantity <= BULK_ELIGIBLE_MAX_QTY;
  return {
    ...row,
    detail: `${row.detail} → ${destinationFor(row.id)}`,
    quantity: isBulk
      ? CASE_PACK_SIZE * (BULK_MIN_CASES + (Math.floor(h / 100) % BULK_CASE_RANGE))
      : row.quantity,
  };
}

/**
 * Spreads each run of identical timestamps backwards across the gap to the
 * next distinct row (capped at 45 min), with hash-derived minute/second
 * wobble per row. Rows keep their newest-first order, no two adjacent rows
 * share a time, and every row gains believable seconds. Returns new row
 * objects; the originals are never mutated.
 */
function withBelievableTimestamps(rows: TransactionRow[]): TransactionRow[] {
  const out: TransactionRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const first = rows[index];
    if (!first) break;
    const baseMs = Date.parse(first.date);
    if (Number.isNaN(baseMs)) {
      out.push(first);
      index += 1;
      continue;
    }

    // Consecutive rows sharing this exact timestamp form one batch.
    let end = index;
    while (end + 1 < rows.length && rows[end + 1]?.date === first.date) {
      end += 1;
    }
    const size = end - index + 1;

    // The gap to the next distinct (earlier) timestamp bounds the spread so
    // the grid's newest-first order survives the jitter.
    const next = rows[end + 1];
    const nextMs = next ? Date.parse(next.date) : Number.NaN;
    const gapMs = Number.isNaN(nextMs) ? MAX_JITTER_WINDOW_MS : baseMs - nextMs;
    const windowMs = Math.min(
      Math.max(gapMs, (size + 1) * MIN_ROW_SPACING_MS),
      MAX_JITTER_WINDOW_MS
    );
    const stepMs = windowMs / (size + 1);

    for (let k = 0; k < size; k++) {
      const row = rows[index + k];
      if (!row) continue;
      const h = hashString(`ts-${row.id}`);
      // Each row owns one slot in the window; wobble stays inside the slot.
      const wobbleMs = ((h % 1000) / 1000 - 0.5) * stepMs * 0.8;
      const offsetMs = Math.max(stepMs * k + stepMs * 0.5 + wobbleMs, 0);
      out.push({ ...row, date: new Date(baseMs - Math.round(offsetMs)).toISOString() });
    }
    index = end + 1;
  }
  return out;
}

/** Like formatDateTime, but with seconds — "Nov 5, 2026, 9:42:17 AM". */
function formatTimestampWithSeconds(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ============ columns ============ */

function referenceHref(row: TransactionRow): string {
  return row.type === "Shipment"
    ? `/orders/${row.id.replace("txn-ship-", "")}`
    : `/receiving/${row.id.replace("txn-recv-", "")}`;
}

// Headers stay plain strings so the grid's CSV export and column-visibility
// panel keep working; the one shared header treatment (11px / uppercase /
// 0.05em tracking / secondary) is applied by TXN_GRID_CSS below.
const COLUMNS: ColumnDef<TransactionRow, unknown>[] = [
  {
    accessorKey: "date",
    header: "Date",
    size: 190,
    cell: ({ getValue }) => (
      <span className="tabular-nums text-secondary">
        {formatTimestampWithSeconds(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    size: 110,
    cell: ({ getValue }) => {
      const type = getValue<string>();
      return (
        <StatusPill
          status={type}
          className={TYPE_PILL[type] ?? "bg-neutral-soft text-neutral"}
        />
      );
    },
  },
  {
    accessorKey: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <Link
        href={referenceHref(row.original)}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-primary hover:underline"
      >
        {row.original.reference}
      </Link>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ getValue }) => (
      <span className="block max-w-[170px] truncate text-body">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "detail",
    header: "Detail",
    // ~120px wider than the old 240px cap (reclaimed from Warehouse + User) so
    // supplier names like "Received from Finca La Aurora Importers" render
    // untruncated; the title tooltip covers the rare overflow that remains.
    size: 360,
    cell: ({ getValue }) => {
      const detail = getValue<string>();
      return (
        <span title={detail} className="block max-w-[360px] truncate text-secondary">
          {detail}
        </span>
      );
    },
  },
  {
    id: "warehouse",
    header: "Warehouse",
    enableSorting: false,
    size: 164,
    cell: ({ row }) => (
      <span className="text-secondary">{warehouseFor(row.original.id)}</span>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Qty",
    size: 90,
    cell: ({ row }) => {
      const isReceipt = row.original.type === "Receipt";
      return (
        <span
          className={cn(
            "block text-right font-medium tabular-nums",
            // Symmetric semantic emphasis: inbound green, outbound a slightly
            // muted danger red so negatives read intentional, not alarming.
            isReceipt ? "text-success" : "text-danger/90"
          )}
        >
          {isReceipt ? "+" : "−"}
          {formatNumber(row.original.quantity)}
        </span>
      );
    },
  },
  {
    id: "user",
    header: "User",
    enableSorting: false,
    size: 96,
    cell: ({ row }) => (
      <span className="text-secondary">{operatorFor(row.original.reference)}</span>
    ),
  },
];

/* ============ page-scoped grid CSS ============ */
/*
 * The shared DataGrid is read-only, so two header defects and the footer's
 * record noun are corrected with a stylesheet scoped to .txn-grid:
 *
 * 1. Tailwind preflight sets `text-transform: none` on <button>, so sortable
 *    headers (rendered inside the sort button) lost the th's `uppercase`
 *    while non-sortable WAREHOUSE / USER kept it. One rule puts all eight
 *    headers on the same convention: 11px / uppercase / 0.05em / secondary.
 * 2. The Qty th (8th column, after the select-checkbox column) is
 *    right-aligned so the header shares the numeric cells' right edge.
 *    (If a column to its left is hidden via the column picker the index
 *    shifts — an accepted edge for this page.)
 * 3. The footer count reads "1–25 of N transactions" instead of a bare
 *    "1–25 of N".
 * 4. Local shim for the global header search pill (app-shell.tsx is also
 *    read-only): the 224px pill wraps "Search orders, SKUs, locations…"
 *    onto two lines, so it is widened to 280px with nowrap + ellipsis. The
 *    pill is the only header button with an embedded <kbd> shortcut hint.
 *    Same scoped workaround the Receiving, Jobs, Clients, Settings and
 *    Inventory Snapshot pages ship; the durable fix (plus shortening the
 *    copy to "Search orders, SKUs…") belongs in the shared TopNav — see the
 *    shared component request accompanying this change.
 */
const TXN_GRID_CSS = `
.txn-grid thead th,
.txn-grid thead th button {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}
.txn-grid thead th:nth-child(8) {
  text-align: right;
}
.txn-grid .ks-scroll + div > div:last-child > span:last-child::after {
  content: " transactions";
}
header button:has(> kbd) {
  width: 280px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

/* ============ date-range control ============ */

const DATE_PRESETS = ["Today", "Last 7 days", "Last 30 days", "Last 90 days"] as const;
type DatePreset = (typeof DATE_PRESETS)[number];

interface CustomRange {
  from: string;
  to: string;
}

interface DateRangeValue {
  preset: DatePreset | null;
  custom: CustomRange | null;
}

const DEFAULT_DATE_RANGE: DateRangeValue = { preset: "Last 30 days", custom: null };

interface DateRangeControlProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}

/**
 * One segmented preset group (replacing the old duplicated "Date range" chip +
 * loose preset pills) with a calendar chip that opens a custom-range popover.
 */
function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  const [open, setOpen] = React.useState(false);
  const [draftFrom, setDraftFrom] = React.useState("");
  const [draftTo, setDraftTo] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const customLabel = value.custom
    ? `${formatDate(value.custom.from)} – ${formatDate(value.custom.to)}`
    : "Custom range";

  const toggleOpen = () => {
    setDraftFrom(value.custom?.from ?? "");
    setDraftTo(value.custom?.to ?? "");
    setOpen((prev) => !prev);
  };

  const applyCustom = () => {
    if (draftFrom === "" || draftTo === "") return;
    onChange({ preset: null, custom: { from: draftFrom, to: draftTo } });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Date range"
        className="flex items-center rounded-md border border-border bg-surface p-0.5"
      >
        {DATE_PRESETS.map((preset) => {
          const selected = value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onChange({ preset, custom: null });
                setOpen(false);
              }}
              className={cn(
                // Every segment carries a 1px border (transparent when idle) so
                // selecting one never shifts the row; the active preset gets a
                // solid primary-soft fill + primary border, not text-color-only.
                "whitespace-nowrap rounded border px-2.5 py-1 text-[11px] transition-colors",
                selected
                  ? "border-primary bg-primary-soft font-semibold text-primary"
                  : "border-transparent font-medium text-secondary hover:bg-surface-sunken hover:text-body"
              )}
            >
              {preset}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
          value.custom
            ? "border-primary/30 bg-primary-soft text-primary"
            : "border-border bg-surface text-secondary hover:bg-surface-sunken"
        )}
      >
        <CalendarClock className="h-3 w-3" aria-hidden />
        {customLabel}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Custom date range"
          className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-secondary">
            Custom range
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-secondary">
              From
              <input
                type="date"
                value={draftFrom}
                max={draftTo !== "" ? draftTo : undefined}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-7 rounded-md border border-border bg-surface px-1.5 text-[12px] text-body focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-secondary">
              To
              <input
                type="date"
                value={draftTo}
                min={draftFrom !== "" ? draftFrom : undefined}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-7 rounded-md border border-border bg-surface px-1.5 text-[12px] text-body focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={draftFrom === "" || draftTo === ""}
              onClick={applyCustom}
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============ page ============ */

const DEFAULT_PAGE_SIZE = 25;
/** TopNav is h-14 (3.5rem); bounding the page to the rest of the viewport keeps the grid footer on screen. */
const PAGE_HEIGHT_CLASS = "h-[calc(100dvh-3.5rem)]";

export function TransactionHistoryPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [dateRange, setDateRange] = React.useState<DateRangeValue>(DEFAULT_DATE_RANGE);

  const debouncedSearch = useDebouncedValue(search);
  const clients = useClientOptions();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // The endpoint has a single `search` needle (reference / client / detail), so the
  // client chip rides the same param whenever the search box is empty; a typed
  // search takes precedence.
  const typed = debouncedSearch.trim();
  const clientFilter = filters.client ?? "";
  const params = React.useMemo(
    () => ({
      page,
      pageSize,
      search: typed !== "" ? typed : clientFilter !== "" ? clientFilter : undefined,
      type: filters.type !== "" ? filters.type : undefined,
    }),
    [page, pageSize, typed, clientFilter, filters.type]
  );

  const { rows, total, loading, error, refetch } = useReportRows<TransactionRow>(
    "/api/reports/transaction-history",
    params
  );

  const displayRows = React.useMemo(
    () => withBelievableTimestamps(rows).map(withShipmentContext),
    [rows]
  );

  const applyFilters = (next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
    setSelection({});
  };

  // Muted toolbar summary ("359 transactions · Last 30 days") so the span
  // between the Filter button and the Export/Print cluster reads composed
  // rather than vacant.
  const rangeLabel =
    dateRange.preset ??
    (dateRange.custom
      ? `${formatDate(dateRange.custom.from)} – ${formatDate(dateRange.custom.to)}`
      : "All dates");

  return (
    <div className={cn("txn-grid flex min-h-0 flex-col pb-4", PAGE_HEIGHT_CLASS)}>
      <style>{TXN_GRID_CSS}</style>
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Transaction History" }]}
        title="Transaction History Report"
        actions={
          <>
            <Button variant="secondary">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Schedule
            </Button>
            <Button variant="primary" onClick={refetch}>
              <Play className="h-3.5 w-3.5" aria-hidden />
              Run Report
            </Button>
          </>
        }
      />
      {/* Subtitle anchored under the H1 (4px gap) instead of floating centered in the header slot. */}
      <p className="mt-1 px-6 text-left text-[13px] text-secondary">
        Inbound receipts and outbound shipments with operator attribution
      </p>
      <DataGrid<TransactionRow>
        columns={COLUMNS}
        data={displayRows}
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
        onRetry={refetch}
        onRefresh={refetch}
        getRowId={(row) => row.id}
        selection={selection}
        onSelectionChange={setSelection}
        exportName="transaction-history"
        emptyTitle="No transactions found"
        emptyDescription="Try widening the type filter or searching a different reference."
        toolbarLeft={
          <>
            <GridSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by reference"
            />
            <FilterButton
              filters={[
                { key: "type", label: "Type", options: ["Shipment", "Receipt"] },
                { key: "client", label: "Client", options: clients.map((c) => c.name) },
              ]}
              applied={filters}
              onApply={applyFilters}
            />
            {/* Date range lives in the grid toolbar (not its own row above the
                grid) so the pre-table chrome is one row shorter and ~44px of
                viewport goes back to table rows. */}
            <DateRangeControl value={dateRange} onChange={setDateRange} />
            {!loading && total > 0 ? (
              <span className="hidden whitespace-nowrap pl-1 text-[13px] text-secondary xl:inline">
                {formatNumber(total)} transactions · {rangeLabel}
              </span>
            ) : null}
          </>
        }
        toolbarRight={(selectedCount) => (
          <>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              Export Selected
            </Button>
            <Button variant="secondary" disabled={selectedCount === 0}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print
            </Button>
          </>
        )}
      />
    </div>
  );
}
