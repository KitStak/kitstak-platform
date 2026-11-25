'use client';
/**
 * Extra slots the shared views render when a page supplies them (docs/programs/SPEC.md 5.7).
 * Programs use it to show build facts (variant, qty progress, revenue, run grouping, the Done
 * fold, build menu items, build table columns) without forking the views. Projects mount
 * nothing and every slot is empty.
 *
 *   <CardExtrasProvider value={{ renderCardFooter, renderRowCells, extraColumns, groupings, foldBefore }}>
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { TaskSummary } from '@/lib/types';
import type { ColumnDef } from '@/features/table/table-columns';
import type { GroupInfo } from './group-meta';
import type { DisplayToggle } from './display-menu';
import type { Swimlane } from './view-state';

/** Menu parts so extras can render items in both the dropdown and the context menu. */
export interface ExtraMenuParts {
  readonly kind: 'dropdown' | 'context';
}

/** A grouping the page adds to List and Table ("Run", "Day", "Variant"). */
export interface ExtraGrouping {
  readonly value: string;
  readonly label: string;
  /** The group key of a task. */
  keyOf(task: TaskSummary): string;
  /** Group keys in display order for these tasks. */
  order(tasks: readonly TaskSummary[]): readonly string[];
  info(key: string, tasks: readonly TaskSummary[]): GroupInfo & { readonly meta?: ReactNode; readonly actions?: ReactNode };
}

/** A swimlane the page adds to the Board ("Variant", "Day"). */
export interface ExtraLane {
  readonly value: string;
  readonly label: string;
  keyOf(task: TaskSummary): string;
  order(tasks: readonly TaskSummary[]): readonly string[];
  info(key: string): GroupInfo;
  /** Moves a dropped card into lane `key` (change its variant or day). Returns false to refuse. */
  move?(task: TaskSummary, key: string): boolean;
}

/** A card order the page adds ("Day", "Variant order", "Remaining qty"). */
export interface ExtraOrder {
  readonly value: string;
  readonly label: string;
  compare(a: TaskSummary, b: TaskSummary): number;
}

/** Display menu additions (docs/programs/SPEC.md 5.7). */
export interface ExtraDisplay {
  /** Extra "Show" toggles (Qty progress, Revenue, Rate, Variant chip, SKU). */
  readonly toggles?: readonly DisplayToggle[];
  /** Board swimlanes the page adds, and which shared lanes still make sense. */
  readonly lanes?: readonly ExtraLane[];
  readonly sharedLanes?: readonly Swimlane[];
  readonly lane?: string | null;
  onLaneChange?(value: string | null): void;
  /** Card and row orders the page adds; when one is on it replaces the shared order. */
  readonly orders?: readonly ExtraOrder[];
  readonly order?: string | null;
  onOrderChange?(value: string | null): void;
  /** Board: empty columns fold to a thin rail so every column with cards fits on screen. */
  readonly collapseEmptyColumns?: boolean;
}

/** A category the page adds to the single Filter of its toolbar (Variant, Short, Work type). */
export interface ExtraFilterCategory {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** `lead`: right after Search; `trail`: after Labels. */
  readonly placement: 'lead' | 'trail';
  /** Chip text when it is on ("Variant: Small Brown"), else null. */
  readonly chip: string | null;
  clear(): void;
  /** The panel body (an option list). */
  render(): ReactNode;
}

