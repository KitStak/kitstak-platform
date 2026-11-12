'use client';

/**
 * Toolbar: Add widget (split), connected boards, search, person, date range, refresh, present.
 * One row at every width: below ~900px of toolbar width the search, person and date filters
 * collapse into a single "Filters" popover. The Clear slot is always reserved so activating a
 * filter never reflows the toolbar or shifts the grid.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, FilterX, LayoutGrid, ListFilter, Lock, Plus, RefreshCw, Tv } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  SplitButton,
  Tooltip,
  cn,
} from '@/components/ui';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import type { DashboardSourceBoard, WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { QUICK_WIDGETS, widgetDefinition } from '../lib/catalog';
import { activeFilterCount, isFiltered, type DashboardFilterState } from '../lib/filters';
import { useElementSize } from '../widgets/use-element-size';
import { BoardsPicker, DateRangeFilter, PersonFilter } from './toolbar-filters';

/** Toolbar width below which the filters collapse into one popover. */
const COMPACT_TOOLBAR = 900;
/** Toolbar width from which "Updated x ago" has room. */
const SHOW_UPDATED = 1100;

export interface DashboardToolbarProps {
  readonly canEdit: boolean;
  readonly locked: boolean;
  readonly boards: readonly DashboardSourceBoard[];
  readonly connected: readonly string[];
  readonly autoInclude: boolean;
  readonly users: readonly UserSummaryDto[];
  readonly filters: DashboardFilterState;
  readonly refreshing: boolean;
  readonly lastUpdated: number;
  /** Number of widgets whose last refresh failed (they keep showing older data). */
  readonly failedCount?: number;
  readonly onAddWidget: (kind: WidgetKind | null) => void;
  readonly onBoardsChange: (ids: string[]) => void;
  readonly onAutoIncludeChange: (value: boolean) => void;
  readonly onFiltersChange: (next: DashboardFilterState) => void;
  readonly onRefresh: () => void;
  readonly onPresent: () => void;
  readonly onUnlock: () => void;
}

function useRelativeTime(timestamp: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!timestamp) return null;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'Updated just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.round(minutes / 60)} h ago`;
}

