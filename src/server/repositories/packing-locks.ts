/**
 * Count-plan lock checks for the stations (M04 round 6). The ledger refuses a move in or out of a
 * count-locked location at commit time; these helpers surface the same lock up front: on order
 * load, in List & Select, on the station pickers and before a return receive starts, so an operator
 * never packs or scans a session that cannot commit.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { Tx } from "@/server/domain/types";
import { countLockFor, countLockMessage } from "@/server/repositories/counts-lock";
import { dbAll, dbGet } from "@/server/db/sql";

export interface CountLockInfo {
  readonly locationId: string;
  readonly locationCode: string;
  readonly planCode: string;
  /** Count plan id, for a link to its detail page. */
  readonly planId: string | null;
  readonly message: string;
}

type Reader = AppDb | Tx;

/** Lock of one location (id), with its code and the ledger's wording; null when not locked. */
export async function locationLock(db: Reader, locationId: string | null | undefined): Promise<CountLockInfo | null> {
  if (!locationId) return null;
  const plan = await countLockFor(db, locationId);
  if (!plan) return null;
  const code = (await dbGet<{ code: string }>(db, sql`SELECT code FROM locations WHERE id = ${locationId}`))?.code ?? locationId;
  const planId = (await dbGet<{ id: string }>(db, sql`SELECT id FROM count_plans WHERE code = ${plan} LIMIT 1`))?.id ?? null;
  return { locationId, locationCode: code, planCode: plan, planId, message: countLockMessage(code, plan) };
}

/** Locations holding the order's picked (unpacked) stock: what Complete Packing moves out of. */
export async function packSourceLocations(db: Reader, orderId: string): Promise<string[]> {
  return (await dbAll<{ id: string }>(db, sql`SELECT DISTINCT i.location_id AS id FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id
    WHERE a.order_id = ${orderId} AND a.status IN ('Picked', 'Sorted') AND a.qty > 0 AND i.location_id IS NOT NULL ORDER BY i.location_id`)).map((r) => r.id);
}

/** First count lock that would stop Complete Packing of `orderId` at `stationId` (station first, then the staged stock). */
export async function packLock(db: Reader, orderId: string, stationId?: string | null): Promise<CountLockInfo | null> {
  const ids = [...(stationId ? [stationId] : []), ...await packSourceLocations(db, orderId)];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const lock = await locationLock(db, id);
    if (lock) return lock;
  }
  return null;
}

/** Operator copy for a locked pack: names the location and plan and says what to do. */
export function packLockMessage(orderCode: string, lock: CountLockInfo, stationId?: string | null): string {
  if (stationId && lock.locationId === stationId) {
    return `Station ${lock.locationCode} is locked by count plan ${lock.planCode}. Pack ${orderCode} at another station, or finish, update or cancel the count first.`;
  }
  return `${orderCode} can't be packed: its picked stock is in ${lock.locationCode}, which is locked by count plan ${lock.planCode}. Finish, update or cancel the count first.`;
}
