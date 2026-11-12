'use client';

/**
 * Shared ReportGrid shell (spec 07 §0). Every M13 report is configuration on top of it:
 * header + route tabs, toolbar (Equal / Starts With search, typed filters, chips, saved
 * views, clear, refresh), DataGrid (server sort/paging, column chooser, density, page
 * sizes, async Export As Excel) and URL state that round-trips.
 */
import * as React from 'react';
import { DataGrid, GridToolbar, useGrid, type RowAction } from '@/components/grid';
import type { FilterFieldDef } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import type { PageTabGroupKey } from '@/config/page-tabs';
import { useMe } from '@/lib/permissions-client';
import { useFormat } from '@/lib/format';
import { parseGridQuery, type QuickSearchMode } from '@/server/query/grid-query';
import type { GridUrlState } from '@/lib/use-url-state';
import { isGridKey } from '@/server/exports/grid-keys';
import { exportColumnsOf, type ReportDef, type ReportField } from '@/lib/grid-defs/reports/types';
import { buildReportColumns, chooserGutterColumn, type ReportRow } from './report-cells';
import { ReportExportButton } from './report-export-button';
import { ScheduleReportButton } from './report-schedules';

/** Report grids a schedule can deliver (mirrors SCHEDULABLE in reports-schedules.ts; Export History is excluded). */
export const SCHEDULABLE_KEYS: ReadonlySet<string> = new Set([
  'report-channel-sales',
  'report-order-inventory',
  'report-serial-numbers',
  'report-serial-shipments',
  'report-serial-receipts',
  'report-replenishment',
  'report-inventory-snapshot',
  'report-change-log',
  'report-transaction-history',
  'report-serial-transactions',
  'report-missing-log',
  'report-po-receiving',
  'report-user-performance',
  'report-inventory-aging',
  'report-location-utilization',
  'report-order-lines',
]);

export function useReportFilterFields(fields: readonly ReportField[]): readonly FilterFieldDef[] {
  const me = useMe();
  const options = me.data?.data.contextOptions;
  return React.useMemo(
    () =>
      fields.map((f): FilterFieldDef => {
        let choices: readonly { value: string; label: string }[] | undefined;
        if (f.dynamicOptions === 'warehouse')
          choices = (options?.warehouses ?? []).map((w) => ({
            value: w.id,
            label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name,
          }));
        else if (f.dynamicOptions === 'client')
          choices = (options?.clients ?? []).map((c) => ({ value: c.id, label: c.name }));
        else if (f.options) choices = f.options.map((v) => ({ value: v, label: v }));
        return {
          field: f.field,
          label: f.label,
          type: f.type,
          ...(choices ? { options: choices } : {}),
          ...(f.allowEmpty ? { allowEmpty: true } : {}),
          ...(f.description ? { description: f.description } : {}),
        };
      }),
    [fields, options],
  );
}

export interface ReportGridPageProps {
  readonly def: ReportDef;
  readonly tabs?: PageTabGroupKey;
  /** Applied once when the page opens with no grid state (e.g. "Within 1 Day(s) Past"). */
  readonly defaultQuery?: string;
  readonly banner?: React.ReactNode;
  readonly cellOverrides?: Readonly<Record<string, (row: ReportRow) => React.ReactNode>>;
  readonly rowActions?: (row: ReportRow) => readonly RowAction[];
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: React.ReactNode;
  readonly headerActions?: React.ReactNode;
  /** Breadcrumb label for routes the nav map does not list yet (falls back to the nearest route). */
  readonly crumbLabel?: string;
  /** Poll the list every N ms while `pollWhile(rows)` holds (e.g. exports still preparing). */
  readonly refetchInterval?: number;
  readonly pollWhile?: (rows: readonly ReportRow[]) => boolean;
}

