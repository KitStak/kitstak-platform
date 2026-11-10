"use client";

/**
 * Shared list-page shell for the M03 grids: page header + route tabs, the shared grid toolbar
 * (Equal / Starts With search, typed filters, chips, saved views, refresh), the DataGrid
 * (column chooser, density, page sizes, async Excel export) and a default filter chip.
 * Grid state lives in the URL, so render inside <Suspense>.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid, GridToolbar, useGrid, type FilterFieldDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import type { PageTabGroupKey } from "@/config/page-tabs";
import type { GridFilter } from "@/server/query/grid-query";
import type { GridRow } from "./jobs-client";

export interface ListShellContext<T> {
  readonly selected: readonly T[];
  readonly refresh: () => void;
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
}

function useDefaultFilters<T>(defaults: readonly GridFilter[] | undefined, g: ReturnType<typeof useGrid<T>>): void {
  const params = useSearchParams();
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || !defaults || defaults.length === 0 || g.views.isLoading) return;
    applied.current = true;
    const hasGridState = [...params.keys()].some((k) => k === "q" || k === "sort" || k.startsWith("f."));
    if (!hasGridState && !g.views.views.some((v) => v.isDefault)) g.grid.setQuery({ filters: defaults });
  }, [defaults, g.views.isLoading, g.views.views, g.grid, params]);
}

export function ListShell<T extends GridRow>(props: ListShellProps<T>) {
  const router = useRouter();
  const g = useGrid<T>({ gridKey: props.gridKey, path: props.path, fields: props.fields, extraQuery: props.extraQuery });
  useDefaultFilters(props.defaultFilters, g);

  // Selection survives paging: remember every row seen so bulk menus know their facts.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, T>>(new Map());
  React.useEffect(() => {
    if (g.rows.length > 0) setSeen((prev) => new Map([...prev, ...g.rows.map((r) => [r.id, r] as const)]));
  }, [g.rows]);
  const current = new Map(g.rows.map((r) => [r.id, r] as const));
  const selected = g.selectedIds.map((id) => current.get(id) ?? seen.get(id)).filter((r): r is T => Boolean(r));
  const refresh = React.useCallback(() => {
    g.refetch();
    g.clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.refetch, g.clearSelection]);
  const ctx: ListShellContext<T> = { selected, refresh, rows: g.rows };
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const extra = props.extraQuery ? new URLSearchParams(props.extraQuery).toString() : "";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title={props.title} helper={props.helper} tabs={props.tabs} actions={props.actions} />
      {props.banner}
      <GridToolbar {...g.toolbarProps} searchPlaceholder={props.searchPlaceholder} onRefresh={refresh} trailing={props.trailing ? props.trailing(ctx) : null} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<T>
          {...g.gridProps}
          selectable={props.selectable !== false}
          queryString={extra ? `${g.gridProps.queryString}${g.gridProps.queryString ? "&" : ""}${extra}` : g.gridProps.queryString}
          exportColumns={props.exportColumns}
          exportName={props.title}
          columns={props.columns}
          getRowId={(row) => row.id}
          rowActions={props.rowActions ? (row: T) => props.rowActions?.(row, ctx) ?? [] : undefined}
          onRowClick={props.rowHref ? (row) => {
            const href = props.rowHref?.(row);
            if (href) router.push(href);
          } : undefined}
          emptyTitle={hasState ? `Could not find any ${props.noun}` : props.emptyTitle}
          emptyDescription={hasState ? "Try changing the filters or search term." : props.emptyDescription}
          emptyAction={hasState ? undefined : props.emptyAction}
        />
      </div>
      {props.children?.(ctx)}
      <span className="sr-only" aria-live="polite">{g.isFetching ? `Loading ${props.noun}s` : `${g.total} ${props.noun}s`}</span>
    </div>
  );
}
