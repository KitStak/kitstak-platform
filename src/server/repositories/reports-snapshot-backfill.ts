/**
 * Inventory Snapshot catch-up (M13 round 6, critic R5 "four nights permanently lost").
 *
 * The nightly snapshot (scheduler F6) only runs while the server is up, so a night the server
 * was down left a hole in point-in-time inventory and 3PL storage billing. Every on-hand
 * change is in the inventory ledger, and the ledger reconciles to every bucket (BUILD_PLAN
 * 0.4 #6: on-hand = Σ to − Σ from), so the inventory of any past instant T is exact:
 *
 *   on-hand(bucket, T) = on-hand now − (Σ to after T − Σ from after T)
 *
 * Bucket attributes (location, LP, lot, status, pack type, dates, damage) never change in
 * place: a status or location change moves quantity to another bucket. A bucket deleted after
 * it emptied keeps its attributes on the ledger rows that touched it. So a rebuilt snapshot is
 * the same rows the 00:02 run would have written that night.
 *
 * `backfillMissingSnapshots` fills every missing business day (interior gaps and trailing days
 * up to today once 00:02 has passed) within `SNAPSHOT_BACKFILL_DAYS`, stamped at 00:02 local
 * time of that business day. It never touches a day that already has a run.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { inventorySnapshots } from "@/server/db/schema";
import { isValidTimeZone, localMidnightUtc, localParts } from "@/server/scheduler/timezone";
import { classifySnapshotRuns, missingSnapshotDays } from "./reports-inventory";
import { dbAll, mapSeq, withWriteTx } from "@/server/db/sql";

/** How far back a missing night is rebuilt (matches the coverage note's 30-day window). */
export const SNAPSHOT_BACKFILL_DAYS = 31;
/** Local time of the nightly run; a rebuilt snapshot is stamped at this time. */
export const SNAPSHOT_STAMP = { hour: 0, minute: 2 } as const;

const INSERT_CHUNK = 500;
const addDay = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** UTC instant of 00:02 local time on `day` in `tz`. */
export function snapshotInstant(day: string, tz: string): string {
  return new Date(localMidnightUtc(day, tz).getTime() + (SNAPSHOT_STAMP.hour * 60 + SNAPSHOT_STAMP.minute) * 60_000).toISOString();
}

export interface RebuiltRow {
  readonly snapshotAt: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly productId: string;
  readonly locationId: string;
  readonly lpId: string | null;
  readonly parentLpId: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly damageReason: string | null;
  readonly status: string;
  readonly packType: string;
  readonly uomQty: number;
  readonly packQty: number;
}

/**
 * Inventory of `warehouseId` at instant `atIso`, one row per non-empty bucket, in the shape of
 * `inventory_snapshots`. Pure read.
 */