export function ReportGridPage({
  def,
  tabs,
  defaultQuery,
  banner,
  cellOverrides,
  rowActions,
  emptyTitle,
  emptyDescription,
  emptyAction,
  headerActions,
  refetchInterval,
  pollWhile,
  crumbLabel,
}: ReportGridPageProps) {
  const fields = useReportFilterFields(def.fields);
  const g = useGrid<ReportRow>({ gridKey: def.gridKey, path: def.path, fields });

  // Polling (useGrid has no interval option): refetch while the condition holds.
  const shouldPoll = Boolean(refetchInterval) && (pollWhile ? pollWhile(g.rows) : true);
  const { refetch } = g;
  React.useEffect(() => {
    if (!shouldPoll || !refetchInterval) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refetch();
    }, refetchInterval);
    return () => window.clearInterval(id);
  }, [shouldPoll, refetchInterval, refetch]);
  // Grids without a row menu get a sticky-right gutter under the floating column chooser,
  // so the chooser never covers the right-most visible header label or its sort button.
  // The formatter is a dependency: when the viewer's date / time / number preferences arrive
  // (or change) after the first paint, the column defs are rebuilt so every cell re-renders
  // with the same format — first load, hydration and every refetch read identically.
  const fmt = useFormat();
  // DataGrid reserves its own chooser gutter when there is no row menu (hideToolbar). With a
  // row menu M13 adds one just left of the sticky kebab, so the chooser never covers a data
  // header (even when the vertical scrollbar narrows the frame).
  const hasRowMenu = Boolean(rowActions);
  const columns = React.useMemo(() => {
    void fmt;
    const built = buildReportColumns(def.columns, cellOverrides);
    return hasRowMenu ? [...built, chooserGutterColumn()] : built;
  }, [def.columns, cellOverrides, fmt, hasRowMenu]);
  // Registered keys export through the shared footer; the others through M13's own
  // `POST /api/reports/exports` (same task row, tray and Export History).
  const exportRegistered = isGridKey(def.gridKey);
  const schedulable = SCHEDULABLE_KEYS.has(def.gridKey);
  const exportColumns = React.useMemo(() => exportColumnsOf(def).filter((c) => c.key !== 'action'), [def]);

  // Default chip (Logiwa parity: Inventory Snapshot / User Performance open pre-filtered).
  const applied = React.useRef(false);
  const { grid } = g;
  React.useEffect(() => {
    if (applied.current || !defaultQuery) return;
    applied.current = true;
    const empty = grid.query.filters.length === 0 && !grid.query.q && grid.query.sort.length === 0;
    if (empty) grid.setFilters(parseGridQuery(defaultQuery).query.filters);
  }, [defaultQuery, grid]);

  // Quick search defaults to Equal (spec 07 §0, RA-R2-5). The URL grammar omits `qm` for
  // Starts With, so a search with no `qm` in the URL is a deliberate Starts With; with no
  // search text the picker shows the remembered mode (Equal until the user switches).
  const [searchMode, setSearchMode] = React.useState<QuickSearchMode>('eq');
  const toolbarGrid = React.useMemo<GridUrlState>(
    () => ({
      ...grid,
      query: { ...grid.query, qm: grid.query.q ? grid.query.qm : searchMode },
      setSearch: (q, qm) => {
        const text = q.trim();
        const mode = qm ?? (grid.query.q ? grid.query.qm : searchMode);
        grid.setQuery({ q: text || undefined, qm: mode });
      },
      setQuery: (patch) => {
        if (patch.qm) setSearchMode(patch.qm);
        grid.setQuery(patch);
      },
    }),
    [grid, searchMode],
  );

  const hasState = grid.query.filters.length > 0 || Boolean(grid.query.q);
  // Refetch after a search, filter, view or page change: the previous rows stay as a
  // placeholder, so mask them (dim + progress bar + aria-busy) until the new page arrives.
  const refreshing = g.isFetching && !g.isLoading;
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title={def.title}
        crumbLabel={crumbLabel}
        helper={def.helper}
        tabs={tabs}
        actions={headerActions}
      />
      {banner ? <div className="px-6 pt-3">{banner}</div> : null}
      <GridToolbar
        {...g.toolbarProps}
        grid={toolbarGrid}
        searchPlaceholder={def.searchPlaceholder ?? 'Search'}
        trailing={
          <>
            {exportRegistered ? null : (
              <ReportExportButton
                gridKey={def.gridKey}
                queryString={g.gridProps.queryString}
                columns={exportColumns}
                total={g.isLoading ? 0 : g.gridProps.total}
              />
            )}
            {schedulable ? (
              <ScheduleReportButton
                gridKey={def.gridKey}
                title={def.title}
                queryString={g.gridProps.queryString ?? ''}
              />
            ) : null}
          </>
        }
      />
      <div
        // Report grids never select rows, so the footer's "Selected" counter is hidden; for
        // unregistered keys the footer's client-side CSV fallback gives way to the toolbar's
        // async Export As Excel.
        className="relative flex min-h-0 flex-1 flex-col"
        aria-busy={g.isFetching || undefined}
        data-testid="report-grid-frame"
        data-refreshing={refreshing ? 'true' : undefined}
        data-export={exportRegistered ? 'shared' : 'report'}
      >
        {refreshing ? (
          <>
            <div
              role="progressbar"
              aria-label="Loading results"
              className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-primary/15"
            >
              <div className="h-full w-1/3 animate-[ks-report-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 top-9 z-30 bg-surface/55 backdrop-blur-[0.5px] transition-opacity"
            />
            <style>{`@keyframes ks-report-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
          </>
        ) : null}
        <DataGrid<ReportRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => String(r[def.rowKey])}
          selectable={false}
          exportColumns={exportColumns}
          exportName={def.title}
          // Async Export As Excel needs the grid key in the export registry; until it is
          // registered the footer offers a client-side CSV of the page instead of a dead button.
          queryString={exportRegistered ? g.gridProps.queryString : undefined}
          exportMode={exportRegistered ? 'auto' : 'none'}
          rowActions={rowActions}
          emptyTitle={emptyTitle ?? (hasState ? 'No results match these filters' : 'Nothing to report yet')}
          emptyDescription={
            emptyDescription ??
            (hasState
              ? 'Clear a filter, widen the date range or switch Equal to Starts With.'
              : 'Results appear here as soon as the warehouse records activity for this report.')
          }
          emptyAction={emptyAction}
        />
      </div>
    </div>
  );
}
