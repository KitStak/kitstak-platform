/**
 * Server helpers shared by every M14 admin repository: grid-grammar compilation over a
 * field -> SQL map, guards, change-log wrappers and module change-log endpoints.
 */
import { and, eq, getTableName, sql, type SQL } from "drizzle-orm";
import { desc } from "@/server/db/order";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { listResult } from "@/server/api/envelope";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { changeLog } from "@/server/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import type { DomainCtx } from "@/server/domain/types";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery, SortSpec } from "@/server/query/grid-query";
import { compileSort } from "@/server/query/sort";
import type { AdminField } from "@/lib/grid-defs/admin/common";

export type Actor = { readonly userId: string | null; readonly source: string };

export interface GridBinding {
  readonly exprs: Readonly<Record<string, SQL>>;
  readonly fields: readonly AdminField[];
  readonly sortable: readonly string[];
  readonly search: readonly string[];
  readonly defaultSort: readonly SortSpec[];
  readonly tiebreaker: PgColumn;
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

export function assertFound<T>(row: T | undefined | null, what: string): T {
  if (!row) throw notFoundError(what);
  return row;
}

export function assertVersion(stored: number, sent: number | undefined): void {
  if (sent !== undefined && stored !== sent) throw new AppError("CONFLICT", "This record changed since you opened it — Reload");
}

export const duplicateError = (field: string, message: string): AppError =>
  new AppError("DUPLICATE", message, { fieldErrors: { [field]: [message] } });

export const fieldError = (field: string, message: string, code: "VALIDATION" | "INVALID_STATE" = "VALIDATION"): AppError =>
  new AppError(code, message, { fieldErrors: { [field]: [message] } });

/* ---------------- change log ---------------- */

export interface LogRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityCode: string;
}

export async function logCreate(tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> {
  await recordCreate(tx, ctx, ref);
}

export async function logDelete(tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> {
  await recordDelete(tx, ctx, ref);
}

/** Field-level diff of two *display* snapshots (ids already resolved to names). */
export async function logUpdate(tx: AppDb, ctx: DomainCtx, ref: LogRef, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Promise<number> {
  return await recordUpdate(tx, ctx, { ...ref, before, after });
}

export const changeLogPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(100).default(20),
});

/** Module change-log endpoint body: paged rows (newest first) with list meta. */
export async function changeLogResult(db: AppDb, entityType: string, entityId: string, query: z.output<typeof changeLogPageSchema>) {
  const where = and(eq(changeLog.entityType, entityType), eq(changeLog.entityId, entityId));
  const total = (await db.select({ n: sql<number>`count(*)` }).from(changeLog).where(where).limit(1))[0]?.n ?? 0;
  const rows = await db.select().from(changeLog).where(where).orderBy(desc(changeLog.at), desc(changeLog.id)).limit(query.ps).offset((query.page - 1) * query.ps);
  return listResult(rows, { total, page: query.page, pageSize: query.ps });
}

/** Fully qualified column (`"table"."col"`) for correlated subqueries. */
export function qc(column: PgColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

/** `?ids=a,b` or repeated params -> list. */
export function listParam(value: string | undefined): string[] {
  return (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}
