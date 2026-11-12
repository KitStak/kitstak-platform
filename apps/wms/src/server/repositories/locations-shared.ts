/**
 * Server helpers shared by every M10 facility repository: grid-grammar compilation over a
 * field -> SQL map, scope guards, change-log wrappers and constraint mapping.
 */
import { and, getTableName, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { listResult } from '@/server/api/envelope';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError } from '@/server/api/errors';
import { isUniqueViolation } from '@/server/db/sql';
import type { AuthContext } from '@/server/auth/context';
import { hasWarehouse, scopedWhere } from '@/server/auth/scope';
import { diffRows } from '@/server/domain/change-log';
import {
  changeChannel,
  changeSourceUser,
  FACILITY_ENTITY_LABELS,
  facilityEntityName,
  facilityFieldLabel,
  facilityUpdateMessage,
  normalizeChangeRow,
  type CapacityChange,
} from '@/lib/grid-defs/facility/change-log-copy';
import type { DomainCtx } from '@/server/domain/types';
import { compileFilters, compileQuickSearch, type FilterFieldDef } from '@/server/query/filters';
import type { GridQuery, SortSpec } from '@/server/query/grid-query';
import { compileSort } from '@/server/query/sort';
import { changeLog, users } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import type { FacilityField } from '@/lib/grid-defs/facility/common';
import { dbAll } from '@/server/db/sql';

export type Actor = { readonly userId: string | null; readonly source: string };

export interface GridBinding {
  readonly exprs: Readonly<Record<string, SQL>>;
  readonly fields: readonly FacilityField[];
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
  columns?: { warehouseId?: PgColumn },
): SQL | undefined => scopedWhere(table, auth.viewScope, columns);

/** Cross-scope or missing -> 404 (BUILD_PLAN 0.4 #5). */
export function assertWarehouseInScope(
  auth: AuthContext,
  warehouseId: string | null | undefined,
  what = 'Warehouse',
): void {
  if (!warehouseId || !hasWarehouse(auth.scope, warehouseId)) throw notFoundError(what);
}

export function assertFound<T>(row: T | undefined | null, what: string): T {
  if (!row) throw notFoundError(what);
  return row;
}

export function assertVersion(stored: number, sent: number | undefined): void {
  if (sent !== undefined && stored !== sent)
    throw new AppError('CONFLICT', 'This record changed since you opened it — Reload');
}

export { isUniqueViolation };

/**
 * Runs an insert/update and maps a unique-index violation to DUPLICATE on `field`. Inside a
 * transaction, pass a savepoint-wrapped `fn` (`inSavepoint`) so the failed statement does not
 * abort the enclosing transaction.
 */
export async function withUnique<T>(fn: () => T | Promise<T>, field: string, message: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError('DUPLICATE', message, { fieldErrors: { [field]: [message] } });
    throw error;
  }
}

export const duplicateError = (field: string, message: string): AppError =>
  new AppError('DUPLICATE', message, { fieldErrors: { [field]: [message] } });

/* ---------------- change log ---------------- */

export interface LogRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityCode: string;
  /**
   * The record's warehouse. Stored on Delete rows (as the parent warehouse) so the audit trail of
   * a deleted record stays reachable and is authorized against that warehouse (critic R5, REQ-R4-2).
   */
  readonly warehouseId?: string | null;
}

const refCols = (ref: LogRef) => ({
  entityType: ref.entityType,
  entityId: ref.entityId,
  entityCode: ref.entityCode,
});

/*
 * M10 writes its own change_log rows with the same shape as the Foundation writers
 * (`@/server/domain/change-log`), but with M10 entity names and field labels ("LP Type X is
 * created.", "Locked", "Max SKU qty") and "(blank)" for an empty side. REQ-R9-1 asks Foundation
 * to adopt the same labels so every module reads alike.
 */
type ChangeInsert = typeof changeLog.$inferInsert;

async function insertChanges(
  tx: AppDb,
  ctx: DomainCtx,
  rows: readonly Omit<ChangeInsert, 'userId' | 'source'>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await tx.insert(changeLog).values(rows.map((r) => ({ ...r, userId: ctx.userId, source: ctx.source })));
  return rows.length;
}

