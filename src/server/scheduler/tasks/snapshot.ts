/**
 * Nightly inventory snapshot (BUILD_PLAN F6), at 00:02 warehouse-local time.
 *
 * Checked every minute: for each warehouse whose local clock is past 00:02 and that has no
 * snapshot since its local midnight, every non-empty bucket is copied into
 * `inventory_snapshots` in one transaction. Idempotent and self-healing (a missed night is
 * taken on the next tick). Snapshots feed the Inventory Snapshot report and 3PL storage
 * billing; rows older than the retention window are pruned.
 */
import { and, eq, gt, gte, lt } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { inventory, inventorySnapshots, licensePlates, productPackTypes, products, warehouses } from "@/server/db/schema";
import { isValidTimeZone, localMidnightUtc, localParts } from "../timezone";
import type { SchedulerTask, SchedulerTaskContext, TaskResult } from "../types";

export const SNAPSHOT_LOCAL_TIME = { hour: 0, minute: 2 } as const;
export const SNAPSHOT_RETENTION_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isPastSnapshotTime(hour: number, minute: number): boolean {
  return hour > SNAPSHOT_LOCAL_TIME.hour || (hour === SNAPSHOT_LOCAL_TIME.hour && minute >= SNAPSHOT_LOCAL_TIME.minute);
}

const INSERT_CHUNK = 500;

/** Copies the warehouse's current non-empty buckets into `inventory_snapshots`. */
export function snapshotWarehouse(db: AppDb, warehouseId: string, snapshotAt: string): number {
  const buckets = db.select({
    warehouseId: inventory.warehouseId,
    clientId: inventory.clientId,
    productClientId: products.clientId,
    productId: inventory.productId,
    locationId: inventory.locationId,
    lpId: inventory.lpId,
    parentLpId: licensePlates.parentLpId,
    lotNumber: inventory.lotNumber,
    expiryDate: inventory.expiryDate,
    productionDate: inventory.productionDate,
    damageReason: inventory.damageReason,
    status: inventory.status,
    packType: inventory.packType,
    onHand: inventory.onHand,
  }).from(inventory)
    .innerJoin(products, eq(products.id, inventory.productId))
    .leftJoin(licensePlates, eq(licensePlates.id, inventory.lpId))
    .where(and(eq(inventory.warehouseId, warehouseId), gt(inventory.onHand, 0)))
    .all();
  if (buckets.length === 0) return 0;

  const packSizes = new Map(db.select({ productId: productPackTypes.productId, packType: productPackTypes.packType, uomQty: productPackTypes.uomQty })
    .from(productPackTypes).all().map((p) => [`${p.productId}|${p.packType}`, p.uomQty]));
  const rows = buckets.map((b) => {
    const perPack = Math.max(1, packSizes.get(`${b.productId}|${b.packType}`) ?? 1);
    return {
      snapshotAt,
      warehouseId: b.warehouseId,
      clientId: b.clientId ?? b.productClientId,
      productId: b.productId,
      locationId: b.locationId,
      lpId: b.lpId,
      parentLpId: b.parentLpId ?? null,
      lotNumber: b.lotNumber,
      expiryDate: b.expiryDate,
      productionDate: b.productionDate,
      damageReason: b.damageReason,
      status: b.status,
      packType: b.packType,
      uomQty: b.onHand,
      packQty: Math.floor(b.onHand / perPack),
    };
  });
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    db.insert(inventorySnapshots).values(rows.slice(i, i + INSERT_CHUNK)).run();
  }
  return rows.length;
}

function hasSnapshotSince(db: AppDb, warehouseId: string, sinceIso: string): boolean {
  return db.select({ id: inventorySnapshots.id }).from(inventorySnapshots)
    .where(and(eq(inventorySnapshots.warehouseId, warehouseId), gte(inventorySnapshots.snapshotAt, sinceIso)))
    .limit(1).get() !== undefined;
}

export function pruneSnapshots(db: AppDb, now: Date): number {
  const cutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS).toISOString();
  return db.delete(inventorySnapshots).where(lt(inventorySnapshots.snapshotAt, cutoff)).run().changes;
}

export function runSnapshots(ctx: SchedulerTaskContext): TaskResult {
  const taken: string[] = [];
  let rows = 0;
  for (const wh of ctx.db.select({ id: warehouses.id, code: warehouses.code, timezone: warehouses.timezone }).from(warehouses).all()) {
    const zone = isValidTimeZone(wh.timezone) ? wh.timezone : "UTC";
    if (zone !== wh.timezone) ctx.log.warn("snapshot: invalid warehouse timezone, using UTC", { warehouseId: wh.id, timezone: wh.timezone });
    const local = localParts(ctx.now, zone);
    if (!isPastSnapshotTime(local.hour, local.minute)) continue;
    const midnight = localMidnightUtc(local.date, zone).toISOString();
    if (hasSnapshotSince(ctx.db, wh.id, midnight)) continue;
    rows += ctx.db.transaction((tx) => snapshotWarehouse(tx, wh.id, ctx.now.toISOString()));
    taken.push(wh.code);
  }
  const pruned = pruneSnapshots(ctx.db, ctx.now);
  if (taken.length === 0) return { status: "skipped", message: pruned > 0 ? `Pruned ${pruned} old snapshot rows` : "No warehouse due" };
  ctx.log.info("inventory snapshot taken", { warehouses: taken, rows, pruned });
  return { status: "ok", message: `Snapshot of ${taken.join(", ")}: ${rows} rows` };
}

export const snapshotTask: SchedulerTask = {
  key: "inventory-snapshot",
  title: "Nightly inventory snapshot",
  owner: "foundation",
  configured: true,
  schedule: { kind: "interval", everyMs: 60_000 },
  run: runSnapshots,
};
