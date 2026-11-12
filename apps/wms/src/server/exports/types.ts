/**
 * Export contracts (BUILD_PLAN F6 `exports/`).
 *
 * A provider turns a grid query into pages of flat rows. Module providers live in
 * `src/server/repositories/<prefix>-export.ts` and are wired through the per-grid stub
 * file `src/server/exports/providers/<gridKey>.ts` (0.6). While that stub still exports
 * `null`, the runner uses the generic provider, which exports exactly what the grid's
 * list endpoint returns for the same query.
 */
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import type { GridQuery } from '@/server/query/grid-query';

export const EXPORT_COLUMN_TYPES = [
  'text',
  'integer',
  'number',
  'money',
  'date',
  'datetime',
  'boolean',
] as const;
export type ExportColumnType = (typeof EXPORT_COLUMN_TYPES)[number];

export interface ExportColumn {
  /** Dot path into the row (`client.name`). */
  readonly key: string;
  readonly label: string;
  readonly type?: ExportColumnType;
}

export type ExportRow = Readonly<Record<string, unknown>>;

export interface ExportPage {
  readonly rows: readonly ExportRow[];
  /** Total rows for the query, when known (drives progress). */
  readonly total?: number;
}

/** Fetches one page of a list endpoint as the requesting user (generic provider). */
export type ListFetcher = (listPath: string, search: URLSearchParams) => Promise<unknown>;

export interface ExportContext {
  readonly db: AppDb;
  readonly auth: AuthContext;
  readonly gridKey: string;
  /** Parsed grid query (filters, sort; page/pageSize are driven by the runner). */
  readonly query: GridQuery;
  /** Raw query string as sent by the grid (`f.status=in:Open&sort=-createdAt`). */
  readonly rawQuery: string;
  readonly listFetcher?: ListFetcher;
}

export interface ExportProvider {
  /** Columns in sheet order; omitted = taken from the request or inferred from rows. */
  readonly columns?: readonly ExportColumn[];
  fetchPage(ctx: ExportContext, page: number, pageSize: number): Promise<ExportPage> | ExportPage;
}

export interface GridExportDef {
  readonly gridKey: string;
  /** Sheet / file title, e.g. "Shipment Orders". */
  readonly title: string;
  /** List endpoint the generic provider reads (`/api/orders`). */
  readonly listPath: string;
  /** Permission required to export (the grid's view permission). */
  readonly permission: string;
  /** Owning module (0.6). */
  readonly owner: string;
  /** Where the module provider is expected to live. */
  readonly modulePath: string;
  /** Extra fixed query params the list endpoint needs (e.g. `tab=shipped`). */
  readonly fixedParams?: Readonly<Record<string, string>>;
}
