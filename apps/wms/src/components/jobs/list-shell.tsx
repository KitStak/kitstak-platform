'use client';

/**
 * Shared list-page shell for the M03 grids: page header + route tabs, the shared grid toolbar
 * (Equal / Starts With search, typed filters, chips, saved views, refresh), the DataGrid
 * (column chooser, density, page sizes, async Excel export) and a default filter chip.
 * Grid state lives in the URL, so render inside <Suspense>.
 */
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataGrid, GridToolbar, useGrid, type FilterFieldDef, type RowAction } from '@/components/grid';
import { PageHeader, type Crumb } from '@/components/layout/page-header';
import type { PageTabGroupKey } from '@/config/page-tabs';
import type { GridFilter } from '@/server/query/grid-query';
import type { GridRow } from './jobs-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';

/** One-click toggle filter shown above the grid, with a live count (critic R5: "Overdue"). */
export interface QuickFilter {
  readonly key: string;
  readonly label: string;
  readonly filter: GridFilter;
  /** Query string used for the live count badge (pageSize=1). */
  readonly countQuery?: string;
  readonly tone?: 'danger' | 'neutral';
}

export interface ListShellContext<T> {
  readonly selected: readonly T[];
  /** Refetches the grid; clears the selection unless `keepSelection` (non-destructive bulk updates keep it, as Logiwa does). */
  readonly refresh: (opts?: { readonly keepSelection?: boolean }) => void;
  readonly rows: readonly T[];
}

export interface ListShellProps<T extends GridRow> {
  readonly title: string;
  readonly helper?: string;
  readonly tabs?: PageTabGroupKey;
  readonly actions?: React.ReactNode;
  readonly banner?: React.ReactNode;
  readonly gridKey: string;
  readonly path: string;
  readonly fields: readonly FilterFieldDef[];
  readonly extraQuery?: Readonly<Record<string, string>>;
  readonly columns: ColumnDef<T, unknown>[];
  readonly exportColumns: readonly { readonly key: string; readonly label: string }[];
  readonly searchPlaceholder: string;
  readonly defaultFilters?: readonly GridFilter[];
  readonly trailing?: (ctx: ListShellContext<T>) => React.ReactNode;
  readonly rowActions?: (row: T, ctx: ListShellContext<T>) => readonly RowAction[];
  readonly rowHref?: (row: T) => string | null;
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: React.ReactNode;
  readonly selectable?: boolean;
  /** Lets the page re-render live cells (e.g. countdowns) without refetching. */
  readonly children?: (ctx: ListShellContext<T>) => React.ReactNode;
  readonly noun: string;
  /** Explicit crumbs; the "jobs" tab group defaults to a stable Fulfillment > Jobs > <title> trail. */
  readonly breadcrumbs?: readonly Crumb[];
  readonly quickFilters?: readonly QuickFilter[];
}

