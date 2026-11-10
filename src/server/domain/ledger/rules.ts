/**
 * Location and LP-type mixing rules enforced by every ledger write that places stock
 * (BUILD_PLAN F5 ledger "Enforces"). Violations throw RULE_VIOLATION with a message
 * naming the rule and the location / LP.
 */
import { and, eq, gt, inArray, ne } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError, ruleViolation } from "../errors";
import type { Tx } from "../types";
import { ACTIVE_ALLOCATION_STATUSES, packRatio, type BucketSpec } from "./bucket";
import { assertNotCountLocked } from "./count-locks";

export type LocationRow = typeof schema.locations.$inferSelect;
export type LpRow = typeof schema.licensePlates.$inferSelect;

export function getLocation(tx: Tx, locationId: string): LocationRow {
  const row = tx.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Location not found");
  return row;
}

export function getLp(tx: Tx, lpId: string): LpRow {
  const row = tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lpId)).get();
  if (!row) throw new DomainError("NOT_FOUND", "LP not found");
  return row;
}

export interface PlacementOptions {
  /** Bucket being moved out (excluded from the "other stock" checks). */
  readonly excludeInventoryId?: string;
  /** Count/adjustment of stock already in place: skips the locked check. */
  readonly inPlace?: boolean;
  /** Order/job the stock is committed to (LP onlyOneOrder/onlyOneJob). */
  readonly orderId?: string | null;
  readonly jobId?: string | null;
}

type Occupant = Pick<typeof schema.inventory.$inferSelect,
  "id" | "productId" | "clientId" | "lotNumber" | "expiryDate" | "productionDate" | "lpId" | "onHand" | "packType">;

function occupants(tx: Tx, where: ReturnType<typeof eq>, excludeId?: string): Occupant[] {
  const i = schema.inventory;
  const conds = [where, gt(i.onHand, 0)];
  if (excludeId) conds.push(ne(i.id, excludeId));
  return tx.select({
    id: i.id, productId: i.productId, clientId: i.clientId, lotNumber: i.lotNumber, expiryDate: i.expiryDate,
    productionDate: i.productionDate, lpId: i.lpId, onHand: i.onHand, packType: i.packType,
  }).from(i).where(and(...conds)).all();
}

function singleValueRule(
  others: readonly Occupant[],
  enabled: boolean,
  pick: (o: Occupant) => string | null,
  incoming: string | null,
  message: string,
): void {
  if (enabled && others.some((o) => pick(o) !== incoming)) throw ruleViolation(message);
}

export function assertLocationAccepts(tx: Tx, spec: BucketSpec, qty: number, opts: PlacementOptions = {}): LocationRow {
  const loc = getLocation(tx, spec.locationId);
  const label = `Location ${loc.code}`;
  if (loc.warehouseId !== spec.warehouseId) throw ruleViolation(`${label} belongs to another warehouse.`);
  if (!loc.isActive) throw ruleViolation(`${label} is inactive.`);
  if (loc.isLocked && !opts.inPlace) throw ruleViolation(`${label} is locked.`);
  if (!opts.inPlace) assertNotCountLocked(tx, loc);
  if (loc.onlyDamaged && !spec.damageReason) throw ruleViolation(`${label} only accepts damaged inventory.`);
  if (loc.dedicatedClientId && loc.dedicatedClientId !== spec.clientId) throw ruleViolation(`${label} is dedicated to another client.`);
  if (qty <= 0) return loc;

  const others = occupants(tx, eq(schema.inventory.locationId, loc.id), opts.excludeInventoryId);
  singleValueRule(others, loc.singleClient, (o) => o.clientId, spec.clientId, `${label} only allows a single client.`);
  singleValueRule(others, loc.onlyOneSku, (o) => o.productId, spec.productId, `${label} only allows one SKU.`);
  singleValueRule(others, loc.onlyOneLot, (o) => o.lotNumber, spec.lotNumber, `${label} only allows one lot/batch number.`);
  singleValueRule(others, loc.onlyOneExpiry, (o) => o.expiryDate, spec.expiryDate, `${label} only allows one expiry date.`);
  singleValueRule(others, loc.onlyOneProductionDate, (o) => o.productionDate, spec.productionDate, `${label} only allows one production date.`);
  singleValueRule(others.filter((o) => o.lpId !== null), loc.onlyOneLp && spec.lpId !== null, (o) => o.lpId, spec.lpId, `${label} only allows one LP.`);
  if (loc.maxSkuQty && loc.maxSkuQty > 0) {
    const skus = new Set([...others.map((o) => o.productId), spec.productId]);
    if (skus.size > loc.maxSkuQty) throw ruleViolation(`${label} allows at most ${loc.maxSkuQty} SKUs.`);
  }
  assertCapacity(tx, loc, others, spec, qty);
  return loc;
}