export async function logCreate(tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> {
  await insertChanges(tx, ctx, [
    {
      ...refCols(ref),
      type: 'Create',
      message: `${facilityEntityName(ref.entityType, ref.entityCode)} is created.`,
    },
  ]);
}

export async function logDelete(tx: AppDb, ctx: DomainCtx, ref: LogRef): Promise<void> {
  await insertChanges(tx, ctx, [
    {
      ...refCols(ref),
      ...(ref.warehouseId ? { parentEntityType: 'warehouse', parentEntityId: ref.warehouseId } : {}),
      type: 'Delete',
      message: `${facilityEntityName(ref.entityType, ref.entityCode)} is deleted.`,
    },
  ]);
}

/** Field-level diff of two *display* snapshots (ids already resolved to codes). */
export async function logUpdate(
  tx: AppDb,
  ctx: DomainCtx,
  ref: LogRef,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Promise<number> {
  return await insertChanges(
    tx,
    ctx,
    diffRows(ref.entityType, before, after).map((c) => {
      const label = facilityFieldLabel(c.field);
      return {
        ...refCols(ref),
        type: 'Update' as const,
        field: c.field,
        fieldLabel: label,
        fromValue: c.from,
        toValue: c.to,
        message: facilityUpdateMessage(label, c.from, c.to),
      };
    }),
  );
}

/** One row per added / edited / removed capacity line on a location (critic R4: capacity was never audited). */
export async function logCapacityChanges(
  tx: AppDb,
  ctx: DomainCtx,
  ref: LogRef,
  changes: readonly CapacityChange[],
): Promise<number> {
  return await insertChanges(
    tx,
    ctx,
    changes.map((c) => ({
      ...refCols(ref),
      type: c.type,
      field: c.field,
      fieldLabel: c.fieldLabel,
      fromValue: c.from,
      toValue: c.to,
      message: c.message,
    })),
  );
}

/** Resolves FK ids to human codes before diffing, so the change log never shows UUIDs. */
export async function resolveIds(
  db: AppDb,
  table: 'locations' | 'warehouses' | 'clients' | 'products' | 'lookup_values' | 'lp_types',
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const column =
    table === 'products' ? sql.raw('sku') : table === 'lookup_values' ? sql.raw('name') : sql.raw('code');
  const rows = await dbAll<{ id: string; label: string }>(
    db,
    sql`SELECT id, ${column} AS label FROM ${sql.raw(table)} WHERE id IN (${sql.join(
      list.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  for (const r of rows) out.set(r.id, r.label);
  return out;
}

/** Change log rows for entities the platform `/api/change-log` does not know yet (REQ-2). */
export async function listEntityChangeLog(
  db: AppDb,
  entityType: string,
  entityId: string,
  page: number,
  pageSize: number,
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
    .orderBy(desc(changeLog.at), sql`(${changeLog.type} = 'Delete') DESC`, sql`${changeLog}.rowid ASC`)
    .limit(pageSize)
    .offset((Math.max(1, page) - 1) * pageSize);
  return { rows, total };
}

/** Boolean SQL expression that renders as 0/1 for filters. */
export const boolSql = (col: PgColumn): SQL => sql`${col}`;

/** `?page=&ps=` for module change-log endpoints. */
export const changeLogPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Module change-log endpoint body: paged rows (newest first) with list meta. Each row is
 * normalized (one label per field across old and new rows) and carries `userName` and
 * `channel` (UI / Import / Integration / Workflow / System: Logiwa's SOURCE column).
 */
export async function changeLogResult(
  db: AppDb,
  entityType: string,
  entityId: string,
  query: z.output<typeof changeLogPageSchema>,
  extraMeta: Readonly<Record<string, unknown>> = {},
) {
  const { rows, total } = await listEntityChangeLog(db, entityType, entityId, query.page, query.ps);
  const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => Boolean(v)))];
  const names = new Map(
    ids.length > 0
      ? (
          await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, ids))
        ).map((u) => [u.id, u.name || u.email] as const)
      : [],
  );
  const out = rows.map((r) => ({
    ...(entityType in FACILITY_ENTITY_LABELS ? normalizeChangeRow(r) : r),
    userName: (r.userId ? names.get(r.userId) : undefined) ?? changeSourceUser(r.source),
    channel: changeChannel(r.source),
  }));
  return listResult(out, { ...extraMeta, total, page: query.page, pageSize: query.ps });
}

/** `meta.created` for the drawer's provenance line: the record's own created date and creator. */
async function createdMeta(db: AppDb, live: unknown): Promise<Record<string, unknown>> {
  if (!live || typeof live !== 'object') return {};
  const rec = live as { createdAt?: unknown; createdBy?: unknown };
  if (typeof rec.createdAt !== 'string') return {};
  const by =
    typeof rec.createdBy === 'string' && rec.createdBy
      ? (
          await db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, rec.createdBy))
            .limit(1)
        )[0]
      : undefined;
  return { created: { at: rec.createdAt, by: by ? by.name || by.email : null } };
}

/**
 * Change log of a record that may have been deleted. While the record exists, `loadLive` does the
 * usual scope check. Once it is gone, the stored audit rows are still returned, authorized against
 * the warehouse recorded on the Delete row; Delete rows written before that warehouse was recorded
 * are visible to admins only.
 */
export async function changeLogResultOrDeleted(
  db: AppDb,
  auth: AuthContext,
  entityType: string,
  entityId: string,
  query: z.output<typeof changeLogPageSchema>,
  loadLive: () => unknown,
) {
  let extra: Record<string, unknown> = {};
  try {
    extra = await createdMeta(db, await loadLive());
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
    const del = (
      await db
        .select({ parentType: changeLog.parentEntityType, parentId: changeLog.parentEntityId })
        .from(changeLog)
        .where(
          and(
            eq(changeLog.entityType, entityType),
            eq(changeLog.entityId, entityId),
            eq(changeLog.type, 'Delete'),
          ),
        )
        .limit(1)
    )[0];
    if (!del) throw error;
    const allowed =
      del.parentType === 'warehouse' && del.parentId
        ? hasWarehouse(auth.scope, del.parentId)
        : auth.user.role === 'admin';
    if (!allowed) throw error;
  }
  return await changeLogResult(db, entityType, entityId, query, extra);
}

/**
 * Fully qualified column (`"table"."col"`) for correlated subqueries. Drizzle renders a bare
 * `"col"` in single-table selects, which SQLite would resolve against the subquery's own table.
 */
export function qc(column: PgColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

/** Re-exported from the dependency-free leaf module (see custom-field-sql.ts for why). */
export { customFieldSql, CUSTOM_FIELD_SORT_KEYS } from './custom-field-sql';

/** Flattens `{ textBox1: "x" }` into `{ "customField.textBox1": "x" }` for change-log diffs and exports. */
export function flattenCustomFields(
  values: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [`customField.${k}`, v]));
}
