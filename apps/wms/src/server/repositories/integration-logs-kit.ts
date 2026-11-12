/**
 * Shared server kit for every M12 repository: grid-grammar compilation over a field -> SQL map,
 * scope guards, optimistic concurrency, change-log wrappers and paging. Owned by M12 so the
 * module never depends on another module's internals.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import { listResult } from '@/server/api/envelope';
import { AppError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, hasWarehouse, scopedWhere } from '@/server/auth/scope';
import { changeLog } from '@/server/db/schema';
import { recordCreate, recordDelete, recordUpdate } from '@/server/domain/change-log';
import type { DomainCtx } from '@/server/domain/types';
import { compileFilters, compileQuickSearch, type FilterFieldDef } from '@/server/query/filters';
import type { GridQuery, SortSpec } from '@/server/query/grid-query';
import { compileSort } from '@/server/query/sort';
import type { IntegrationField } from '@/lib/grid-defs/integrations/common';
import { dbAll, withWriteTx } from '@/server/db/sql';

export type Actor = { readonly userId: string | null; readonly source: string };

export interface GridBinding {
  readonly exprs: Readonly<Record<string, SQL>>;
  readonly fields: readonly IntegrationField[];
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
export function compileGrid(
  binding: GridBinding,
  query: GridQuery,
  extra: readonly (SQL | undefined)[] = [],
): CompiledGrid {
  const defs: FilterFieldDef[] = binding.fields.map((f) => ({
    key: f.field,
    label: f.label,
    type: f.type,
    sql: exprOf(binding, f.field),
  }));
  const filters = compileFilters(defs, query.filters);
  const search = compileQuickSearch(
    query.q,
    query.qm,
    binding.search.map((k) => exprOf(binding, k)),
  );
  const sortable = Object.fromEntries(binding.sortable.map((k) => [k, exprOf(binding, k)]));
  const orderBy = compileSort(sortable, query.sort, {
    defaultSort: binding.defaultSort,
    tiebreaker: binding.tiebreaker,
  });
  return { where: and(...extra, filters, search), orderBy };
}

export const domainCtxOf = (actor: Actor, auth: AuthContext): DomainCtx => ({
  userId: actor.userId,
  source: actor.source,
  scope: auth.scope,
});

/** Default list scope: the header context (view scope). */
export const listScope = (
  table: object,
  auth: AuthContext,
  columns?: { warehouseId?: PgColumn; clientId?: PgColumn },
): SQL | undefined => scopedWhere(table, auth.viewScope, columns);

/** Cross-scope or missing -> 404 (BUILD_PLAN 0.4 #5). */
export function assertWarehouseInScope(
  auth: AuthContext,
  warehouseId: string | null | undefined,
  what = 'Warehouse',
): void {
  if (!warehouseId || !hasWarehouse(auth.scope, warehouseId)) throw notFoundError(what);
}

export function assertClientInScope(
  auth: AuthContext,
  clientId: string | null | undefined,
  what = 'Client',
): void {
  if (!clientId || !hasClient(auth.scope, clientId)) throw notFoundError(what);
}

export function assertFound<T>(row: T | undefined | null, what: string): T {
  if (!row) throw notFoundError(what);
  return row;
}

export function assertVersion(stored: number, sent: number | undefined): void {
  if (sent !== undefined && stored !== sent)
    throw new AppError('CONFLICT', 'This record changed since you opened it — Reload');
}

export const duplicateError = (field: string, message: string): AppError =>
  new AppError('DUPLICATE', message, { fieldErrors: { [field]: [message] } });

export const fieldError = (
  field: string,
  message: string,
  code: 'VALIDATION' | 'INVALID_STATE' = 'VALIDATION',
): AppError => new AppError(code, message, { fieldErrors: { [field]: [message] } });

/* ---------------- change log ---------------- */

export interface LogRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityCode: string;
}

export const logCreate = async (tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> =>
  await recordCreate(tx, ctx, ref);
export const logDelete = async (tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> =>
  await recordDelete(tx, ctx, ref);
/** Field-level diff of two *display* snapshots (ids already resolved to names). */
export const logUpdate = async (
  tx: AppDb,
  ctx: DomainCtx,
  ref: LogRef,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Promise<number> => await recordUpdate(tx, ctx, { ...ref, before, after });

/** id -> human label for FK columns, so the change log never shows UUIDs. */
export async function labelsOf(
  db: AppDb,
  table: 'warehouses' | 'clients' | 'carrier_connections' | 'carrier_services',
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const column =
    table === 'carrier_connections' ? 'setup_name' : table === 'carrier_services' ? 'name' : 'code';
  const rows = await dbAll<{ id: string; label: string }>(
    db,
    sql`SELECT id, ${sql.raw(column)} AS label FROM ${sql.raw(table)} WHERE id IN (${sql.join(
      list.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  for (const r of rows) out.set(r.id, r.label);
  return out;
}

/**
 * M12 client display rule (critic R4): every API returns `clientName` = the client's full name
 * and `clientCode` = its short code, for list, detail and create/update responses alike. Grids
 * show the name and put "CODE · Name" in the tooltip.
 */
export interface ClientLabel {
  readonly code: string;
  readonly name: string;
}

export async function clientLabelsOf(
  db: AppDb,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, ClientLabel>> {
  const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, ClientLabel>();
  if (list.length === 0) return out;
  const rows = await dbAll<{ id: string; code: string; name: string }>(
    db,
    sql`SELECT id, code, name FROM clients WHERE id IN (${sql.join(
      list.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  for (const r of rows) out.set(r.id, { code: r.code, name: r.name || r.code });
  return out;
}

export const changeLogPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(100).default(20),
});

export async function changeLogResult(
  db: AppDb,
  entityType: string,
  entityId: string,
  query: z.output<typeof changeLogPageSchema>,
) {
  const where = and(eq(changeLog.entityType, entityType), eq(changeLog.entityId, entityId));
  const total =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(changeLog)
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  const rows = await db
    .select()
    .from(changeLog)
    .where(where)
    .orderBy(desc(changeLog.at), desc(changeLog.id))
    .limit(query.ps)
    .offset((query.page - 1) * query.ps);
  return listResult(rows, { total, page: query.page, pageSize: query.ps });
}

/** Thrown inside a savepoint to roll a dry run back after capturing its result. */
export class DryRunRollback extends Error {
  constructor() {
    super('dry run');
    this.name = 'DryRunRollback';
  }
}

/** Runs `fn` in a savepoint that is always rolled back; returns what `fn` produced. */
export async function dryRun<T>(db: AppDb, fn: (tx: AppDb) => T | Promise<T>): Promise<T> {
  let out: { value: T } | null = null;
  try {
    await withWriteTx(db, async (tx) => {
      out = { value: await fn(tx) };
      throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (!out) throw new AppError('INTERNAL', 'Dry run produced no result');
  return (out as { value: T }).value;
}
