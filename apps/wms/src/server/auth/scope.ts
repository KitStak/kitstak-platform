/**
 * Data scope: which warehouses and clients a user may see (BUILD_PLAN 0.4 #5).
 *
 *   const scope = await getScope(db, user);           // full entitlement
 *   const view  = narrowScope(scope, ctxWh, ctxClient); // header context switcher
 *   await db.select().from(orders).where(and(scopedWhere(orders, view), ...));
 *
 * Every repository must AND `scopedWhere(table, scope)` into its reads. Cross-scope access
 * returns 404 (`assertInScope`), never 403, so existence does not leak.
 *
 * Rules:
 *   - warehouses: legacy `admin` → all; otherwise `user_warehouses` rows. A non-admin with
 *     NO rows falls back to all warehouses ONLY when a `wms.user_profiles` row exists
 *     (pre-seed compatibility; F2 seeds links, M14 requires ≥1). A core user without a
 *     WMS profile gets ZERO warehouses (auth review 2026-11-11, C1 — explicit deny).
 *   - clients: `users.all_clients` → "all"; otherwise `user_clients` rows (possibly none).
 *   - context cookies (`ks_ctx_wh`, `ks_ctx_client`) only ever NARROW the scope.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { userProfiles } from '@kitstak/db/schema';
import { userClients, userWarehouses, warehouses } from '@/server/db/schema';
import type { AppDb } from '@/server/api/db';
import { notFoundError } from '@/server/api/errors';
import type { SessionUser } from './session-store';

export const CONTEXT_WAREHOUSE_COOKIE = 'ks_ctx_wh';
export const CONTEXT_CLIENT_COOKIE = 'ks_ctx_client';

export type ClientScope = readonly string[] | 'all';

export interface Scope {
  readonly warehouseIds: readonly string[];
  readonly clientIds: ClientScope;
}

export async function getScope(
  db: AppDb,
  user: Pick<SessionUser, 'id' | 'role' | 'allClients'>,
): Promise<Scope> {
  const allWarehouseIds = async (): Promise<string[]> =>
    (await db.select({ id: warehouses.id }).from(warehouses)).map((r) => r.id);
  const linkedWarehouseIds = async (): Promise<string[]> =>
    (
      await db
        .select({ id: userWarehouses.warehouseId })
        .from(userWarehouses)
        .where(eq(userWarehouses.userId, user.id))
    ).map((r) => r.id);
  const hasProfile = async (): Promise<boolean> =>
    (
      await db
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.id))
        .limit(1)
    ).length > 0;
  const loadWarehouseIds = async (): Promise<string[]> => {
    // Admins see every warehouse: their links are never consulted, so they are not read.
    if (user.role === 'admin') return await allWarehouseIds();
    const linked = await linkedWarehouseIds();
    if (linked.length > 0) return linked;
    // C1: the all-warehouses pre-seed fallback never applies to profile-less users.
    return (await hasProfile()) ? await allWarehouseIds() : [];
  };
  const loadClientIds = async (): Promise<ClientScope> =>
    user.allClients
      ? 'all'
      : (
          await db.select({ id: userClients.clientId }).from(userClients).where(eq(userClients.userId, user.id))
        ).map((r) => r.id);

  // Independent reads: run them side by side (every request pays for this on the way in).
  const [warehouseIds, clientIds] = await Promise.all([loadWarehouseIds(), loadClientIds()]);

  return { warehouseIds, clientIds };
}

export function hasWarehouse(scope: Scope, warehouseId: string): boolean {
  return scope.warehouseIds.includes(warehouseId);
}

export function hasClient(scope: Scope, clientId: string): boolean {
  return scope.clientIds === 'all' || scope.clientIds.includes(clientId);
}

/** Applies the header context (cookies) — only values inside the scope take effect. */
export function narrowScope(scope: Scope, warehouseId?: string | null, clientId?: string | null): Scope {
  const warehouseIds = warehouseId && hasWarehouse(scope, warehouseId) ? [warehouseId] : scope.warehouseIds;
  const clientIds: ClientScope = clientId && hasClient(scope, clientId) ? [clientId] : scope.clientIds;
  return { warehouseIds, clientIds };
}

export interface ScopeColumns {
  readonly warehouseId?: PgColumn;
  readonly clientId?: PgColumn;
}

const FALSE_SQL: SQL = sql`false`;

function columnsOf(table: object, explicit?: ScopeColumns): ScopeColumns {
  if (explicit) return explicit;
  const t = table as { warehouseId?: PgColumn; clientId?: PgColumn };
  return { warehouseId: t.warehouseId, clientId: t.clientId };
}

/**
 * WHERE fragment restricting `table` to the scope. Uses the table's `warehouseId` /
 * `clientId` columns when present (or the explicit `columns`). Rows with a NULL
 * client are global (e.g. shared lookups) and stay visible. Returns undefined when
 * nothing needs filtering.
 */
export function scopedWhere(table: object, scope: Scope, columns?: ScopeColumns): SQL | undefined {
  const cols = columnsOf(table, columns);
  const parts: SQL[] = [];
  if (cols.warehouseId) {
    parts.push(
      scope.warehouseIds.length === 0 ? FALSE_SQL : inArray(cols.warehouseId, [...scope.warehouseIds]),
    );
  }
  if (cols.clientId && scope.clientIds !== 'all') {
    parts.push(
      scope.clientIds.length === 0
        ? sql`${cols.clientId} IS NULL`
        : sql`(${cols.clientId} IS NULL OR ${inArray(cols.clientId, [...scope.clientIds])})`,
    );
  }
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

/** Throws NOT_FOUND when a loaded record falls outside the scope. */
export function assertInScope(
  scope: Scope,
  record: { readonly warehouseId?: string | null; readonly clientId?: string | null } | null | undefined,
  what = 'Item',
): void {
  if (!record) throw notFoundError(what);
  if (record.warehouseId && !hasWarehouse(scope, record.warehouseId)) throw notFoundError(what);
  if (record.clientId && !hasClient(scope, record.clientId)) throw notFoundError(what);
}
