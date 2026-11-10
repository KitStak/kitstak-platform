"use client";

/**
 * Shared ReportGrid shell (spec 07 §0). Every M13 report is configuration on top of it:
 * header + route tabs, toolbar (Equal / Starts With search, typed filters, chips, saved
 * views, clear, refresh), DataGrid (server sort/paging, column chooser, density, page
 * sizes, async Export As Excel) and URL state that round-trips.
 */
import * as React from "react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import type { FilterFieldDef } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import type { PageTabGroupKey } from "@/config/page-tabs";
import { useMe } from "@/lib/permissions-client";
import { parseGridQuery } from "@/server/query/grid-query";
import { exportColumnsOf, type ReportDef, type ReportField } from "@/lib/grid-defs/reports/types";
import { buildReportColumns, type ReportRow } from "./report-cells";

export function useReportFilterFields(fields: readonly ReportField[]): readonly FilterFieldDef[] {
  const me = useMe();
  const options = me.data?.data.contextOptions;
  return React.useMemo(() => fields.map((f): FilterFieldDef => {
    let choices: readonly { value: string; label: string }[] | undefined;
    if (f.dynamicOptions === "warehouse") choices = (options?.warehouses ?? []).map((w) => ({ value: w.id, label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name }));
    else if (f.dynamicOptions === "client") choices = (options?.clients ?? []).map((c) => ({ value: c.id, label: c.name }));
    else if (f.options) choices = f.options.map((v) => ({ value: v, label: v }));
    return {
      field: f.field,
      label: f.label,
      type: f.type,
      ...(choices ? { options: choices } : {}),
      ...(f.allowEmpty ? { allowEmpty: true } : {}),
      ...(f.description ? { description: f.description } : {}),
    };
  }), [fields, options]);
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
  /** Poll the list every N ms while `pollWhile(rows)` holds (e.g. exports still preparing). */
  readonly refetchInterval?: number;
  readonly pollWhile?: (rows: readonly ReportRow[]) => boolean;
}

export function ReportGridPage({
  def, tabs, defaultQuery, banner, cellOverrides, rowActions, emptyTitle, emptyDescription, emptyAction, headerActions, refetchInterval, pollWhile,
}: ReportGridPageProps) {
  const fields = useReportFilterFields(def.fields);
  const g = useGrid<ReportRow>({ gridKey: def.gridKey, path: def.path, fields });

  // Polling (useGrid has no interval option): refetch while the condition holds.
  const shouldPoll = Boolean(refetchInterval) && (pollWhile ? pollWhile(g.rows) : true);
  const { refetch } = g;
  React.useEffect(() => {
    if (!shouldPoll || !refetchInterval) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") refetch(); }, refetchInterval);
    return () => window.clearInterval(id);
  }, [shouldPoll, refetchInterval, refetch]);
  const columns = React.useMemo(() => buildReportColumns(def.columns, cellOverrides), [def.columns, cellOverrides]);
  const exportColumns = React.useMemo(() => exportColumnsOf(def).filter((c) => c.key !== "action"), [def]);

  // Default chip (Logiwa parity: Inventory Snapshot / User Performance open pre-filtered).
  const applied = React.useRef(false);
  const { grid } = g;
  React.useEffect(() => {
    if (applied.current || !defaultQuery) return;
    applied.current = true;
    const empty = grid.query.filters.length === 0 && !grid.query.q && grid.query.sort.length === 0;
    if (empty) grid.setFilters(parseGridQuery(defaultQuery).query.filters);
  }, [defaultQuery, grid]);

  const hasState = grid.query.filters.length > 0 || Boolean(grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title={def.title} helper={def.helper} tabs={tabs} actions={headerActions} />
      {banner ? <div className="px-6 pt-3">{banner}</div> : null}
      <GridToolbar {...g.toolbarProps} searchPlaceholder={def.searchPlaceholder ?? "Search"} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ReportRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => String(r[def.rowKey])}
          selectable={false}
          exportColumns={exportColumns}
          exportName={def.title}
          rowActions={rowActions}
          emptyTitle={emptyTitle ?? (hasState ? "No rows match these filters" : "Nothing to report yet")}
          emptyDescription={emptyDescription ?? (hasState ? "Clear a filter, widen the date range or switch Equal to Starts With." : "Rows appear here as soon as the warehouse records activity for this report.")}
          emptyAction={emptyAction}
        />
      </div>
    </div>
  );
}
