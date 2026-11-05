"use client";

import * as React from "react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
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
import { Skeleton } from "@/components/ui/card";
import type { DataGridProps, Density } from "@/components/grid/data-grid";

/**
 * Page-local fork of the shared DataGrid (src/components/grid/data-grid.tsx,
 * read-only from this page) carrying two footer fixes pending upstream:
 *
 * 1. The native page-size <select> (the page's last stock browser control)
 *    is replaced with the styled Dropdown pattern already used in
 *    src/components/receiving/po-grid.tsx — appearance-none trigger, h-7,
 *    rounded-md, border-border, lucide ChevronDown at right-1.5.
 * 2. While rows are loading, the footer no longer claims "0–0 of 0" and
 *    "1 / 1": the range text renders as a 60x12px skeleton bar and the page
 *    indicator shows "— / —" with pagination disabled.
 *
 * Once both land in the shared DataGrid, this fork should be deleted and
 * the locations page pointed back at it. Everything else matches the
 * shared grid so the locations CSS module keeps applying.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function PageSizeDropdown({
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
            "relative inline-flex h-7 appearance-none items-center rounded-md border border-border bg-surface pl-1.5 pr-7",
            "text-[11px] font-medium text-secondary transition-colors",
            "hover:bg-surface-sunken hover:text-body",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
            open && "border-border-strong text-body"
          )}
        >
          Show {pageSize} items
          <ChevronDown
            className={cn(
              "absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary transition-transform",
              open && "rotate-180"
            )}
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

export function LocationsDataGrid<T>({
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
}: DataGridProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
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
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className="whitespace-nowrap px-3 py-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.04em] text-faint"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 transition-colors hover:text-secondary"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp className="h-3 w-3 text-primary" aria-hidden />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown className="h-3 w-3 text-primary" aria-hidden />
                          ) : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className={cn(rowH, "border-t border-border")}>
                    {table.getVisibleLeafColumns().map((col) => (
                      <td key={col.id} className="px-3">
                        <Skeleton className="h-3.5 w-[70%]" />
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
                      <td key={cell.id} className="whitespace-nowrap px-3 align-middle">
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
              <PageSizeDropdown
                pageSize={pageSize}
                onPageSizeChange={onPageSizeChange}
              />
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
              disabled={loading || page <= 1}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={loading || page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            {loading ? (
              // Mid-load the dataset size is unknown; never claim "1 / 1".
              <span className="px-1 text-[12px] tabular-nums text-faint">
                — / —
              </span>
            ) : (
              <span className="px-1 text-[12px] tabular-nums text-secondary">
                <span className="font-semibold text-foreground">{page}</span> / {pageCount}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={loading || page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Last page"
              disabled={loading || page >= pageCount}
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
            {loading ? (
              // Skeleton in place of the range text: mid-load the footer
              // must not contradict the row skeletons with "0–0 of 0".
              <Skeleton className="h-3 w-[60px]" />
            ) : (
              <span className="text-[12px] text-secondary">
                {from.toLocaleString()}–{to.toLocaleString()} of{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatNumber(total)}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
