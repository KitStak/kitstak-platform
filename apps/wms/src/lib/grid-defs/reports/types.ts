/**
 * Shared shape of every M13 report grid (spec 07 §0 "ReportGrid"). PURE TS: the client
 * shell builds its columns/filters from it, the server compiles the grid grammar against
 * it and the export providers take their sheet columns from it.
 *
 * `field` / column `id` is the `f.<field>` / `sort=<field>` key AND the SQL alias of the
 * report's inner SELECT, so client, URL and SQL always agree on one name.
 */
import type { StatusDomain } from "@/lib/status-colors";

export type ReportFieldType = "enum" | "text" | "number" | "date" | "boolean";

/** Enum fields whose options come from the viewer's scope at runtime. */
export type ReportDynamicOptions = "warehouse" | "client";

export interface ReportField {
  readonly field: string;
  readonly label: string;
  readonly type: ReportFieldType;
  readonly options?: readonly string[];
  readonly dynamicOptions?: ReportDynamicOptions;
  readonly allowEmpty?: boolean;
  /** Alias the filter compares against (defaults to `field`). */
  readonly filterAlias?: string;
  /** Stored as YYYY-MM-DD. */
  readonly dateOnly?: boolean;
  readonly description?: string;
}

export type ReportCellKind =
  | "text" | "strong" | "mono" | "number" | "decimal" | "money" | "datetime" | "date"
  | "pill" | "diff" | "yesNo" | "user";

export interface ReportColumn {
  readonly id: string;
  readonly label: string;
  readonly kind?: ReportCellKind;
  readonly width?: number;
  /** Server-sortable (alias listed in `sortable`). Default true. */
  readonly sortable?: boolean;
  /** Header `?` tooltip (formula / meaning). */
  readonly tip?: string;
  /** Status domain for `pill` cells. */
  readonly pill?: StatusDomain;
  /** Row key holding an in-app href; the cell renders as a link when it is set. */
  readonly hrefKey?: string;
  readonly alwaysVisible?: boolean;
  /** Hidden until enabled in the column chooser. */
  readonly defaultHidden?: boolean;
  /** Export column type. */
  readonly exportType?: "text" | "integer" | "number" | "money" | "date" | "datetime" | "boolean";
}

export interface ReportDef {
  readonly gridKey: string;
  readonly title: string;
  /** List endpoint. */
  readonly path: string;
  readonly permission: string;
  readonly helper: string;
  readonly fields: readonly ReportField[];
  readonly columns: readonly ReportColumn[];
  /** Quick search (Equal / Starts With) targets; empty = no quick search. */
  readonly search: readonly string[];
  readonly searchPlaceholder?: string;
  /** Applied when the URL carries no sort. "-x" = descending. */
  readonly defaultSort: readonly string[];
  /** Unique alias that keeps paging stable. */
  readonly rowKey: string;
}

/** Sortable aliases of a def (every column unless `sortable: false`). */
export function sortableOf(def: ReportDef): readonly string[] {
  return def.columns.filter((c) => c.sortable !== false).map((c) => c.id);
}

const EXPORT_TYPE: Partial<Record<ReportCellKind, NonNullable<ReportColumn["exportType"]>>> = {
  number: "integer",
  decimal: "number",
  diff: "integer",
  money: "money",
  datetime: "datetime",
  date: "date",
};

/** Sheet columns for Export As Excel, in grid order. */
export function exportColumnsOf(def: ReportDef): readonly { key: string; label: string; type?: NonNullable<ReportColumn["exportType"]> }[] {
  return def.columns.map((c) => {
    const type = c.exportType ?? (c.kind ? EXPORT_TYPE[c.kind] : undefined);
    return { key: c.id, label: c.label, ...(type ? { type } : {}) };
  });
}

/** Shorthand builders keep the 14 defs readable. */
export const text = (field: string, label: string, extra: Partial<ReportField> = {}): ReportField => ({ field, label, type: "text", ...extra });
export const num = (field: string, label: string, extra: Partial<ReportField> = {}): ReportField => ({ field, label, type: "number", ...extra });
export const date = (field: string, label: string, extra: Partial<ReportField> = {}): ReportField => ({ field, label, type: "date", ...extra });
export const bool = (field: string, label: string, extra: Partial<ReportField> = {}): ReportField => ({ field, label, type: "boolean", ...extra });
export const enumOf = (field: string, label: string, options: readonly string[], extra: Partial<ReportField> = {}): ReportField => ({ field, label, type: "enum", options, ...extra });
export const WAREHOUSE_FIELD: ReportField = { field: "warehouseId", label: "Warehouse", type: "enum", dynamicOptions: "warehouse" };
export const CLIENT_FIELD: ReportField = { field: "clientId", label: "Client", type: "enum", dynamicOptions: "client" };

export const col = (id: string, label: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ id, label, ...extra });