export async function rebuildSnapshotRows(db: AppDb, warehouseId: string, atIso: string): Promise<RebuiltRow[]> {
  const rows = await dbAll<{
    clientId: string | null; productId: string; locationId: string | null; lpId: string | null; parentLpId: string | null;
    lotNumber: string | null; expiryDate: string | null; productionDate: string | null; damageReason: string | null;
    status: string | null; packType: string | null; qty: number; perPack: number | null;
  }>(db, sql`
    WITH after_t AS (
      SELECT to_inventory_id AS bid, uom_qty AS q FROM inventory_transactions
        WHERE warehouse_id = ${warehouseId} AND to_inventory_id IS NOT NULL AND at >= ${atIso}
      UNION ALL
      SELECT from_inventory_id, -uom_qty FROM inventory_transactions
        WHERE warehouse_id = ${warehouseId} AND from_inventory_id IS NOT NULL AND at >= ${atIso}
    ),
    net AS (SELECT bid, SUM(q) AS q FROM after_t GROUP BY bid),
    buckets AS (
      SELECT id AS bid FROM inventory WHERE warehouse_id = ${warehouseId}
      UNION
      SELECT bid FROM net
    ),
    qty AS (
      SELECT b.bid, COALESCE(i.on_hand, 0) - COALESCE(n.q, 0) AS qty
      FROM buckets b LEFT JOIN inventory i ON i.id = b.bid LEFT JOIN net n ON n.bid = b.bid
    ),
    -- Attributes of buckets deleted after they emptied: the last ledger row that touched them.
    last_tx AS (
      SELECT q.bid,
        (SELECT t.id FROM inventory_transactions t WHERE t.to_inventory_id = q.bid OR t.from_inventory_id = q.bid ORDER BY t.seq DESC LIMIT 1) AS tid
      FROM qty q LEFT JOIN inventory i ON i.id = q.bid WHERE q.qty > 0 AND i.id IS NULL
    )
    SELECT
      COALESCE(i.client_id, p.client_id, t.client_id) AS "clientId",
      COALESCE(i.product_id, t.product_id) AS "productId",
      COALESCE(i.location_id, CASE WHEN t.to_inventory_id = q.bid THEN t.to_location_id ELSE t.from_location_id END) AS "locationId",
      CASE WHEN i.id IS NOT NULL THEN i.lp_id WHEN t.to_inventory_id = q.bid THEN t.to_lp_id ELSE t.from_lp_id END AS "lpId",
      COALESCE(lp.parent_lp_id, CASE WHEN i.id IS NULL THEN (CASE WHEN t.to_inventory_id = q.bid THEN t.to_parent_lp_id ELSE t.from_parent_lp_id END) END) AS "parentLpId",
      CASE WHEN i.id IS NOT NULL THEN i.lot_number WHEN t.to_inventory_id = q.bid THEN t.to_lot ELSE t.from_lot END AS "lotNumber",
      CASE WHEN i.id IS NOT NULL THEN i.expiry_date WHEN t.to_inventory_id = q.bid THEN t.to_expiry ELSE t.from_expiry END AS "expiryDate",
      CASE WHEN i.id IS NOT NULL THEN i.production_date WHEN t.to_inventory_id = q.bid THEN t.to_production_date ELSE t.from_production_date END AS "productionDate",
      CASE WHEN i.id IS NOT NULL THEN i.damage_reason WHEN t.to_inventory_id = q.bid THEN t.to_damage_reason ELSE t.from_damage_reason END AS "damageReason",
      COALESCE(i.status, CASE WHEN t.to_inventory_id = q.bid THEN t.to_status ELSE t.from_status END, 'Stock') AS "status",
      COALESCE(i.pack_type, CASE WHEN t.to_inventory_id = q.bid THEN t.to_pack_type ELSE t.from_pack_type END, 'Each') AS "packType",
      q.qty AS "qty",
      (SELECT NULLIF(pt.uom_qty, 0) FROM product_pack_types pt
        WHERE pt.product_id = COALESCE(i.product_id, t.product_id)
          AND pt.pack_type = COALESCE(i.pack_type, CASE WHEN t.to_inventory_id = q.bid THEN t.to_pack_type ELSE t.from_pack_type END, 'Each') LIMIT 1) AS "perPack"
    FROM qty q
    LEFT JOIN inventory i ON i.id = q.bid
    LEFT JOIN last_tx lt ON lt.bid = q.bid
    LEFT JOIN inventory_transactions t ON t.id = lt.tid
    LEFT JOIN products p ON p.id = COALESCE(i.product_id, t.product_id)
    LEFT JOIN license_plates lp ON lp.id = CASE WHEN i.id IS NOT NULL THEN i.lp_id WHEN t.to_inventory_id = q.bid THEN t.to_lp_id ELSE t.from_lp_id END
    WHERE q.qty > 0`);
  return rows
    .filter((r) => r.clientId && r.locationId && r.productId)
    .map((r) => ({
      snapshotAt: atIso,
      warehouseId,
      clientId: r.clientId as string,
      productId: r.productId,
      locationId: r.locationId as string,
      lpId: r.lpId,
      parentLpId: r.parentLpId,
      lotNumber: r.lotNumber,
      expiryDate: r.expiryDate,
      productionDate: r.productionDate,
      damageReason: r.damageReason,
      status: r.status ?? "Stock",
      packType: r.packType ?? "Each",
      uomQty: Number(r.qty),
      packQty: Math.floor(Number(r.qty) / Math.max(1, Number(r.perPack ?? 1))),
    }));
}