function assertCapacity(tx: Tx, loc: LocationRow, others: readonly Occupant[], spec: BucketSpec, qty: number): void {
  if (loc.capacityType === "None" || loc.maxCapacityQty <= 0) return;
  if (loc.capacityType === "Maximum Unit Quantity") {
    const used = others.reduce((sum, o) => sum + o.onHand, 0);
    if (used + qty > loc.maxCapacityQty) {
      throw ruleViolation(`Location ${loc.code} capacity exceeded: ${used} + ${qty} > ${loc.maxCapacityQty} units.`);
    }
    return;
  }
  const packs = others.reduce((sum, o) => sum + Math.ceil(o.onHand / packRatio(tx, o.productId, o.packType)), 0);
  const incoming = Math.ceil(qty / packRatio(tx, spec.productId, spec.packType));
  if (packs + incoming > loc.maxCapacityQty) {
    throw ruleViolation(`Location ${loc.code} capacity exceeded: ${packs} + ${incoming} > ${loc.maxCapacityQty} packs.`);
  }
}

/** Committed order/job ids of the stock on an LP. */
function lpCommitments(tx: Tx, lpId: string, excludeId?: string): { orderIds: Set<string>; jobIds: Set<string> } {
  const ids = occupants(tx, eq(schema.inventory.lpId, lpId), excludeId).map((o) => o.id);
  if (ids.length === 0) return { orderIds: new Set(), jobIds: new Set() };
  const rows = tx.select({ orderId: schema.inventoryAllocations.orderId, jobId: schema.inventoryAllocations.jobId })
    .from(schema.inventoryAllocations)
    .where(and(inArray(schema.inventoryAllocations.inventoryId, ids),
      inArray(schema.inventoryAllocations.status, [...ACTIVE_ALLOCATION_STATUSES]))).all();
  return {
    orderIds: new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : []))),
    jobIds: new Set(rows.flatMap((r) => (r.jobId ? [r.jobId] : []))),
  };
}

export function assertLpAccepts(tx: Tx, spec: BucketSpec, opts: PlacementOptions = {}): LpRow | null {
  if (!spec.lpId) return null;
  const lp = getLp(tx, spec.lpId);
  const label = `LP ${lp.number}`;
  if (lp.warehouseId !== spec.warehouseId) throw ruleViolation(`${label} belongs to another warehouse.`);
  if (lp.status === "Shipped" || lp.status === "Removed") throw ruleViolation(`${label} is ${lp.status.toLowerCase()}.`);
  if (lp.locationId && lp.locationId !== spec.locationId) {
    throw ruleViolation(`${label} is in another location. Move the LP or scan a different LP.`);
  }
  const type = tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, lp.lpTypeId)).get();
  if (!type) return lp;
  const others = occupants(tx, eq(schema.inventory.lpId, lp.id), opts.excludeInventoryId);
  singleValueRule(others, type.onlyOneSku, (o) => o.productId, spec.productId, `${label} (${type.code}) only allows one SKU.`);
  singleValueRule(others, type.onlyOneLot, (o) => o.lotNumber, spec.lotNumber, `${label} (${type.code}) only allows one lot/batch number.`);
  singleValueRule(others, type.onlyOneExpiry, (o) => o.expiryDate, spec.expiryDate, `${label} (${type.code}) only allows one expiry date.`);
  singleValueRule(others, type.onlyOneProductionDate, (o) => o.productionDate, spec.productionDate, `${label} (${type.code}) only allows one production date.`);
  singleValueRule(others, type.onlyOneClient, (o) => o.clientId, spec.clientId, `${label} (${type.code}) only allows one client.`);
  if (type.onlyOneOrder || type.onlyOneJob) {
    const c = lpCommitments(tx, lp.id, opts.excludeInventoryId);
    if (type.onlyOneOrder && opts.orderId && [...c.orderIds].some((id) => id !== opts.orderId)) {
      throw ruleViolation(`${label} (${type.code}) only allows one order.`);
    }
    if (type.onlyOneJob && opts.jobId && [...c.jobIds].some((id) => id !== opts.jobId)) {
      throw ruleViolation(`${label} (${type.code}) only allows one job.`);
    }
  }
  return lp;
}

/** Full placement check (location rules, then LP mixing rules); places the LP if it has no location. */
export function assertPlacement(tx: Tx, spec: BucketSpec, qty: number, opts: PlacementOptions = {}): void {
  assertLocationAccepts(tx, spec, qty, opts);
  const lp = assertLpAccepts(tx, spec, opts);
  if (lp && !lp.locationId) {
    tx.update(schema.licensePlates).set({ locationId: spec.locationId }).where(eq(schema.licensePlates.id, lp.id)).run();
  }
}

export function assertSourceMovable(tx: Tx, locationId: string): void {
  const loc = getLocation(tx, locationId);
  if (loc.isLocked) throw ruleViolation(`Location ${loc.code} is locked.`);
  assertNotCountLocked(tx, loc);
}
