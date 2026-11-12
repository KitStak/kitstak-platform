/**
 * Grid contracts (BUILD_PLAN F4.3). PURE TypeScript: imported by client components and
 * by `src/lib/grid-defs/<module>/**` definitions that the server also reads (export
 * columns, filter fields, sort keys). Do not import React or DOM APIs here.
 */
import type * as React from 'react';
import type { ColumnDef, RowData } from '@tanstack/react-table';
import { DENSITIES, GRID_PAGE_SIZES } from '@/lib/enums';

/* ---------------- filters ---------------- */

export const FILTER_FIELD_TYPES = ['enum', 'text', 'number', 'boolean', 'date'] as const;
export type FilterFieldType = (typeof FILTER_FIELD_TYPES)[number];

/** The text operators the field editor offers (Logiwa parity). "nin" is Exclude: none of the listed values. */
export const TEXT_FILTER_OPS = ['ct', 'eq', 'sw', 'ew', 'nin', 'ex', 'empty'] as const;
export type TextFilterOp = (typeof TEXT_FILTER_OPS)[number];

export const TEXT_FILTER_OP_LABELS: Readonly<Record<TextFilterOp, string>> = {
  ct: 'Contains',
  eq: 'Equals',
  sw: 'Starts With',
  ew: 'Ends With',
  nin: 'Exclude',
  ex: 'Is Not Empty',
  empty: 'Is Empty',
};

export interface FilterOptionDef {
  readonly value: string;
  readonly label: string;
}

export interface FilterFieldDef {
  /** Grid-query field name (`f.<field>`). */
  readonly field: string;
  readonly label: string;
  readonly type: FilterFieldType;
  /** Enum choices. */
  readonly options?: readonly FilterOptionDef[];
  /** Enum: offer an "Empty" choice (serialised as the `empty` op). */
  readonly allowEmpty?: boolean;
  /** Number: decimals allowed in Min/Max (default 0). */
  readonly decimals?: number;
  /** Optional grouping heading in the field list. */
  readonly group?: string;
  /** Shown under the label in the field list. */
  readonly description?: string;
  /** Part of the list's default filter preset: pinned at the top of the field list until the viewer pins their own. */
  readonly preset?: boolean;
}

/* ---------------- columns ---------------- */

export interface GridColumnMeta {
  /** Freeze the column at the grid's right edge. */
  sticky?: 'right';
  /** Frozen at the left edge by default (in addition to any user pins). */
  pinLeft?: boolean;
  /** Pinned left by default, but the user can unpin it in the column chooser (stored in grid prefs). */
  defaultPinned?: boolean;
  /** Plain-text label for the column chooser / export when `header` is not a string. */
  label?: string;
  /** Server sort field; defaults to the column id. Set `enableSorting: false` to disable. */
  sortKey?: string;
  /** Header `?` tooltip text. */
  headerTip?: string;
  /** Hidden until the user enables it in the column chooser. Default true. */
  defaultVisible?: boolean;
  /** Column can never be hidden (e.g. the primary-key link). */
  alwaysVisible?: boolean;
  /** Filter definition offered by the filter builder. */
  filter?: FilterFieldDef;
  /** Header alignment (cells align themselves). */
  align?: 'left' | 'right';
  /** Extra classes for the rendered header label. */
  headerClassName?: string;
  /**
   * Replaces the default cell padding (`px-3`) on both `th` and `td`; system columns use
   * `px-1` so a 24px control fits a 40px column.
   */
  cellPadding?: string;
  /** `false` turns off the default `overflow-hidden text-ellipsis` clipping (icons, pills). */
  clip?: boolean;
  /** Horizontal alignment of the cell content. */
  justify?: 'center';
}

declare module '@tanstack/react-table' {
  // Declaration merging requires an interface with TanStack's type params.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData extends RowData, TValue> extends GridColumnMeta {}
}

export type GridColumnDef<T> = ColumnDef<T, unknown>;

/* ---------------- row actions ---------------- */

export interface RowAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  /** Navigate instead of calling `onSelect`. */
  readonly href?: string;
  readonly onSelect?: () => void;
  readonly destructive?: boolean;
  /** When set the item is disabled and the reason shows as a tooltip. */
  readonly disabledReason?: string | null;
}

export interface BulkAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly onSelect: (ids: readonly string[]) => void;
  readonly destructive?: boolean;
  /** Extra disabled reason that applies even with a selection. */
  readonly disabledReason?: string | null;
  /**
   * Per-selection eligibility, e.g. status guards: return a reason ("Shipped orders
   * can't be cancelled") to disable the action for the current selection, or null.
   */
  readonly eligibility?: (ids: readonly string[]) => string | null;
  /** Override the default "Select at least one record" reason. */
  readonly emptyReason?: string;
  /** While true the action shows a spinner and is disabled ("Working…"). */
  readonly pending?: boolean;
  /** Short explanation: the button tooltip, or the sub-line in the Actions menu. */
  readonly info?: string;
}

/* ---------------- preferences ---------------- */

export type GridDensity = (typeof DENSITIES)[number];
export const GRID_DENSITIES: readonly GridDensity[] = DENSITIES;
export const DEFAULT_DENSITY: GridDensity = 'Small';

export type GridPageSize = (typeof GRID_PAGE_SIZES)[number];
export const PAGE_SIZE_OPTIONS: readonly number[] = GRID_PAGE_SIZES;

/** Shape stored in `user_grid_prefs.prefs` (schema/identity.ts `GridPrefs`) plus pinned columns. */
export interface GridPrefs {
  readonly visible: readonly string[];
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
  readonly density: GridDensity;
  readonly pageSize: number;
  readonly pinned?: readonly string[];
}

/** Rows are virtualised once a page holds more than this many rows. */
export const VIRTUALIZE_ABOVE = 200;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;
