/**
 * Count-plan location locks (BUILD_PLAN M07 checklist 6, docs/requests/counts.md REQ-1).
 * A location is locked while an open count plan with Lock Locations = Yes has an open line on it:
 *   - a location line (Location mode, or a SKU line expanded per location by Create Job), or
 *   - a not-yet-expanded SKU line whose product is stocked in the location.
 * The lock lifts when the plan / line is cancelled, posted (Inventory Updated) or replaced by a recount.
 * The ledger rejects moves in or out of such locations; in-place adjustments (count posting) are exempt.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { ruleViolation } from "../errors";
import type { Tx } from "../types";

export const LOCKING_PLAN_STATUSES = ["Pending", "Ready To Count", "Count Started", "Count Completed"] as const;
export const RELEASED_LINE_STATUSES = ["Cancelled", "Inventory Updated", "Recount Created"] as const;

/** SQL predicate: an open locking count plan covers the location given by `locationId` (column or value). */
function lockExists(locationId: AnyColumn | string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id
    WHERE cp.lock_locations = 1
      AND cp.status IN ('Pending', 'Ready To Count', 'Count Started', 'Count Completed')
      AND cl.status NOT IN ('Cancelled', 'Inventory Updated', 'Recount Created')
      AND (
        cl.location_id = ${locationId}
        OR (cl.location_id IS NULL AND cl.product_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM inventory ci
          WHERE ci.location_id = ${locationId} AND ci.product_id = cl.product_id
            AND ci.warehouse_id = cp.warehouse_id AND ci.on_hand > 0))
      ))`;
}

/** Predicate for queries over locations: true when the location column is NOT count-locked. */
export function notCountLocked(locationIdColumn: AnyColumn): SQL {
  return sql`NOT ${lockExists(locationIdColumn)}`;
}

/** Code of the open count plan that locks `locationId`, or null. */
export function countLockFor(tx: Tx, locationId: string): string | null {
  const row = tx.get<{ code: string }>(sql`
    SELECT cp.code AS code FROM count_plan_lines cl JOIN count_plans cp ON cp.id = cl.plan_id
    WHERE cp.lock_locations = 1
      AND cp.status IN ('Pending', 'Ready To Count', 'Count Started', 'Count Completed')
      AND cl.status NOT IN ('Cancelled', 'Inventory Updated', 'Recount Created')
      AND (
        cl.location_id = ${locationId}
        OR (cl.location_id IS NULL AND cl.product_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM inventory ci
          WHERE ci.location_id = ${locationId} AND ci.product_id = cl.product_id
            AND ci.warehouse_id = cp.warehouse_id AND ci.on_hand > 0))
      )
    ORDER BY cp.created_at
    LIMIT 1`);
  return row?.code ?? null;
}

export function countLockMessage(locationCode: string, planCode: string): string {
  return `Location ${locationCode} is locked by count plan ${planCode}. Finish, update or cancel the count first.`;
}

/** Throws RULE_VIOLATION naming the count plan when the location is count-locked. */
export function assertNotCountLocked(tx: Tx, location: { readonly id: string; readonly code: string }): void {
  const plan = countLockFor(tx, location.id);
  if (plan) throw ruleViolation(countLockMessage(location.code, plan), { countPlanCode: plan, locationId: location.id, locationCode: location.code });
}