function QuickFilterButton({
  qf,
  path,
  active,
  onToggle,
}: {
  readonly qf: QuickFilter;
  readonly path: string;
  readonly active: boolean;
  readonly onToggle: () => void;
}) {
  const countQ = useApiQuery<unknown[]>(
    ['grid', 'quick', path, qf.key],
    qf.countQuery ? `${path}?${qf.countQuery}&pageSize=1` : null,
    { timeoutMs: 30_000, retry: false },
  );
  const n = countQ.data?.meta?.total;
  const danger = qf.tone === 'danger' && typeof n === 'number' && n > 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      data-testid={`quick-filter-${qf.key}`}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        active
          ? 'border-primary bg-primary text-white'
          : danger
            ? 'border-[#F2B8AE] bg-[#FDF1EE] text-[var(--danger-text)] hover:bg-[#FBE3DD] dark:border-[#6B2A20] dark:bg-[#2B1612] dark:text-[var(--label-red-light)]'
            : 'border-border bg-surface text-body hover:bg-surface-sunken',
      )}
    >
      {qf.label}
      {typeof n === 'number' ? (
        <span
          className={cn(
            'rounded-full px-1.5 text-2xs tabular-nums',
            active ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10',
          )}
        >
          {n.toLocaleString('en-US')}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Toolbar legibility (critic R2-2): filter chips never shrink below a readable width; when a
 * page has bulk actions the toolbar puts them on their own row below 1600px instead of
 * squeezing the "Job status" chip, and the search box narrows on tablets.
 */
const JOBS_SHELL_CSS = `
[data-ks-jobs-shell] [aria-label="Applied filters"] > span { min-width: 150px; }
[data-ks-jobs-shell] [aria-label="Applied filters"] { flex-shrink: 0; max-width: 60%; }
@media (max-width: 1599px) { [data-ks-jobs-shell="actions"] .basis-\\[28rem\\] { flex-basis: 100%; } }
/* Critic R4-1: while the first page loads the footer reads "Total: …", never "Total: 0" (and never a dash). */
[data-ks-jobs-loading] [aria-label="Row density"] ~ span[aria-live] > span:first-child { font-size: 0; }
[data-ks-jobs-loading] [aria-label="Row density"] ~ span[aria-live] > span:first-child > * { display: none; }
[data-ks-jobs-loading] [aria-label="Row density"] ~ span[aria-live] > span:first-child::after { content: "\\2026"; font-size: 12px; }
@media (max-width: 1023px) { [data-ks-jobs-shell] input[type="search"] { width: 11rem; } }
`;

/** One breadcrumb root for every page in the Jobs tab group (critic R1: roots jumped between Fulfillment / Automation / Reports). */
export function jobsGroupCrumbs(title: string): readonly Crumb[] {
  return [{ label: 'Fulfillment' }, { label: 'Jobs', href: '/jobs' }, { label: title }];
}

function useDefaultFilters<T>(
  defaults: readonly GridFilter[] | undefined,
  g: ReturnType<typeof useGrid<T>>,
): void {
  const params = useSearchParams();
  const applied = React.useRef(false);
  // Critic R4: the chip must be there on every first load for every role. It is applied at once
  // (not after the saved-views fetch, which can be slow on a busy server); a saved default view
  // that arrives later still replaces it (useGrid applies it when the page opened without state).
  React.useEffect(() => {
    if (applied.current || !defaults || defaults.length === 0) return;
    applied.current = true;
    const hasGridState = [...params.keys()].some((k) => k === 'q' || k === 'sort' || k.startsWith('f.'));
    const defaultView = !g.views.isLoading && g.views.views.some((v) => v.isDefault);
    if (!hasGridState && !defaultView) g.grid.setQuery({ filters: defaults });
  }, [defaults, g.views.isLoading, g.views.views, g.grid, params]);
}

export function ListShell<T extends GridRow>(props: ListShellProps<T>) {
  const router = useRouter();
  const g = useGrid<T>({
    gridKey: props.gridKey,
    path: props.path,
    fields: props.fields,
    extraQuery: props.extraQuery,
  });
  useDefaultFilters(props.defaultFilters, g);

  // Selection survives paging: remember every row seen so bulk menus know their facts.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, T>>(new Map());
  React.useEffect(() => {
    if (g.rows.length > 0) setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)]));
  }, [g.rows]);
  const current = new Map(g.rows.map((r) => [r.id, r] as const));
  const selected = g.selectedIds
    .map((id) => current.get(id) ?? seen.get(id))
    .filter((r): r is T => Boolean(r));
  const refresh = React.useCallback(
    (opts?: { readonly keepSelection?: boolean }) => {
      g.refetch();
      if (!opts?.keepSelection) g.clearSelection();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [g.refetch, g.clearSelection],
  );
  const ctx: ListShellContext<T> = { selected, refresh, rows: g.rows };
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const extra = props.extraQuery ? new URLSearchParams(props.extraQuery).toString() : '';

  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4"
      data-ks-jobs-shell={props.trailing ? 'actions' : 'plain'}
      data-ks-jobs-loading={g.gridProps.loading ? '' : undefined}
    >
      <style href="ks-jobs-shell" precedence="default">
        {JOBS_SHELL_CSS}
      </style>
      <PageHeader
        breadcrumbs={props.breadcrumbs ?? (props.tabs === 'jobs' ? jobsGroupCrumbs(props.title) : undefined)}
        title={props.title}
        helper={props.helper}
        tabs={props.tabs}
        actions={props.actions ?? (props.tabs ? <span aria-hidden className="block h-8" /> : undefined)}
      />
      {props.banner}
      {props.quickFilters && props.quickFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-6 pb-2" role="group" aria-label="Quick filters">
          <span className="text-2xs font-semibold text-faint">Quick filters</span>
          {props.quickFilters.map((qf) => {
            const active = g.grid.query.filters.some((f) => f.field === qf.filter.field);
            return (
              <QuickFilterButton
                key={qf.key}
                qf={qf}
                path={props.path}
                active={active}
                onToggle={() =>
                  g.grid.setQuery({
                    filters: active
                      ? g.grid.query.filters.filter((f) => f.field !== qf.filter.field)
                      : [...g.grid.query.filters, qf.filter],
                  })
                }
              />
            );
          })}
        </div>
      ) : null}
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder={props.searchPlaceholder}
        onRefresh={() => refresh()}
        trailing={props.trailing ? props.trailing(ctx) : null}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<T>
          {...g.gridProps}
          selectable={props.selectable !== false}
          queryString={
            extra
              ? `${g.gridProps.queryString}${g.gridProps.queryString ? '&' : ''}${extra}`
              : g.gridProps.queryString
          }
          exportColumns={props.exportColumns}
          exportName={props.title}
          columns={props.columns}
          getRowId={(row) => row.id}
          rowActions={props.rowActions ? (row: T) => props.rowActions?.(row, ctx) ?? [] : undefined}
          onRowClick={
            props.rowHref
              ? (row) => {
                  const href = props.rowHref?.(row);
                  if (href) router.push(href);
                }
              : undefined
          }
          emptyTitle={hasState ? `Could not find any ${props.noun}` : props.emptyTitle}
          emptyDescription={hasState ? 'Try changing the filters or search term.' : props.emptyDescription}
          emptyAction={hasState ? undefined : props.emptyAction}
        />
      </div>
      {props.children?.(ctx)}
      <span className="sr-only" aria-live="polite">
        {g.isFetching ? `Loading ${props.noun}s` : `${g.total} ${props.noun}s`}
      </span>
    </div>
  );
}
