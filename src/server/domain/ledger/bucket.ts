/**
 * Inventory buckets. One `inventory` row per (warehouse, client, product, location, LP,
 * lot, expiry, production date, damage reason, pack type, status); `bucket_key` is the
 * sha1 of that tuple. Rows are kept at 0 on-hand so their ledger history still balances.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { InventoryStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError } from "../errors";
import { nowIso, type Tx } from "../types";

export type InventoryRow = typeof schema.inventory.$inferSelect;
export type AllocationRow = typeof schema.inventoryAllocations.$inferSelect;

export interface BucketSpec {
  readonly warehouseId: string;
  readonly clientId: string;
  readonly productId: string;
  readonly locationId: string;
  readonly lpId: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly damageReason: string | null;
  readonly packType: string;
  readonly status: InventoryStatus;
}

/** Allocation statuses that still hold stock. */
export const ACTIVE_ALLOCATION_STATUSES = ["Allocated", "Picked", "Sorted", "Packed", "Loaded"] as const;

export function bucketKey(spec: BucketSpec): string {
  const parts = [spec.warehouseId, spec.clientId, spec.productId, spec.locationId, spec.lpId, spec.lotNumber,
    spec.expiryDate, spec.productionDate, spec.damageReason, spec.packType, spec.status];
  return createHash("sha1").update(parts.map((p) => p ?? "\u0000").join("\u001f")).digest("hex");
}

export function specOf(row: InventoryRow): BucketSpec {
  if (!row.clientId) throw new DomainError("INVALID_STATE", "Inventory row has no client; run db:reset to rebuild buckets.");
  return {
    warehouseId: row.warehouseId, clientId: row.clientId, productId: row.productId, locationId: row.locationId,
    lpId: row.lpId, lotNumber: row.lotNumber, expiryDate: row.expiryDate, productionDate: row.productionDate,
    damageReason: row.damageReason, packType: row.packType, status: row.status,
  };
}

const eqOrNull = (col: SQLiteColumn, value: string | null): SQL => (value === null ? isNull(col) : eq(col, value));

export function getBucket(tx: Tx, inventoryId: string): InventoryRow {
  const row = tx.select().from(schema.inventory).where(eq(schema.inventory.id, inventoryId)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Inventory not found");
  return row;
}

export function findBucket(tx: Tx, spec: BucketSpec): InventoryRow | undefined {
  const key = bucketKey(spec);
  const byKey = tx.select().from(schema.inventory).where(eq(schema.inventory.bucketKey, key)).get();
  if (byKey) return byKey;
  const i = schema.inventory;
  // Legacy rows (placeholder key): match the tuple and adopt the real key.
  const legacy = tx.select().from(i).where(and(
    eq(i.warehouseId, spec.warehouseId), eq(i.clientId, spec.clientId), eq(i.productId, spec.productId),
    eq(i.locationId, spec.locationId), eqOrNull(i.lpId, spec.lpId), eqOrNull(i.lotNumber, spec.lotNumber),
    eqOrNull(i.expiryDate, spec.expiryDate), eqOrNull(i.productionDate, spec.productionDate),
    eqOrNull(i.damageReason, spec.damageReason), eq(i.packType, spec.packType), eq(i.status, spec.status),
    sql`${i.bucketKey} LIKE ${`${schema.LEGACY_BUCKET_KEY_PREFIX}%`}`,
  )).get();
  if (!legacy) return undefined;
  tx.update(i).set({ bucketKey: key }).where(eq(i.id, legacy.id)).run();
  return { ...legacy, bucketKey: key };
}

export interface BucketExtras {
  readonly receivedAt?: string;
  readonly poNumber?: string | null;
}

export function findOrCreateBucket(tx: Tx, spec: BucketSpec, extras: BucketExtras = {}): InventoryRow {
  const existing = findBucket(tx, spec);
  if (existing) return existing;
  return tx.insert(schema.inventory).values({
    ...spec,
    bucketKey: bucketKey(spec),
    onHand: 0,
    allocated: 0,
    damaged: 0,
    receivedAt: extras.receivedAt ?? nowIso(),
    poNumber: extras.poNumber ?? null,
  }).returning().get();
}

/** Sum of active allocation qty pointing at a bucket. */
export function activeAllocatedQty(tx: Tx, inventoryId: string): number {
  const row = tx.select({ total: sql<number>`COALESCE(SUM(${schema.inventoryAllocations.qty}), 0)` })
    .from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.inventoryId, inventoryId),
      inArray(schema.inventoryAllocations.status, [...ACTIVE_ALLOCATION_STATUSES])))
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Applies a signed on-hand delta and re-derives `allocated` / `damaged`.
 * Enforces the 0.4 #1 invariants: on-hand >= 0 and allocated <= on-hand - damaged.
 */
export function applyDelta(tx: Tx, bucket: InventoryRow, delta: number): InventoryRow {
  const onHand = bucket.onHand + delta;
  if (onHand < 0) {
    throw new DomainError("INSUFFICIENT_STOCK", `Not enough stock: ${bucket.onHand} on hand, ${-delta} requested.`, { inventoryId: bucket.id });
  }
  const allocated = activeAllocatedQty(tx, bucket.id);
  const damaged = bucket.damageReason ? onHand : 0;
  if (allocated > onHand - damaged) {
    throw new DomainError("INSUFFICIENT_STOCK", `Stock is allocated: ${allocated} of ${onHand - damaged} available units are reserved.`, { inventoryId: bucket.id });
  }
  return tx.update(schema.inventory)
    .set({ onHand, allocated, damaged, version: sql`${schema.inventory.version} + 1` })
    .where(eq(schema.inventory.id, bucket.id)).returning().get();
}

/** Re-derives `allocated` after allocation rows changed (on-hand unchanged). */
export function syncAllocated(tx: Tx, inventoryId: string): InventoryRow {
  const bucket = getBucket(tx, inventoryId);
  return applyDelta(tx, bucket, 0);
}

export const freeQty = (bucket: InventoryRow): number => bucket.onHand - bucket.allocated;

/** Updates the LP's status after its buckets changed. */
export function refreshLpStatus(tx: Tx, lpId: string | null): void {
  if (!lpId) return;
  const row = tx.select({ total: sql<number>`COALESCE(SUM(${schema.inventory.onHand}), 0)` })
    .from(schema.inventory).where(eq(schema.inventory.lpId, lpId)).get();
  const status = Number(row?.total ?? 0) > 0 ? "Occupied" : "Empty";
  tx.update(schema.licensePlates).set({ status })
    .where(and(eq(schema.licensePlates.id, lpId), notInArray(schema.licensePlates.status, ["Shipped", "Removed"]))).run();
}

/** UOM units per pack for a product pack type (1 when the pack type is not defined). */
export function packRatio(tx: Tx, productId: string, packType: string): number {
  const row = tx.select({ uomQty: schema.productPackTypes.uomQty }).from(schema.productPackTypes)
    .where(and(eq(schema.productPackTypes.productId, productId), eq(schema.productPackTypes.packType, packType))).get();
  return row && row.uomQty > 0 ? row.uomQty : 1;
}
