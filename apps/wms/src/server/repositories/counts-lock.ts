/**
 * Count-plan location locks (M07 checklist 6). A location is locked while an open count plan with
 * Lock Locations = Yes has an open line on it:
 *   - a location line (Location mode, or a SKU line expanded per location by Create Job), or
 *   - a not-yet-expanded SKU line whose product is stocked in the location.
 * The lock lifts as soon as the plan / line is cancelled, posted (Inventory Updated) or replaced by a recount.
 * Ledger enforcement is requested in docs/requests/counts.md REQ-1; this helper is the intended entry point.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { Tx } from '@/server/domain/types';
import { dbGet } from '@/server/db/sql';

export const LOCKING_PLAN_STATUSES = [
  'Pending',
  'Ready To Count',
  'Count Started',
  'Count Completed',
] as const;
export const RELEASED_LINE_STATUSES = ['Cancelled', 'Inventory Updated', 'Recount Created'] as const;

/** Code of the open count plan that locks `locationId`, or null. */
export async function countLockFor(tx: Tx | AppDb, locationId: string): Promise<string | null> {
  const row = await dbGet<{ code: string }>(
    tx,
    sql`
    SELECT p.code AS code FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id
    WHERE p.lock_locations = true
      AND p.status IN ('Pending', 'Ready To Count', 'Count Started', 'Count Completed')
      AND l.status NOT IN ('Cancelled', 'Inventory Updated', 'Recount Created')
      AND (
        l.location_id = ${locationId}
        OR (l.location_id IS NULL AND l.product_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM inventory i
          WHERE i.location_id = ${locationId} AND i.product_id = l.product_id AND i.warehouse_id = p.warehouse_id AND i.on_hand > 0))
      )
    ORDER BY p.created_at
    LIMIT 1`,
  );
  return row?.code ?? null;
}

/** Message the ledger should raise for a blocked move. */
export function countLockMessage(locationCode: string, planCode: string): string {
  return `Location ${locationCode} is locked by count plan ${planCode}. Finish, update or cancel the count first.`;
}
