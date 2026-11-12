"use client";

/**
 * System columns (select, expand, kebab) and placement helpers shared by the grid
 * header and body: pinned-left offsets, sticky-right placement, sort field lookup.
 */
import * as React from "react";
import type { Column, ColumnDef, Table } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox, type CheckedState } from "@/components/ui/checkbox";
import type { RowAction } from "./grid-types";
import { RowMenu } from "./row-menu";

export const SELECT_COLUMN_ID = "_select";
export const EXPAND_COLUMN_ID = "_expand";
export const ACTIONS_COLUMN_ID = "_actions";
export const SYSTEM_COLUMN_IDS: readonly string[] = [SELECT_COLUMN_ID, EXPAND_COLUMN_ID, ACTIONS_COLUMN_ID, "_gutter"];
export const SELECT_COLUMN_WIDTH = 40;
export const EXPAND_COLUMN_WIDTH = 40;
export const ACTIONS_COLUMN_WIDTH = 44;
const SYSTEM_CELL_META = { cellPadding: "px-1", clip: false, justify: "center" } as const;

export function isSystemColumn(id: string): boolean {
  return SYSTEM_COLUMN_IDS.includes(id);
}

export function columnLabel<T>(def: ColumnDef<T, unknown>, fallback: string): string {
  if (def.meta?.label) return def.meta.label;
  return typeof def.header === "string" ? def.header : fallback;
}

export function sortFieldOf<T>(column: Column<T, unknown>): string {
  return column.columnDef.meta?.sortKey ?? column.id;
}

/** Header checkbox state for the current page. */
export function pageSelectionState(pageIds: readonly string[], selected: Readonly<Record<string, boolean>>): CheckedState {
  if (pageIds.length === 0) return false;
  const count = pageIds.filter((id) => selected[id]).length;
  if (count === 0) return Object.values(selected).some(Boolean) ? "indeterminate" : false;
  return count === pageIds.length ? true : "indeterminate";
}

const subscribeNoop = () => () => undefined;

/**
 * Page "select all" checkbox. Mounted only after hydration: Radix serialises the hidden
 * bubble input's inline style differently on the server and the client, which logged a
 * hydration mismatch on every grid page. The placeholder keeps the cell width stable.
 */
function HeaderSelectAll<T>({ table }: { readonly table: Table<T> }) {
  const hydrated = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!hydrated) return <span aria-hidden className="inline-block h-4 w-4" />;
  const pageIds = table.getRowModel().rows.map((r) => r.id);
  const state = pageSelectionState(pageIds, table.getState().rowSelection);
  return (
    <Checkbox
      aria-label={state === true ? "Deselect all rows on this page" : "Select all rows on this page"}
      checked={state}
      disabled={pageIds.length === 0}
      onCheckedChange={() => table.toggleAllPageRowsSelected(state !== true)}
    />
  );
}

/** Empty sticky-right column that reserves room for the floating column chooser (no kebab column). */
export const GUTTER_COLUMN_ID = "_gutter";
export const GUTTER_COLUMN_WIDTH = 40;

export function gutterColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: GUTTER_COLUMN_ID,
    size: GUTTER_COLUMN_WIDTH,
    minSize: GUTTER_COLUMN_WIDTH,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    header: () => <span className="sr-only">Column options</span>,
    cell: () => null,
    meta: { ...SYSTEM_CELL_META, sticky: "right" },
  };
}

export function selectColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: SELECT_COLUMN_ID,
    size: SELECT_COLUMN_WIDTH,
    minSize: SELECT_COLUMN_WIDTH,
    meta: { cellPadding: "px-3", clip: false },
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    header: ({ table }) => <HeaderSelectAll table={table} />,
    cell: ({ row }) => (
      <span onClick={(e) => e.stopPropagation()} className="inline-flex">
        <Checkbox aria-label="Select row" checked={row.getIsSelected()} disabled={!row.getCanSelect()} onCheckedChange={(c) => row.toggleSelected(c === true)} />
      </span>
    ),
  };
}

