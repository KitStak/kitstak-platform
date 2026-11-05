"use client";

/**
 * Local fork of `@/components/grid/data-grid` for the receiving module.
 *
 * The shared DataGrid is read-only for this workstream, so the critique fixes
 * that belong in it are implemented here instead (and requested upstream):
 * - skeleton row count matches the page size / current page row count instead
 *   of a hardcoded 12, so loading never leaves a dead band above the footer
 * - skeleton bar widths vary deterministically per row/column (60–90%) so the
 *   placeholder reads as real content settling in (shimmer comes from the
 *   shared `.ks-skeleton` token)
 * - the native `<select>` page-size control is replaced with the
 *   design-system Dropdown (32px trigger, hairline border, 13px type)
 * - columns can opt into right-aligned headers via `meta: { align: "right" }`
 *   so numeric columns align header + tabular-nums cells
 */

import * as React from "react";
import {
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Inbox,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Horizontal alignment for the column header (cells align themselves). */
    align?: "left" | "right";
    /**
     * Extra classes applied to the rendered header label. Lets composite
     * columns (e.g. "Received": numeral + progress bar + percent) align the
     * header text to an inner slot edge — such as the right edge of the
     * numeral column — while keeping the header itself a plain string so CSV
     * export and the column-visibility menu still read it.
     */
    headerClassName?: string;
  }
}

export type Density = "comfortable" | "compact";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
/** Skeleton bar widths vary within this band so placeholders read as content. */
const SKELETON_MIN_PCT = 60;
const SKELETON_RANGE_PCT = 31; // 60–90%

/** Deterministic per-cell width (no Math.random → no hydration mismatch). */
function skeletonWidth(rowIndex: number, colIndex: number): string {
  const pct = SKELETON_MIN_PCT + ((rowIndex * 29 + colIndex * 17) % SKELETON_RANGE_PCT);
  return `${pct}%`;
}

export interface PoGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  getRowId: (row: T) => string;
  selection?: RowSelectionState;
  onSelectionChange?: (next: RowSelectionState) => void;
  onRowClick?: (row: T) => void;
  exportName?: string;
  onRefresh?: () => void;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: (selectedCount: number) => React.ReactNode;
  /**
   * Sort state the grid starts with. The receiving API returns rows ordered
   * by `createdAt` desc; declaring that here makes the "Created" header show
   * its sort-direction chevron instead of presenting as an unsorted grid.
   */
  initialSorting?: SortingState;
}

