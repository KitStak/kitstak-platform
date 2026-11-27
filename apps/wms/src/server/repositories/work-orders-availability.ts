/**
 * Lock-aware component availability (M08). The ONE definition of "usable free stock", shared by
 * the work order detail (KPIs, Components tab, retry callout), the wizard kit card and chips, the
 * Create Kit / allocation guards, and Kit Inventory's Net Kitting Capacity (`kit_inventory_stats`,
 * written by the scheduler and Recalculate Now). It mirrors `candidateBuckets` (FEFO allocation):
 * Stock status, undamaged, free (on hand − allocated) > 0, the location is not flagged locked or
 * "prevent allocation", and no open count plan locks it. Free stock in count-locked locations is
 * reported separately (`lockedQty`, `lockedBy`) so the UI can say "0 free · 773 locked by
 * CNT000147" instead of "773 free".
 *
 * Every caller goes through `freeStockRows` + `classifyFree`. The free stock SQL (including the
 * count-lock predicate, kept identical to the foundation's `notCountLocked`) is shared with Projects
 * through `@kitstak/db/wms-free-stock`; plan codes still come from `countLockFor`.
 */
import { freeStockSql, mapFreeStockRows, type FreeStockFilter, type FreeStockRow, type FreeStockSqlRow } from '@kitstak/db/wms-free-stock';
import { WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import { dbAll } from '@/server/db/sql';
import { countLockFor } from '@/server/domain/ledger/count-locks';
import type { Tx } from '@/server/domain/types';

export type { FreeStockFilter, FreeStockRow } from '@kitstak/db/wms-free-stock';

export interface ComponentAvailability {
  /** Free stock FEFO allocation can actually take (unlocked, allocatable locations). */
  readonly usableQty: number;
  /** Free stock in locations an open count plan locks. */
  readonly lockedQty: number;
  /** Free stock in locations flagged locked / prevent-allocation (not count plans). */
  readonly blockedQty: number;
  /** Count plan codes locking this product's free stock (first is the oldest). */
  readonly lockedBy: readonly string[];
}

export const EMPTY_AVAILABILITY: ComponentAvailability = {
  usableQty: 0,
  lockedQty: 0,
  blockedQty: 0,
  lockedBy: [],
};

export type FreeClass = 'usable' | 'locked' | 'blocked';

/** Pure classification of a free bucket (count lock wins over the location flags). */
export function classifyFree(
  row: Pick<FreeStockRow, 'countLocked' | 'locationLocked' | 'preventAllocation'>,
): FreeClass {
  if (row.countLocked) return 'locked';
  if (row.locationLocked || row.preventAllocation) return 'blocked';
  return 'usable';
}

/**
 * Free buckets (optionally filtered) with the lock flags, in one query. The SQL is the shared
 * `freeStockSql` (@kitstak/db/wms-free-stock, also read by Projects for kit shortages). It names
 * the `wms` schema; a tenant handle rewrites that to the org's own schema on every statement.
 */
export async function freeStockRows(db: Tx, filter: FreeStockFilter = {}): Promise<FreeStockRow[]> {
  if (filter.productIds && filter.productIds.length === 0) return [];
  return mapFreeStockRows(await dbAll<FreeStockSqlRow>(db, freeStockSql(WMS_PLATFORM_SCHEMA, filter)));
}

/**
 * Aggregates free rows by `keyOf`. Plan codes are looked up only for count-locked locations
 * (one lookup per distinct location).
 */
export async function aggregateAvailability<K>(
  db: Tx,
  rows: readonly FreeStockRow[],
  keyOf: (row: FreeStockRow) => K,
): Promise<Map<K, ComponentAvailability>> {
  const plans = new Map<string, string | null>();
  const acc = new Map<K, { usable: number; locked: number; blocked: number; plans: string[] }>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = acc.get(k) ?? { usable: 0, locked: 0, blocked: 0, plans: [] };
    const cls = classifyFree(r);
    if (cls === 'locked') {
      a.locked += r.free;
      if (!plans.has(r.locationId)) plans.set(r.locationId, await countLockFor(db, r.locationId));
      const plan = plans.get(r.locationId);
      if (plan && !a.plans.includes(plan)) a.plans.push(plan);
    } else if (cls === 'blocked') a.blocked += r.free;
    else a.usable += r.free;
    acc.set(k, a);
  }
  const out = new Map<K, ComponentAvailability>();
  for (const [k, a] of acc)
    out.set(k, {
      usableQty: a.usable,
      lockedQty: a.locked,
      blockedQty: a.blocked,
      lockedBy: [...a.plans].sort(),
    });
  return out;
}

/** Per-product availability in a warehouse (and client). Missing products get zeros. */
export async function componentAvailability(
  db: Tx,
  input: {
    readonly warehouseId: string;
    readonly clientId: string | null;
    readonly productIds: readonly string[];
  },
): Promise<Map<string, ComponentAvailability>> {
  const ids = [...new Set(input.productIds)];
  const out = new Map<string, ComponentAvailability>(ids.map((id) => [id, EMPTY_AVAILABILITY]));
  if (ids.length === 0) return out;
  const rows = await freeStockRows(db, {
    warehouseId: input.warehouseId,
    clientId: input.clientId,
    productIds: ids,
  });
  for (const [id, a] of await aggregateAvailability(db, rows, (r) => r.productId)) out.set(id, a);
  return out;
}

/** Key of the warehouse/client/product triple used by the kit reports. */
export const availabilityKey = (warehouseId: string, clientId: string | null, productId: string): string =>
  `${warehouseId}|${clientId ?? ''}|${productId}`;

/** Availability of every warehouse/client/product with free stock (Kit Inventory stats). */
export async function availabilityByKey(db: Tx): Promise<Map<string, ComponentAvailability>> {
  return await aggregateAvailability(db, await freeStockRows(db), (r) =>
    availabilityKey(r.warehouseId, r.clientId, r.productId),
  );
}