/**
 * Business days to rebuild for one warehouse: interior gaps between its runs plus the days
 * after its last run up to today (today only once its 00:02 has passed), never before the
 * window start. Pure.
 */
export function daysToBackfill(runDays: readonly string[], today: string, pastStampToday: boolean, windowDays = SNAPSHOT_BACKFILL_DAYS): string[] {
  const floor = addDay(today, -(windowDays - 1));
  const have = new Set(runDays);
  const sorted = [...have].sort();
  const out = new Set<string>();
  const interior = missingSnapshotDays(sorted.map((d) => ({ warehouseId: "w", snapshotAt: d, businessDate: d, superseded: false, latest: false })), "w");
  interior.forEach((d) => out.add(d));
  const last = sorted[sorted.length - 1];
  const lastWanted = pastStampToday ? today : addDay(today, -1);
  if (last) for (let d = addDay(last, 1); d <= lastWanted; d = addDay(d, 1)) out.add(d);
  return [...out].filter((d) => d >= floor && d <= lastWanted && !have.has(d)).sort();
}

export interface BackfillResult {
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly days: readonly { readonly businessDate: string; readonly snapshotAt: string; readonly rows: number }[];
}

/**
 * Rebuilds every missing night for the given warehouses (all when omitted) in one transaction
 * per warehouse. Idempotent: a day that has any run is skipped, so running it twice, or the
 * scheduler taking the night later, never double-counts a bucket.
 */
export async function backfillMissingSnapshots(db: AppDb, opts: { readonly warehouseIds?: readonly string[]; readonly now?: Date } = {}): Promise<BackfillResult[]> {
  const now = opts.now ?? new Date();
  const whs = (await dbAll<{ id: string; code: string; tz: string | null }>(db, sql`SELECT id, code, timezone AS tz FROM warehouses ORDER BY code`))
    .filter((w) => !opts.warehouseIds || opts.warehouseIds.includes(w.id));
  const raw = await dbAll<{ warehouseId: string; snapshotAt: string; timezone: string | null }>(db, sql`
    SELECT s.warehouse_id AS "warehouseId", s.snapshot_at AS "snapshotAt", w.timezone AS "timezone"
    FROM inventory_snapshots s JOIN warehouses w ON w.id = s.warehouse_id GROUP BY s.warehouse_id, s.snapshot_at, w.timezone ORDER BY s.warehouse_id, s.snapshot_at`);
  const runs = classifySnapshotRuns(raw);
  const out: BackfillResult[] = [];
  for (const w of whs) {
    const tz = w.tz && isValidTimeZone(w.tz) ? w.tz : "UTC";
    const local = localParts(now, tz);
    const past = local.hour > SNAPSHOT_STAMP.hour || (local.hour === SNAPSHOT_STAMP.hour && local.minute >= SNAPSHOT_STAMP.minute);
    const runDays = runs.filter((r) => r.warehouseId === w.id).map((r) => r.businessDate);
    // A warehouse with no run at all has no baseline night to catch up from: the scheduler's
    // first run starts its history.
    if (runDays.length === 0) continue;
    const days = daysToBackfill(runDays, local.date, past);
    if (days.length === 0) continue;
    const done = await withWriteTx(db, async (tx) => await mapSeq(days, async (day) => {
      const at = snapshotInstant(day, tz);
      const rows = await rebuildSnapshotRows(tx, w.id, at);
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) await tx.insert(inventorySnapshots).values(rows.slice(i, i + INSERT_CHUNK));
      return { businessDate: day, snapshotAt: at, rows: rows.length };
    }));
    out.push({ warehouseId: w.id, warehouse: w.code, days: done });
  }
  return out;
}