function exportCsv<T>(rows: T[], columns: ColumnDef<T, unknown>[], name: string) {
  const headers = columns
    .filter((c) => c.header && typeof c.header === "string")
    .map((c) => c.header as string);
  const keys = columns
    .filter((c) => c.header && typeof c.header === "string")
    .map((c) => ("accessorKey" in c ? (c.accessorKey as string) : ""));
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      keys
        .map((k) => {
          if (!k) return "";
          const value = (row as Record<string, unknown>)[k];
          const s = value == null ? "" : String(value);
          return s.includes(",") || s.includes('"')
            ? `"${s.replaceAll('"', '""')}"`
            : s;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Design-system page-size control (replaces the native OS `<select>`). */
function PageSizeSelect({
  pageSize,
  onPageSizeChange,
}: {
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <Dropdown
      trigger={(open) => (
        <button
          type="button"
          aria-label="Rows per page"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5",
            "text-[13px] font-medium text-secondary transition-colors",
            "hover:bg-surface-sunken hover:text-body",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
            open && "border-border-strong text-body"
          )}
        >
          Show {pageSize} items
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-faint transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      )}
      panelClassName="bottom-full top-auto mb-1 mt-0 min-w-[150px]"
    >
      {(close) =>
        PAGE_SIZE_OPTIONS.map((n) => (
          <DropdownItem
            key={n}
            role="option"
            aria-selected={n === pageSize}
            className={n === pageSize ? "font-semibold text-primary" : undefined}
            onClick={() => {
              onPageSizeChange(n);
              close();
            }}
          >
            <span className="flex-1">Show {n} items</span>
            {n === pageSize ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          </DropdownItem>
        ))
      }
    </Dropdown>
  );
}

export function PoGrid<T>({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  error,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Adjust your filters or create a new record to get started.",
  getRowId,
  selection,
  onSelectionChange,
  onRowClick,
  exportName = "export",
  onRefresh,
  toolbarLeft,
  toolbarRight,
  initialSorting,
}: PoGridProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [density, setDensity] = React.useState<Density>("compact");
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});

  const rowSelection = selection ?? internalSelection;
  const setRowSelection = onSelectionChange ?? setInternalSelection;

  const selectColumn = React.useMemo<ColumnDef<T, unknown>>(
    () => ({
      id: "_select",
      size: 36,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={table.getIsAllRowsSelected()}
          ref={(el) => {
            if (el) el.indeterminate = table.getIsSomeRowsSelected();
          }}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    }),
    []
  );

  const allColumns = React.useMemo(
    () => [selectColumn, ...columns],
    [selectColumn, columns]
  );

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
    },
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const selectedCount = Object.keys(rowSelection).length;
  const rowH = density === "compact" ? "h-10" : "h-12";
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  /**
   * Skeleton rows mirror what will actually paint: the current page's row
   * count when the total is known, otherwise a full page — capped at the page
   * size — so loading fills the grid instead of stopping short of the footer.
   */
  const skeletonRows = Math.min(
    pageSize,
    total > 0 ? Math.max(to - from + 1, 1) : pageSize
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-2">{toolbarLeft}</div>
        <div className="flex items-center gap-2">
          {toolbarRight?.(selectedCount)}
          <Dropdown
            align="end"
            trigger={() => (
              <Button variant="ghost" size="icon" aria-label="Configure columns">
                <Settings2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
            panelClassName="max-h-72 overflow-auto ks-scroll"
          >
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">
              Columns
            </p>
            {table
              .getAllLeafColumns()
              .filter((c) => c.id !== "_select")
              .map((column) => (
                <label
                  key={column.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] text-body hover:bg-surface-sunken"
                >
                  <Checkbox
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                  />
                  {typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id}
                </label>
              ))}
          </Dropdown>
          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={onRefresh}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {/* table */}
      <div className="mx-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <div className="ks-scroll min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--border)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const align = header.column.columnDef.meta?.align ?? "left";
                    return (
                      <th
                        key={header.id}
                        style={{
                          width: header.getSize() !== 150 ? header.getSize() : undefined,
                        }}
                        className={cn(
                          /* No `uppercase` transform here: sortable headers sit
                             inside a <button> that ignores the inherited
                             transform, so a transform only hits non-sortable
                             headers (the old "RECEIVED" vs "PO Number" bug).
                             Title-case comes from the header strings. */
                          /* `last:pr-4` guarantees ~16px breathing room on the
                             final column so its content never kisses (or gets
                             clipped by) the card's right edge. */
                          "whitespace-nowrap px-3 py-2.5 last:pr-4 align-middle text-[12px] font-semibold tracking-[0.01em] text-faint",
                          align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1 transition-colors hover:text-secondary",
                              align === "right" && "flex-row-reverse"
                            )}
                          >
                            <span className={header.column.columnDef.meta?.headerClassName}>
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {/* 12px muted chevron (#94a3b8 = slate-400) marks the
                                actively sorted column and its direction. */}
                            {header.column.getIsSorted() === "asc" ? (
                              <ChevronUp className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                            ) : header.column.getIsSorted() === "desc" ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                            ) : null}
                          </button>
                        ) : (
                          <span className={header.column.columnDef.meta?.headerClassName}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                  <tr key={rowIndex} className={cn(rowH, "border-t border-border")}>
                    {table.getVisibleLeafColumns().map((col, colIndex) => (
                      <td key={col.id} className="px-3 last:pr-4">
                        {col.id === "_select" ? (
                          <div className="ks-skeleton h-3.5 w-3.5 rounded" aria-hidden />
                        ) : (
                          <div
                            className={cn(
                              "ks-skeleton h-3.5 rounded",
                              col.columnDef.meta?.align === "right" && "ml-auto"
                            )}
                            style={{ width: skeletonWidth(rowIndex, colIndex) }}
                            aria-hidden
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length}>
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                      <p className="text-[14px] font-semibold text-foreground">
                        Something went wrong
                      </p>
                      <p className="max-w-sm text-[12px] text-faint">{error}</p>
                      {onRetry ? (
                        <Button variant="secondary" size="sm" onClick={onRetry}>
                          Try again
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length}>
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-soft">
                        <Inbox className="h-5 w-5 text-faint" aria-hidden />
                      </span>
                      <p className="text-[14px] font-semibold text-foreground">
                        {emptyTitle}
                      </p>
                      <p className="max-w-sm text-[12px] text-faint">{emptyDescription}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      rowH,
                      "border-t border-border transition-colors",
                      onRowClick && "cursor-pointer",
                      row.getIsSelected() ? "bg-primary-soft/60" : "hover:bg-surface-sunken"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-3 last:pr-4 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              {(
                [
                  ["comfortable", "Large"],
                  ["compact", "Small"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDensity(key)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                    density === key
                      ? "bg-primary text-white"
                      : "text-secondary hover:bg-surface-sunken"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {onPageSizeChange ? (
              <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
            ) : null}
            {selectedCount > 0 ? (
              <span className="text-[11px] font-medium text-primary">
                {selectedCount} selected
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="First page"
              disabled={page <= 1}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span className="px-1 text-[12px] tabular-nums text-secondary">
              <span className="font-semibold text-foreground">{page}</span> / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Last page"
              disabled={page >= pageCount}
              onClick={() => onPageChange(pageCount)}
            >
              <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="success-outline"
              size="sm"
              onClick={() => exportCsv(data, columns, exportName)}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </Button>
            <span className="text-[12px] text-secondary">
              {from.toLocaleString()}–{to.toLocaleString()} of{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatNumber(total)}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
