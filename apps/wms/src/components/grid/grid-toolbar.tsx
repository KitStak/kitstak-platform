'use client';

/**
 * Grid toolbar (BUILD_PLAN 0.3): search mode (Equal / Starts With) + search box,
 * Filter ▾ (New/Saved), chips with +N overflow, Save filter, Views (save/apply), Clear
 * — all on one non-wrapping row — then bulk actions
 * (disabled with a reason until rows are selected), Refresh.
 *
 * Legacy `GridSearch` / `FilterButton` remain exported for pages not yet migrated.
 */
import * as React from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GridUrlState } from '@/lib/use-url-state';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { BulkActions } from './bulk-actions';
import { FilterChips } from './filter-builder/filter-chips';
import { FilterPopover } from './filter-builder/filter-popover';
import { SaveFilterButton, SavedViews } from './saved-views';
import { SearchMode } from './search-mode';
import type { BulkAction, FilterFieldDef } from './grid-types';
import type { SavedView, useSavedViews } from './use-saved-views';

export { FilterButton, GridSearch, type FilterOption } from './legacy-toolbar';

export const SEARCH_DEBOUNCE_MS = 300;

/** Search input that commits after a pause (or on Enter) so typing does not refetch per key. */
export function DebouncedSearch({
  value,
  onCommit,
  placeholder,
  className,
  leading,
}: {
  readonly value: string;
  readonly onCommit: (q: string) => void;
  readonly placeholder: string;
  readonly className?: string;
  readonly leading?: React.ReactNode;
}) {
  const [text, setText] = React.useState(value);
  const [synced, setSynced] = React.useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const commitRef = React.useRef(onCommit);
  React.useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  React.useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => commitRef.current(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, value]);

  return (
    <div className={cn('flex items-center', className)}>
      {leading}
      {/* Phones: the box stretches to the row (the toolbar collapses to search + filter). */}
      <div className="relative min-w-0 flex-1 md:flex-none">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(text);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            'h-8 w-full min-w-0 text-ellipsis border border-border-strong/70 bg-surface pl-8 pr-7 text-sm text-body placeholder:text-faint transition-colors hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 md:w-64 [&::-webkit-search-cancel-button]:hidden',
            leading ? 'rounded-r-md' : 'rounded-md',
          )}
        />
        {text ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('');
              onCommit('');
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-secondary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface GridToolbarProps {
  readonly grid: GridUrlState;
  readonly fields: readonly FilterFieldDef[];
  readonly searchPlaceholder?: string;
  readonly views?: ReturnType<typeof useSavedViews>;
  readonly activeViewId?: string | null;
  readonly onApplyView?: (view: SavedView) => void;
  readonly bulkActions?: readonly BulkAction[];
  readonly selectedIds?: readonly string[];
  readonly bulkNoun?: string;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** Extra controls rendered before Refresh (e.g. primary CTA, column chooser). */
  readonly trailing?: React.ReactNode;
  /** Bulk actions rendered as buttons before the rest collapse into "Actions" (default 2; 0 = all in the menu). */
  readonly bulkInline?: number;
}

export function GridToolbar({
  grid,
  fields,
  searchPlaceholder = 'Search',
  views,
  activeViewId,
  onApplyView,
  bulkActions = [],
  selectedIds = [],
  bulkNoun,
  onRefresh,
  refreshing,
  trailing,
  bulkInline,
}: GridToolbarProps) {
  const { query } = grid;
  const hasState = Boolean(query.q) || query.filters.length > 0 || query.sort.length > 0;
  const applyView = (view: SavedView) => onApplyView?.(view);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-6 py-2 md:py-3">
      {/* basis keeps the filter group from being squeezed under `trailing`: below ~28rem of room, trailing wraps to its own row. */}
      <div className="flex min-w-0 flex-1 basis-[16rem] flex-wrap items-center gap-2 md:basis-[28rem]">
        <DebouncedSearch
          value={query.q ?? ''}
          onCommit={(q) => grid.setSearch(q)}
          placeholder={searchPlaceholder}
          // Phones: search grows to fill the single toolbar row; desktop keeps its fixed box.
          className="min-w-0 flex-1 md:flex-none"
          leading={<SearchMode value={query.qm} onChange={(qm) => grid.setQuery({ qm })} />}
        />
        <FilterPopover
          gridKey={grid.gridKey}
          fields={fields}
          filters={query.filters}
          onApply={grid.upsertFilter}
          savedViews={views?.views}
          onApplyView={applyView}
        />
        {/* Phones keep one row: chips and saved views live behind the filter icon's badge. */}
        <span className="hidden md:contents">
          <FilterChips
            gridKey={grid.gridKey}
            fields={fields}
            filters={query.filters}
            onRemove={grid.removeFilter}
            onApply={grid.upsertFilter}
            savedViews={views?.views}
          />
          {views && query.filters.length > 0 ? (
            <SaveFilterButton api={views} query={grid.queryString} activeViewId={activeViewId} />
          ) : null}
          {views ? (
            <SavedViews api={views} query={grid.queryString} activeViewId={activeViewId} onApply={applyView} />
          ) : null}
          {hasState ? (
            <Button variant="ghost" className="shrink-0" onClick={grid.reset}>
              Clear
            </Button>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <BulkActions actions={bulkActions} selectedIds={selectedIds} noun={bulkNoun} inline={bulkInline} />
        {trailing}
        {onRefresh ? (
          // Phones reach Refresh through the page's overflow menu; the icon stays desktop-only.
          <Tooltip content="Refresh">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={onRefresh}
              className="max-md:hidden"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
