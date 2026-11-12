/**
 * Board main table.
 *
 *   const table = useBoardTableState(boardId, view);   // toolbar: search, filters, sort, hide, density
 *   <div className="flex min-h-0 flex-1 flex-col">     // bounded height: the table scrolls inside
 *     <BoardTable boardId={boardId} view={view} onOpenItem={(id, { tab }) => openPanel(id, tab)} />
 *   </div>
 *
 * The toolbar and the table share state through `useBoardTableState(boardId, view)`: with a saved
 * view it reads/writes the view config (optimistic), otherwise a per-board session store.
 */
export { BoardTable, type BoardTableProps } from './board-table';
export { useBoardTableState, type BoardTableStateApi } from './state/use-board-table-state';
export type { OpenItemOptions } from './table-context';
export {
  DEFAULT_VIEW_STATE,
  FILTER_OPERATORS,
  hasActiveFilters,
  parseViewConfig,
  type FilterGroup,
  type FilterOperator,
  type FilterRule,
  type SortRule,
  type TableViewState,
} from './lib/view-state';
export { filterItems, sortItems } from './lib/filter-sort';
export { cellText, toCsv } from './lib/cell-text';
export { countLabel, plural, pluralize } from './lib/terminology';
export { ColumnCenter, AddColumnButton, QUICK_COLUMN_TYPES } from './components/column-center';
