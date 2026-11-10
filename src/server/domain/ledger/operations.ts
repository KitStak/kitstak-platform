/**
 * Ledger quantity operations (BUILD_PLAN F5): add, remove, adjustTo, move, setStatus,
 * changeAttributes, consume, moveLocation, moveLp. These are the ONLY writers of
 * `inventory` and `inventory_transactions` (0.4 #1).
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import type { InventoryStatus, TxnType } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError, insufficientStock, ruleViolation } from "../errors";
import { checkScope, type DomainCtx, type Tx } from "../types";
import { carryAllocation, consumeAllocation, getAllocation } from "./allocations";
import {
  ACTIVE_ALLOCATION_STATUSES, applyDelta, bucketKey, findOrCreateBucket, freeQty, getBucket, packRatio,
  refreshLpStatus, specOf, type BucketSpec, type InventoryRow,
} from "./bucket";
import { assertPlacement, assertSourceMovable, getLocation, getLp } from "./rules";
import { carrySerials } from "./serials";
import { writeTxn, type TxnRefs, type TxnRow } from "./txn";

export interface LedgerResult {
  readonly bucket: InventoryRow;
  readonly txn: TxnRow | null;
}

function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new DomainError("VALIDATION", "Quantity must be a positive whole number");
}

const packQtyOf = (tx: Tx, b: Pick<InventoryRow, "productId" | "packType">, qty: number): number =>
  Math.trunc(qty / packRatio(tx, b.productId, b.packType));

/* -------------------------------------------------------------------- add */
export interface AddInput {
  readonly warehouseId: string;
  readonly clientId: string;
  readonly productId: string;
  readonly locationId: string;
  readonly lpId?: string | null;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly damageReason?: string | null;
  readonly packType?: string;
  readonly status?: InventoryStatus;
  readonly qty: number;
  readonly type?: TxnType;
  readonly refs?: TxnRefs;
  readonly receivedAt?: string;
  readonly poNumber?: string | null;
}

export function toSpec(input: AddInput, defaultPackType: string): BucketSpec {
  return {
    warehouseId: input.warehouseId, clientId: input.clientId, productId: input.productId, locationId: input.locationId,
    lpId: input.lpId ?? null, lotNumber: input.lotNumber ?? null, expiryDate: input.expiryDate ?? null,
    productionDate: input.productionDate ?? null, damageReason: input.damageReason ?? null,
    packType: input.packType ?? defaultPackType, status: input.status ?? "Stock",
  };
}