function AddWidgetButton({ short, onAddWidget }: { readonly short: boolean; readonly onAddWidget: (kind: WidgetKind | null) => void }) {
  return (
    <SplitButton
      leadingIcon={<Plus />}
      onClick={() => onAddWidget(null)}
      menuLabel="Quick add widget"
      renderMenu={(trigger) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[300px]">
            <DropdownMenuLabel>Quick add</DropdownMenuLabel>
            {QUICK_WIDGETS.map((kind) => {
              const definition = widgetDefinition(kind);
              const Icon = definition.icon;
              return (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() => onAddWidget(kind)}
                  icon={
                    <span className="flex size-6 items-center justify-center rounded-sm [&_svg]:!size-3.5" style={{ background: `var(--label-${definition.tone}-subtle)`, color: `var(--label-${definition.tone})` }}>
                      <Icon />
                    </span>
                  }
                  description={definition.description}
                >
                  {definition.label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<LayoutGrid />} onSelect={() => onAddWidget(null)}>
              More widgets…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      <span data-testid="add-widget">{short ? 'Add' : 'Add widget'}</span>
    </SplitButton>
  );
}

export function DashboardToolbar(props: DashboardToolbarProps) {
  const { canEdit, filters, onFiltersChange } = props;
  const [ref, size] = useElementSize<HTMLDivElement>();
  const compact = size.width > 0 && size.width < COMPACT_TOOLBAR;
  const [search, setSearch] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  if (syncedSearch !== filters.search) {
    // URL changed (back/forward, Clear): adopt it without an effect.
    setSyncedSearch(filters.search);
    setSearch(filters.search);
  }
  const updated = useRelativeTime(props.lastUpdated);
  useEffect(() => {
    if (search === filters.search) return;
    const id = window.setTimeout(() => onFiltersChange({ ...filters, search }), 300);
    return () => window.clearTimeout(id);
  }, [search, filters, onFiltersChange]);
  const filtered = isFiltered(filters);
  const count = activeFilterCount(filters);
  const clear = () => {
    setSearch('');
    onFiltersChange({ range: 'all', personIds: [], search: '' });
  };

  const searchInput = (
    <SearchInput
      value={search}
      onValueChange={setSearch}
      placeholder="Search items"
      aria-label="Search items in every widget"
      containerClassName={compact ? 'w-full' : 'w-44 min-w-[7.5rem] shrink'}
      data-testid="dashboard-search"
    />
  );
  const person = <PersonFilter users={props.users} selected={filters.personIds} onChange={(personIds) => onFiltersChange({ ...filters, personIds })} />;
  const date = (
    <DateRangeFilter
      state={filters}
      onChange={(range) => onFiltersChange({ ...filters, ...range, ...(range.range !== 'custom' ? { from: undefined, to: undefined } : {}) })}
    />
  );

  return (
    <div
      ref={ref}
      className="flex flex-nowrap items-center gap-2"
      role="toolbar"
      aria-label="Dashboard tools"
      data-testid="dashboard-toolbar"
      data-compact={compact || undefined}
    >
      {canEdit ? <AddWidgetButton short={compact && size.width < 420} onAddWidget={props.onAddWidget} /> : null}
      <BoardsPicker
        boards={props.boards}
        connected={props.connected}
        canEdit={canEdit}
        autoInclude={props.autoInclude}
        onChange={props.onBoardsChange}
        onAutoIncludeChange={props.onAutoIncludeChange}
      />
      {compact ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="dashboard-filters"
              aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-base outline-none transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-4',
                count > 0 ? 'border-primary bg-primary-subtle text-primary-text hover:bg-primary-selected' : 'border-border-input bg-panel text-fg hover:bg-muted',
              )}
            >
              <ListFilter aria-hidden />
              Filters
              {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-fg">{count}</span> : null}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(320px,calc(100vw-32px))]">
            <div className="flex flex-col gap-3">
              {searchInput}
              <div className="flex flex-wrap items-center gap-2">
                {person}
                {date}
              </div>
              {filtered ? (
                <Button variant="ghost" size="sm" leadingIcon={<FilterX />} onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border-subtle" />
          {searchInput}
          {person}
          {date}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<FilterX />}
            onClick={clear}
            className={cn('shrink-0', !filtered && 'invisible')}
            aria-hidden={filtered ? undefined : true}
            tabIndex={filtered ? undefined : -1}
            data-testid="dashboard-clear-filters"
          >
            Clear
          </Button>
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {canEdit && props.locked ? (
          <Tooltip content="Layout is locked. Click to unlock.">
            <Button variant="ghost" size="sm" leadingIcon={<Lock />} onClick={props.onUnlock} aria-label="Layout locked, click to unlock">
              {compact ? null : 'Locked'}
            </Button>
          </Tooltip>
        ) : null}
        {size.width >= SHOW_UPDATED ? (
          <span className="flex w-[112px] justify-end text-xs text-fg-muted" aria-live="polite" data-testid="dashboard-updated">
            {updated ?? <span aria-label="Loading" className="h-3 w-20 animate-pulse rounded-sm bg-skeleton" />}
          </span>
        ) : null}
        {props.failedCount && !props.refreshing ? (
          <Tooltip content={`${props.failedCount} widget${props.failedCount === 1 ? '' : 's'} could not refresh and show older data`}>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<AlertTriangle className="text-warning" />}
              onClick={props.onRefresh}
              data-testid="dashboard-refresh-failed"
              className="text-fg"
            >
              {compact ? 'Retry' : 'Refresh failed · Retry'}
            </Button>
          </Tooltip>
        ) : null}
        <IconButton label="Refresh all widgets" icon={<RefreshCw className={cn(props.refreshing && 'animate-spin')} />} onClick={props.onRefresh} data-testid="dashboard-refresh" />
        <IconButton label="Present (TV mode)" icon={<Tv />} onClick={props.onPresent} shortcut={['P']} data-testid="dashboard-present" />
      </div>
    </div>
  );
}