export function expandColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: EXPAND_COLUMN_ID,
    size: EXPAND_COLUMN_WIDTH,
    minSize: EXPAND_COLUMN_WIDTH,
    meta: SYSTEM_CELL_META,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    header: () => <span className="sr-only">Expand</span>,
    cell: ({ row }) => (
      <button
        type="button"
        aria-label={row.getIsExpanded() ? "Collapse row" : "Expand row"}
        aria-expanded={row.getIsExpanded()}
        onClick={(e) => {
          e.stopPropagation();
          row.toggleExpanded();
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-secondary hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", row.getIsExpanded() && "rotate-90")} aria-hidden />
      </button>
    ),
  };
}

export function actionsColumn<T>(rowActions: (row: T) => readonly RowAction[]): ColumnDef<T, unknown> {
  return {
    id: ACTIONS_COLUMN_ID,
    size: ACTIONS_COLUMN_WIDTH,
    minSize: ACTIONS_COLUMN_WIDTH,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowMenu actions={rowActions(row.original)} />,
    meta: { ...SYSTEM_CELL_META, sticky: "right" },
  };
}

export interface CellPlacement {
  readonly style: React.CSSProperties;
  readonly className: string;
  readonly sticky: boolean;
}

function explicitWidth<T>(column: Column<T, unknown>, table: Table<T>): boolean {
  return (
    column.columnDef.size !== undefined ||
    column.getIsPinned() !== false ||
    isSystemColumn(column.id) ||
    table.getState().columnSizing[column.id] !== undefined
  );
}

/**
 * Width + sticky placement. Pinned-left columns stick at their cumulative offset;
 * `meta.sticky === "right"` columns stick at the right edge (the kebab column sits at
 * 0, a legacy sticky column sits left of it via `stickyRightOffset`).
 */
export function cellPlacement<T>(column: Column<T, unknown>, table: Table<T>, stickyRightOffset: number): CellPlacement {
  const width = column.getSize();
  const fixed = explicitWidth(column, table);
  const base: React.CSSProperties = fixed ? { width, minWidth: width, maxWidth: width } : {};
  if (column.getIsPinned() === "left") {
    return {
      style: { ...base, left: column.getStart("left") },
      className: cn("sticky z-[2]", column.getIsLastColumn("left") && "shadow-[inset_-1px_0_0_var(--border)]"),
      sticky: true,
    };
  }
  if (column.columnDef.meta?.sticky === "right") {
    const right = column.id === ACTIONS_COLUMN_ID || column.id === GUTTER_COLUMN_ID ? 0 : stickyRightOffset;
    // Left-edge scrim as a positioned ::before gradient (a box-shadow on a sticky td is painted under the
    // neighbouring cell's content in Chrome), so scrolled content fades out instead of being cut hard.
    return {
      style: { ...base, right },
      className:
        "sticky z-[2] shadow-[inset_1px_0_0_var(--border)] before:pointer-events-none before:absolute before:inset-y-0 before:-left-3 before:w-3 before:bg-gradient-to-l before:from-[var(--surface)] before:to-transparent before:content-['']",
      sticky: true,
    };
  }
  return { style: base, className: "", sticky: false };
}

/**
 * Offset legacy sticky-right columns need when the kebab column (or the column-chooser gutter, which
 * also sticks at right 0) is present, so a page's own sticky column is not painted under it.
 */
export function stickyRightOffsetFor<T>(table: Table<T>): number {
  const visible = table.getVisibleLeafColumns();
  if (visible.some((c) => c.id === ACTIONS_COLUMN_ID)) return ACTIONS_COLUMN_WIDTH;
  if (visible.some((c) => c.id === GUTTER_COLUMN_ID)) return GUTTER_COLUMN_WIDTH;
  return 0;
}