function productFor(tx: Tx, productId: string, clientId: string): typeof schema.products.$inferSelect {
  const product = tx.select().from(schema.products).where(eq(schema.products.id, productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  if (product.clientId !== clientId) throw new DomainError("VALIDATION", `Product ${product.sku} belongs to another client.`);
  return product;
}

export function add(tx: Tx, ctx: DomainCtx, input: AddInput): LedgerResult {
  assertQty(input.qty);
  checkScope(ctx, input, "Inventory");
  const product = productFor(tx, input.productId, input.clientId);
  const spec = toSpec(input, product.uom);
  assertPlacement(tx, spec, input.qty);
  const bucket = applyDelta(tx, findOrCreateBucket(tx, spec, { receivedAt: input.receivedAt, poNumber: input.poNumber }), input.qty);
  const txn = writeTxn(tx, ctx, { type: input.type ?? "Inventory Adjustment", from: null, to: bucket, uomQty: input.qty, packQty: packQtyOf(tx, bucket, input.qty), refs: input.refs });
  refreshLpStatus(tx, bucket.lpId);
  return { bucket, txn };
}

/* ----------------------------------------------------------------- remove */
export interface RemoveInput {
  readonly inventoryId: string;
  readonly qty: number;
  readonly type?: TxnType;
  readonly refs?: TxnRefs;
}

export function remove(tx: Tx, ctx: DomainCtx, input: RemoveInput): LedgerResult {
  assertQty(input.qty);
  const source = getBucket(tx, input.inventoryId);
  checkScope(ctx, source, "Inventory");
  assertSourceMovable(tx, source.locationId);
  if (freeQty(source) < input.qty) {
    throw insufficientStock(`Only ${freeQty(source)} unallocated units are available; ${input.qty} requested.`, { inventoryId: source.id });
  }
  const bucket = applyDelta(tx, source, -input.qty);
  const txn = writeTxn(tx, ctx, { type: input.type ?? "Inventory Adjustment", from: bucket, to: null, uomQty: input.qty, packQty: packQtyOf(tx, bucket, input.qty), refs: input.refs });
  refreshLpStatus(tx, bucket.lpId);
  return { bucket, txn };
}

/* --------------------------------------------------------------- adjustTo */
export interface AdjustToInput {
  /** Existing bucket, or `bucket` to create one (e.g. a count finding stock in a new bucket). */
  readonly inventoryId?: string;
  readonly bucket?: AddInput;
  readonly targetQty: number;
  readonly type?: Extract<TxnType, "Inventory Adjustment" | "Count">;
  readonly adjustmentReasonId?: string | null;
  readonly refs?: TxnRefs;
}

export function adjustTo(tx: Tx, ctx: DomainCtx, input: AdjustToInput): LedgerResult {
  if (!Number.isInteger(input.targetQty) || input.targetQty < 0) throw new DomainError("VALIDATION", "Target quantity must be zero or a positive whole number");
  const type = input.type ?? "Inventory Adjustment";
  let bucket: InventoryRow;
  if (input.inventoryId) {
    bucket = getBucket(tx, input.inventoryId);
  } else if (input.bucket) {
    const product = productFor(tx, input.bucket.productId, input.bucket.clientId);
    bucket = findOrCreateBucket(tx, toSpec(input.bucket, product.uom), { receivedAt: input.bucket.receivedAt });
  } else {
    throw new DomainError("VALIDATION", "Either inventoryId or bucket is required");
  }
  checkScope(ctx, bucket, "Inventory");
  const wh = tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, bucket.warehouseId)).get();
  const reasonRequired = type === "Count" ? wh?.mandatoryCountReason : wh?.mandatoryAdjustmentReason;
  if (reasonRequired && !input.adjustmentReasonId) throw new DomainError("VALIDATION", "An adjustment reason is required");
  const delta = input.targetQty - bucket.onHand;
  if (delta === 0) return { bucket, txn: null };
  if (input.targetQty < bucket.allocated) {
    throw insufficientStock(`${bucket.allocated} units are allocated; the quantity can't go below that.`, { inventoryId: bucket.id });
  }
  if (delta > 0) assertPlacement(tx, specOf(bucket), input.targetQty, { excludeInventoryId: bucket.id, inPlace: true });
  const updated = applyDelta(tx, bucket, delta);
  const txn = writeTxn(tx, ctx, {
    type, from: null, to: updated, uomQty: delta, packQty: packQtyOf(tx, updated, Math.abs(delta)) * Math.sign(delta),
    refs: { ...input.refs, adjustmentReasonId: input.adjustmentReasonId ?? input.refs?.adjustmentReasonId },
  });
  refreshLpStatus(tx, updated.lpId);
  return { bucket: updated, txn };
}

/* ------------------------------------------------------------------- move */
export interface MoveInput {
  readonly inventoryId: string;
  readonly qty: number;
  readonly toLocationId?: string;
  /** `null` takes the stock off its LP; omitted keeps the current LP. */
  readonly toLpId?: string | null;
  readonly toStatus?: InventoryStatus;
  readonly toPackType?: string;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly damageReason?: string | null;
  /** Moves allocated stock together with this allocation. */
  readonly allocationId?: string;
  /**
   * Serial-tracked products: carry serial rows with the units (default). Pass `false` when the
   * caller moves scanned serials itself (e.g. `pickSerial` after a scan-verified pick).
   */
  readonly carrySerials?: boolean;
  readonly type?: TxnType;
  readonly refs?: TxnRefs;
}

export interface MoveResult {
  readonly source: InventoryRow;
  readonly target: InventoryRow;
  readonly txn: TxnRow;
  /** Allocation now pointing at the target (when `allocationId` was given). */
  readonly allocationId: string | null;
}

const pickDefined = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);

