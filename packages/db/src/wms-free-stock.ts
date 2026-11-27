/**
 * The ONE definition of usable WMS free stock, shared by WMS (work order availability, kit cards,
 * Kit Inventory's Net Kitting Capacity) and Projects (component shortages for a program variant's
 * kit, docs/programs/SPEC.md 6.3). Moved verbatim from
 * `apps/wms/src/server/repositories/work-orders-availability.ts` (`freeStockRows`), which now
 * imports it back; `work-orders-availability.snapshot.db.test.ts` proves the rows are identical.
 *
 * A free bucket is an inventory row with status Stock, no damage reason and free stock
 * (on hand minus allocated) above 0, with its location's flags (locked, prevent allocation) and
 * whether an open count plan locks the location (the same rule as WMS `notCountLocked` in
 * apps/wms/src/server/domain/ledger/count-locks.ts; see COUNT_LOCKING_PLAN_STATUSES).
 *
 * Every table is qualified with the org's WMS schema (`wmsTable`), so a reader with a plain
 * connection (Projects, through `core.wms_tenants`) never touches another org's warehouse. WMS
 * passes `wms`: its tenant handles rewrite `"wms".` to the tenant schema on every statement.
 * Read only. Never pass array parameters (drivers disagree): lists use `sql.join`.
 */
import { sql, type SQL } from 'drizzle-orm';
import { queryRows, type Executor } from './programs/executor';
import { wmsTable } from './wms-tenants';

/**
 * The count lock statuses, a copy of `LOCKING_PLAN_STATUSES` and `RELEASED_LINE_STATUSES` in
 * apps/wms/src/server/domain/ledger/count-locks.ts (`notCountLocked`). This package cannot import
 * from the WMS app, so the copy is pinned: the WMS snapshot test
 * (work-orders-availability.snapshot.db.test.ts) asserts these lists equal the WMS constants, and
 * any change to the WMS count lock rule must change both files.
 */
export const COUNT_LOCKING_PLAN_STATUSES = ['Pending', 'Ready To Count', 'Count Started', 'Count Completed'] as const;
export const COUNT_RELEASED_LINE_STATUSES = ['Cancelled', 'Inventory Updated', 'Recount Created'] as const;

/** A fixed status list as SQL literals (constants only, never user input). */
const statusList = (statuses: readonly string[]): SQL => sql.raw(statuses.map((status) => `'${status.replace(/'/g, "''")}'`).join(', '));

export interface FreeStockFilter {
  readonly warehouseId?: string;
  readonly clientId?: string | null;
  readonly productIds?: readonly string[];
}

/** One free (Stock, undamaged, unallocated > 0) bucket with its location's allocation flags. */
export interface FreeStockRow {
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly productId: string;
  readonly locationId: string;
  readonly free: number;
  readonly locationLocked: boolean;
  readonly preventAllocation: boolean;
  readonly countLocked: boolean;
}

/** The raw row `freeStockSql` selects (camelCase aliases are quoted). */
export interface FreeStockSqlRow {
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly productId: string;
  readonly locationId: string;
  readonly free: number | string;
  readonly locked: boolean | number | null;
  readonly prevent: boolean | number | null;
  readonly countLocked: number | string;
}

/**
 * The free stock query for one WMS schema. `filter` may be a list of product ids (the Projects
 * shortage reader) or the full WMS filter. An empty product list selects nothing.
 */
export function freeStockSql(schemaName: string, filter: FreeStockFilter | readonly string[] = {}): SQL {
  const options: FreeStockFilter = Array.isArray(filter) ? { productIds: filter as readonly string[] } : (filter as FreeStockFilter);
  const inventory = wmsTable(schemaName, 'inventory');
  const locations = wmsTable(schemaName, 'locations');
  const planLines = wmsTable(schemaName, 'count_plan_lines');
  const plans = wmsTable(schemaName, 'count_plans');
  const conditions: SQL[] = [];
  if (options.productIds) {
    const ids = [...new Set(options.productIds)];
    if (ids.length === 0) return sql`SELECT NULL::text AS "warehouseId" WHERE false`;
    conditions.push(sql`i.product_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (options.warehouseId) conditions.push(sql`i.warehouse_id = ${options.warehouseId}`);
  if (options.clientId) conditions.push(sql`i.client_id = ${options.clientId}`);
  conditions.push(sql`i.status = 'Stock'`, sql`i.damage_reason IS NULL`, sql`(i.on_hand - i.allocated) > 0`);
  return sql`
    SELECT i.warehouse_id AS "warehouseId", i.client_id AS "clientId", i.product_id AS "productId",
           i.location_id AS "locationId", i.on_hand - i.allocated AS "free",
           l.is_locked AS "locked", l.prevent_allocation AS "prevent",
           CASE WHEN NOT EXISTS (
             SELECT 1 FROM ${planLines} cl JOIN ${plans} cp ON cp.id = cl.plan_id
              WHERE cp.lock_locations
                AND cp.status IN (${statusList(COUNT_LOCKING_PLAN_STATUSES)})
                AND cl.status NOT IN (${statusList(COUNT_RELEASED_LINE_STATUSES)})
                AND (
                  cl.location_id = i.location_id
                  OR (cl.location_id IS NULL AND cl.product_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM ${inventory} ci
                     WHERE ci.location_id = i.location_id AND ci.product_id = cl.product_id
                       AND ci.warehouse_id = cp.warehouse_id AND ci.on_hand > 0))
                )) THEN 0 ELSE 1 END AS "countLocked"
      FROM ${inventory} i
      JOIN ${locations} l ON l.id = i.location_id
     WHERE ${sql.join(conditions, sql` AND `)}`;
}

/** Maps the raw rows of `freeStockSql` (either driver) to `FreeStockRow`. */
export function mapFreeStockRows(rows: readonly FreeStockSqlRow[]): FreeStockRow[] {
  return rows.map((row) => ({
    warehouseId: row.warehouseId,
    clientId: row.clientId,
    productId: row.productId,
    locationId: row.locationId,
    free: Number(row.free),
    locationLocked: Boolean(row.locked),
    preventAllocation: Boolean(row.prevent),
    countLocked: Number(row.countLocked) === 1,
  }));
}

/** Free buckets (optionally filtered) with the lock flags, in one query. */
export async function freeStockRows(db: Executor, schemaName: string, filter: FreeStockFilter = {}): Promise<FreeStockRow[]> {
  if (filter.productIds && filter.productIds.length === 0) return [];
  return mapFreeStockRows(await queryRows<FreeStockSqlRow>(db, freeStockSql(schemaName, filter)));
}
