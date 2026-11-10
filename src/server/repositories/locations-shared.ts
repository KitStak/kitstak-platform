/**
 * Server helpers shared by every M10 facility repository: grid-grammar compilation over a
 * field -> SQL map, scope guards, change-log wrappers and constraint mapping.
 */
import { and, getTableName, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { listResult } from "@/server/api/envelope";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, scopedWhere } from "@/server/auth/scope";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import type { DomainCtx } from "@/server/domain/types";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery, SortSpec } from "@/server/query/grid-query";
import { compileSort } from "@/server/query/sort";
import { changeLog } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";
import type { FacilityField } from "@/lib/grid-defs/facility/common";

export type Actor = { readonly userId: string | null; readonly source: string };

export interface GridBinding {
  readonly exprs: Readonly<Record<string, SQL>>;
  readonly fields: readonly FacilityField[];
  readonly sortable: readonly string[];
  readonly search: readonly string[];
  readonly defaultSort: readonly SortSpec[];
  readonly tiebreaker: SQLiteColumn;
}

export interface CompiledGrid {
  readonly where: SQL | undefined;
  readonly orderBy: SQL[];
}

function exprOf(binding: GridBinding, key: string): SQL {
  const expr = binding.exprs[key];
  if (!expr) throw new Error(`Grid field "${key}" has no SQL binding`);
  return expr;
}

/** Filters + quick search + sort for one grid; `extra` is ANDed (scope, tab). */
export function compileGrid(binding: GridBinding, query: GridQuery, extra: readonly (SQL | undefined)[] = []): CompiledGrid {
  const defs: FilterFieldDef[] = binding.fields.map((f) => ({ key: f.field, label: f.label, type: f.type, sql: exprOf(binding, f.field) }));
  const filters = compileFilters(defs, query.filters);
  const search = compileQuickSearch(query.q, query.qm, binding.search.map((k) => exprOf(binding, k)));
  const sortable = Object.fromEntries(binding.sortable.map((k) => [k, exprOf(binding, k)]));
  const orderBy = compileSort(sortable, query.sort, { defaultSort: binding.defaultSort, tiebreaker: binding.tiebreaker });
  return { where: and(...extra, filters, search), orderBy };
}

export const domainCtxOf = (actor: Actor, auth: AuthContext): DomainCtx => ({ userId: actor.userId, source: actor.source, scope: auth.scope });

/** Default list scope: the header context (view scope). */
export const listScope = (table: object, auth: AuthContext, columns?: { warehouseId?: SQLiteColumn }): SQL | undefined =>
  scopedWhere(table, auth.viewScope, columns);

/** Cross-scope or missing -> 404 (BUILD_PLAN 0.4 #5). */
export function assertWarehouseInScope(auth: AuthContext, warehouseId: string | null | undefined, what = "Warehouse"): void {
  if (!warehouseId || !hasWarehouse(auth.scope, warehouseId)) throw notFoundError(what);
}

export function assertFound<T>(row: T | undefined | null, what: string): T {
  if (!row) throw notFoundError(what);
  return row;
}

export function assertVersion(stored: number, sent: number | undefined): void {
  if (sent !== undefined && stored !== sent) throw new AppError("CONFLICT", "This record changed since you opened it — Reload");
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

/** Runs an insert/update and maps a unique-index violation to DUPLICATE on `field`. */
export function withUnique<T>(fn: () => T, field: string, message: string): T {
  try {
    return fn();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("DUPLICATE", message, { fieldErrors: { [field]: [message] } });
    throw error;
  }
}

export const duplicateError = (field: string, message: string): AppError =>
  new AppError("DUPLICATE", message, { fieldErrors: { [field]: [message] } });

/* ---------------- change log ---------------- */

export interface LogRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityCode: string;
}

export function logCreate(tx: AppDb, ctx: DomainCtx, ref: LogRef): void {
  recordCreate(tx, ctx, ref);
}

export function logDelete(tx: AppDb, ctx: DomainCtx, ref: LogRef): void {
  recordDelete(tx, ctx, ref);
}

/** Field-level diff of two *display* snapshots (ids already resolved to codes). */
export function logUpdate(tx: AppDb, ctx: DomainCtx, ref: LogRef, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): number {
  return recordUpdate(tx, ctx, { ...ref, before, after });
}

/** Resolves FK ids to human codes before diffing, so the change log never shows UUIDs. */
export function resolveIds(db: AppDb, table: "locations" | "warehouses" | "clients" | "products" | "lookup_values" | "lp_types", ids: readonly (string | null | undefined)[]): Map<string, string> {
  const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const column = table === "products" ? sql.raw("sku") : table === "lookup_values" ? sql.raw("name") : sql.raw("code");
  const rows = db.all<{ id: string; label: string }>(sql`SELECT id, ${column} AS label FROM ${sql.raw(table)} WHERE id IN (${sql.join(list.map((id) => sql`${id}`), sql`, `)})`);
  for (const r of rows) out.set(r.id, r.label);
  return out;
}

/** Change log rows for entities the platform `/api/change-log` does not know yet (REQ-2). */
export function listEntityChangeLog(db: AppDb, entityType: string, entityId: string, page: number, pageSize: number) {
  const where = and(eq(changeLog.entityType, entityType), eq(changeLog.entityId, entityId));
  const total = db.select({ n: sql<number>`count(*)` }).from(changeLog).where(where).get()?.n ?? 0;
  const rows = db.select().from(changeLog).where(where).orderBy(desc(changeLog.at), desc(changeLog.id)).limit(pageSize).offset((Math.max(1, page) - 1) * pageSize).all();
  return { rows, total };
}

/** Boolean SQL expression that renders as 0/1 for filters. */
export const boolSql = (col: SQLiteColumn): SQL => sql`${col}`;

/** `?page=&ps=` for module change-log endpoints. */
export const changeLogPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(100).default(20),
});

/** Module change-log endpoint body: paged rows (newest first) with list meta. */
export function changeLogResult(db: AppDb, entityType: string, entityId: string, query: z.output<typeof changeLogPageSchema>) {
  const { rows, total } = listEntityChangeLog(db, entityType, entityId, query.page, query.ps);
  return listResult(rows, { total, page: query.page, pageSize: query.ps });
}

/**
 * Fully qualified column (`"table"."col"`) for correlated subqueries. Drizzle renders a bare
 * `"col"` in single-table selects, which SQLite would resolve against the subquery's own table.
 */
export function qc(column: SQLiteColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}