export interface CardExtrasValue {
  /** Categories for the single Filter of page toolbars (Variant, Short, Unplanned, Work type). */
  readonly filterCategories?: readonly ExtraFilterCategory[];
  /** Turns every page category off at once ("Clear all"). */
  readonly clearExtraFilters?: () => void;
  /** Display menu additions. */
  readonly display?: ExtraDisplay;
  /** Content at the start of the view toolbar row (view toggle, date range). */
  readonly toolbarLead?: ReactNode;
  /** Content at the end of the view toolbar row (More menu). */
  readonly toolbarTrail?: ReactNode;
  /** A filter applied on top of the shared filters (variant, short, unplanned, work type). */
  readonly filter?: (task: TaskSummary) => boolean;
  /** How many extra filters are on (counts toward "Clear filters"). */
  readonly extraFilterCount?: number;
  /** Board card footer under the shared card body. */
  readonly renderCardFooter?: (task: TaskSummary) => ReactNode;
  /** List row cells before the status cell, and their header labels. */
  readonly renderRowCells?: (task: TaskSummary) => ReactNode;
  readonly rowCellsHeader?: ReactNode;
  /** Bulk bar actions placed first (Log output, Move to day, Set planned qty, Change variant, Cancel). */
  readonly renderBulkActions?: (ids: readonly string[], clear: () => void) => ReactNode;
  /** Menu items placed first in the task menus (build items). */
  readonly renderMenuItems?: (task: TaskSummary, parts: ExtraMenuParts) => ReactNode;
  /** Menu items placed last under "Danger" (Cancel build, Delete build). */
  readonly renderMenuDanger?: (task: TaskSummary, parts: ExtraMenuParts) => ReactNode;
  /** Hides shared task menu items that do not apply ("Move to project", "Delete" when it has output). */
  readonly hideTaskMenuItems?: (task: TaskSummary) => readonly ('duplicate' | 'move' | 'delete' | 'due')[];
  /** Extra table columns (shown by default), and shared columns to hide until someone turns them on. */
  readonly extraColumns?: readonly ColumnDef[];
  readonly defaultHiddenColumns?: readonly string[];
  /** Extra groupings for List and Table; `defaultGrouping` picks one when the URL has none. */
  readonly groupings?: readonly ExtraGrouping[];
  readonly grouping?: string | null;
  readonly onGroupingChange?: (value: string | null) => void;
  /** Board: done cards for which this is true fold into "Done earlier (n)". */
  readonly foldBefore?: (task: TaskSummary) => boolean;
  /** Calendar: what a day shows above its chips ("8 builds · 800 kits" with a ring). */
  readonly renderDaySummary?: (date: string, tasks: readonly TaskSummary[]) => ReactNode;
  /** Calendar: content of the day popover (runs and quick log inputs). */
  readonly renderDayPopover?: (date: string, tasks: readonly TaskSummary[]) => ReactNode;
  /** Refuses a date move (locked days); returns the reason to show. */
  readonly refuseDate?: (task: TaskSummary, date: string) => string | null;
  /** Moves a page item (a build) to another day; the shared date patch is used otherwise. */
  readonly moveToDate?: (task: TaskSummary, date: string) => Promise<boolean>;
  /**
   * Calendar: the page's date range. The calendar opens on `from`, follows it when it moves, and
   * reports the month or week it shows so the range always matches the grid.
   */
  readonly calendarRange?: { readonly from: string; onVisibleChange(from: string, to: string): void };
  /** Calendar week rows: a short label for an item inside its row ("GLOVE-212 · 60 of 100"). */
  readonly calendarChipLabel?: (task: TaskSummary) => string;
  /** Timeline: row group of a task (variant) when the page wants its own rows. */
  readonly timelineGroup?: { readonly label: string; keyOf(task: TaskSummary): string; title(key: string): string; order(tasks: readonly TaskSummary[]): readonly string[] };
  /** Empty state for the view when nothing is in range. */
  readonly renderEmpty?: () => ReactNode;
  /** The noun people see ("build" or "task"). */
  readonly noun?: { readonly singular: string; readonly plural: string };
  /** Hide the shared "add task" entry points (programs add builds through their own flows). */
  readonly hideCreate?: boolean;
}

const CardExtrasContext = createContext<CardExtrasValue | null>(null);

export function CardExtrasProvider({ value, children }: { readonly value: CardExtrasValue; readonly children: ReactNode }) {
  return <CardExtrasContext.Provider value={value}>{children}</CardExtrasContext.Provider>;
}

/** The extras of the page, or an empty object on project pages. */
export function useCardExtras(): CardExtrasValue {
  return useContext(CardExtrasContext) ?? EMPTY;
}

const EMPTY: CardExtrasValue = {};