export function move(tx: Tx, ctx: DomainCtx, input: MoveInput): MoveResult {
  assertQty(input.qty);
  const source = getBucket(tx, input.inventoryId);
  checkScope(ctx, source, "Inventory");
  const base = specOf(source);
  const spec: BucketSpec = {
    ...base,
    locationId: input.toLocationId ?? base.locationId,
    lpId: pickDefined(input.toLpId, base.lpId),
    status: input.toStatus ?? base.status,
    packType: input.toPackType ?? base.packType,
    lotNumber: pickDefined(input.lotNumber, base.lotNumber),
    expiryDate: pickDefined(input.expiryDate, base.expiryDate),
    productionDate: pickDefined(input.productionDate, base.productionDate),
    damageReason: pickDefined(input.damageReason, base.damageReason),
  };
  if (bucketKey(spec) === source.bucketKey) throw new DomainError("VALIDATION", "Source and target are the same.");
  const sameLocation = spec.locationId === base.locationId;
  if (!sameLocation) assertSourceMovable(tx, base.locationId);

  const alloc = input.allocationId ? getAllocation(tx, input.allocationId) : null;
  if (alloc) {
    if (alloc.inventoryId !== source.id || !(ACTIVE_ALLOCATION_STATUSES as readonly string[]).includes(alloc.status)) {
      throw new DomainError("INVALID_STATE", "The allocation does not hold stock in this bucket.");
    }
    if (alloc.qty < input.qty) throw insufficientStock(`Only ${alloc.qty} units are allocated; ${input.qty} requested.`);
  } else if (freeQty(source) < input.qty) {
    throw insufficientStock(`Only ${freeQty(source)} unallocated units are available; ${input.qty} requested.`, { inventoryId: source.id });
  }
  assertPlacement(tx, spec, input.qty, {
    excludeInventoryId: source.id, inPlace: sameLocation, orderId: alloc?.orderId, jobId: alloc?.jobId,
  });
  const targetRow = findOrCreateBucket(tx, spec, { receivedAt: source.receivedAt, poNumber: source.poNumber });
  const allocationId = alloc ? carryAllocation(tx, ctx, alloc, input.qty, targetRow.id, spec.status) : null;
  const updatedSource = applyDelta(tx, getBucket(tx, source.id), -input.qty);
  const target = applyDelta(tx, getBucket(tx, targetRow.id), input.qty);
  const txn = writeTxn(tx, ctx, {
    type: input.type ?? "Inventory Movement", from: updatedSource, to: target, uomQty: input.qty,
    packQty: packQtyOf(tx, target, input.qty),
    refs: { orderId: alloc?.orderId, orderLineId: alloc?.orderLineId, jobId: alloc?.jobId, taskId: alloc?.taskId, ...input.refs },
  });
  if (input.carrySerials !== false) {
    carrySerials(tx, ctx, {
      productId: source.productId, fromInventoryId: source.id, toInventoryId: target.id, qty: input.qty,
      sourceOnHand: updatedSource.onHand, toStatus: spec.status, orderLineId: input.refs?.orderLineId ?? alloc?.orderLineId ?? null,
      txnId: txn.id, type: txn.type,
    });
  }
  refreshLpStatus(tx, updatedSource.lpId);
  if (target.lpId !== updatedSource.lpId) refreshLpStatus(tx, target.lpId);
  return { source: updatedSource, target, txn, allocationId };
}

export function setStatus(
  tx: Tx, ctx: DomainCtx,
  input: { inventoryId: string; qty: number; toStatus: InventoryStatus; allocationId?: string; type?: TxnType; refs?: TxnRefs },
): MoveResult {
  return move(tx, ctx, { ...input, type: input.type ?? "Inventory Movement" });
}

export function changeAttributes(
  tx: Tx, ctx: DomainCtx,
  input: Pick<MoveInput, "inventoryId" | "qty" | "lotNumber" | "expiryDate" | "productionDate" | "damageReason" | "refs">,
): MoveResult {
  return move(tx, ctx, { ...input, type: "Attributes Change" });
}

/* ---------------------------------------------------------------- consume */
export interface ConsumeInput {
  readonly inventoryId: string;
  readonly qty: number;
  readonly allocationId?: string;
  readonly type: Extract<TxnType, "Shipment" | "Kitting" | "Disassemble Kit" | "Inventory Adjustment" | "Cancel Receiving">;
  readonly refs?: TxnRefs;
}

