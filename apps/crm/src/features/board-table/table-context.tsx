'use client';

/**
 * Render context shared by every row of one table: board, layout, users, actions and the
 * navigation helpers. Item data is passed to rows as props so memoized rows only re-render
 * when their own item changes.
 */
import { createContext, useContext } from 'react';
import type { CellBoard, CellDensity } from '@/features/cells';
import type { BoardDto, ColumnDto, GroupDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { TableActions } from './hooks/use-table-actions';
import type { TableLayout } from './lib/columns';
import type { BoardTableStateApi } from './state/use-board-table-state';

export type GridDirection = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev';

export interface OpenItemOptions {
  /** Open the item panel on a tab, e.g. 'updates'. */
  readonly tab?: 'updates' | 'files' | 'activity';
}

export interface TableContextValue {
  readonly boardId: string;
  readonly board: BoardDto;
  readonly cellBoard: CellBoard;
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly GroupDto[];
  readonly groupsById: ReadonlyMap<string, GroupDto>;
  readonly layout: TableLayout;
  readonly subLayout: TableLayout;
  readonly users: readonly UserSummaryDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly terminology: string;
  readonly canEdit: boolean;
  readonly density: CellDensity;
  readonly view: BoardTableStateApi;
  readonly actions: TableActions;
  /** Every loaded item (unfiltered) — summaries of the whole board, autofit, exports. */
  readonly allItems: readonly ItemDto[];
  /** Visible (filtered + sorted) item ids per group, in display order. */
  readonly visibleIdsByGroup: ReadonlyMap<string, readonly string[]>;
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
  /** Move keyboard focus from a cell of `rowKey` / `col` in a direction. */
  readonly navigate: (rowKey: string, col: number, direction: GridDirection) => void;
  readonly focusCell: (rowKey: string, col: number) => void;
  readonly openColumnCenter: (options?: {
    afterId?: string;
    scope?: 'item' | 'subitem';
    /** Focus target when the Column Center closes (defaults to the column / grid). */
    returnFocus?: HTMLElement | null;
  }) => void;
  readonly addColumn: (type: ColumnType, options?: { afterId?: string; scope?: 'item' | 'subitem' }) => void;
  readonly autoFit: (column: ColumnDto) => void;
  readonly autoFitAll: () => void;
  readonly exportItems: (itemIds: readonly string[], fileName: string) => void;
  readonly openMoveToBoard: (
    target: { kind: 'items'; itemIds: readonly string[] } | { kind: 'group'; group: GroupDto },
  ) => void;
  readonly confirmDeleteGroup: (group: GroupDto) => void;
  /** Scroll a group's header into view (then e.g. rename it there). */
  readonly revealGroup: (groupId: string) => void;
}

export const TableContext = createContext<TableContextValue | null>(null);

export function useTable(): TableContextValue {
  const value = useContext(TableContext);
  if (!value) throw new Error('useTable must be used inside <BoardTable>');
  return value;
}

export function groupColorVar(color: string | undefined): string {
  return `var(--label-${color || 'blue'})`;
}

export function groupTextVar(color: string | undefined): string {
  return `var(--label-${color || 'blue'}-text)`;
}