/** Takes stock out of the warehouse (shipment, kit consumption). Consumes allocated stock when `allocationId` is given. */
export function consume(tx: Tx, ctx: DomainCtx, input: ConsumeInput): LedgerResult {
  assertQty(input.qty);
  const source = getBucket(tx, input.inventoryId);
  checkScope(ctx, source, "Inventory");
  if (!input.allocationId) return remove(tx, ctx, { inventoryId: source.id, qty: input.qty, type: input.type, refs: input.refs });
  const alloc = getAllocation(tx, input.allocationId);
  if (alloc.inventoryId !== source.id || alloc.qty < input.qty) throw insufficientStock("The allocation does not hold enough stock in this bucket.");
  consumeAllocation(tx, ctx, alloc, input.qty, input.type === "Shipment");
  const bucket = applyDelta(tx, getBucket(tx, source.id), -input.qty);
  const txn = writeTxn(tx, ctx, {
    type: input.type, from: bucket, to: null, uomQty: input.qty, packQty: packQtyOf(tx, bucket, input.qty),
    refs: { orderId: alloc.orderId, orderLineId: alloc.orderLineId, jobId: alloc.jobId, workOrderId: alloc.workOrderId, ...input.refs },
  });
  refreshLpStatus(tx, bucket.lpId);
  return { bucket, txn };
}

/* -------------------------------------------------------- whole-bucket moves */
function moveWholeBucket(tx: Tx, ctx: DomainCtx, bucket: InventoryRow, toLocationId: string, type: TxnType, refs?: TxnRefs): TxnRow[] {
  const txns: TxnRow[] = [];
  const allocs = tx.select().from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.inventoryId, bucket.id), inArray(schema.inventoryAllocations.status, [...ACTIVE_ALLOCATION_STATUSES]))).all();
  for (const a of allocs) txns.push(move(tx, ctx, { inventoryId: bucket.id, qty: a.qty, toLocationId, allocationId: a.id, type, refs }).txn);
  const free = freeQty(getBucket(tx, bucket.id));
  if (free > 0) txns.push(move(tx, ctx, { inventoryId: bucket.id, qty: free, toLocationId, type, refs }).txn);
  return txns;
}

/** Moves every bucket in a location (stock on LPs included) to another location. */
export function moveLocation(tx: Tx, ctx: DomainCtx, input: { fromLocationId: string; toLocationId: string; refs?: TxnRefs }): TxnRow[] {
  if (input.fromLocationId === input.toLocationId) throw new DomainError("VALIDATION", "Source and target locations are the same.");
  const from = getLocation(tx, input.fromLocationId);
  const to = getLocation(tx, input.toLocationId);
  if (from.warehouseId !== to.warehouseId) throw ruleViolation("Locations must be in the same warehouse.");
  const buckets = tx.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, from.id), gt(schema.inventory.onHand, 0))).all();
  const lpIds = [...new Set(buckets.flatMap((b) => (b.lpId ? [b.lpId] : [])))];
  if (lpIds.length > 0) tx.update(schema.licensePlates).set({ locationId: to.id }).where(inArray(schema.licensePlates.id, lpIds)).run();
  return buckets.flatMap((b) => moveWholeBucket(tx, ctx, b, to.id, "Inventory Movement", input.refs));
}

function lpTree(tx: Tx, rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i += 1) {
    const children = tx.select({ id: schema.licensePlates.id }).from(schema.licensePlates).where(eq(schema.licensePlates.parentLpId, out[i])).all();
    for (const c of children) if (!out.includes(c.id)) out.push(c.id);
  }
  return out;
}

/** Moves an LP and all of its child LPs (with their stock) to another location. */
export function moveLp(tx: Tx, ctx: DomainCtx, input: { lpId: string; toLocationId: string; refs?: TxnRefs; type?: TxnType }): TxnRow[] {
  const lp = getLp(tx, input.lpId);
  const to = getLocation(tx, input.toLocationId);
  if (lp.warehouseId !== to.warehouseId) throw ruleViolation("The LP and location must be in the same warehouse.");
  if (lp.locationId === to.id) throw new DomainError("VALIDATION", `LP ${lp.number} is already in location ${to.code}.`);
  if (lp.locationId) assertSourceMovable(tx, lp.locationId);
  const ids = lpTree(tx, lp.id);
  tx.update(schema.licensePlates).set({ locationId: to.id, updatedBy: ctx.userId }).where(inArray(schema.licensePlates.id, ids)).run();
  const buckets = tx.select().from(schema.inventory).where(and(inArray(schema.inventory.lpId, ids), gt(schema.inventory.onHand, 0))).all();
  return buckets.flatMap((b) => moveWholeBucket(tx, ctx, b, to.id, input.type ?? "Inventory Movement", input.refs));
}
