/**
 * Inventory by Location commands (spec 04 §2.1–2.8). Every quantity / attribute change
 * goes through `ledger.*` (BUILD_PLAN 0.4 #1); this layer adds the page rules:
 * Stock-only row actions, warehouse "mandatory adjustment reason", optimistic
 * concurrency on the bucket version, pack-type → UOM conversion, rule messages that
 * name the blocking SKU, and a field-level change_log line on the location.
 *
 * Quantities in inputs are in the row's PACK TYPE (what the drawer shows as Pack Qty);
 * the ledger works in UOM units.
 */
import { and, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { conflictError } from "@/server/api/errors";
import { recordLine } from "@/server/domain/change-log";
import { DomainError, invalidState, ruleViolation } from "@/server/domain/errors";
import { ledger, type InventoryRow } from "@/server/domain/ledger";
import { getBucket, packRatio } from "@/server/domain/ledger/bucket";
import { getLocation, getLp } from "@/server/domain/ledger/rules";
import { checkScope, type DomainCtx, type BulkResult } from "@/server/domain/types";
import { runBulk } from "@/server/domain/bulk";

const id = z.string().trim().min(1).max(64);
const note = z.string().trim().max(400).optional().nullable();
const qty = z.number({ error: "Enter a quantity" }).int("Use a whole number").positive("Must be greater than 0").max(10_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const targetSchema = z.object({ kind: z.enum(["location", "lp"]), id });
export type TransferTarget = z.infer<typeof targetSchema>;

export const quantityChangeSchema = z.object({
  mode: z.enum(["add", "adjust", "remove"]),
  /** Quantity to add/remove, or the new absolute quantity for adjust (pack units). */
  qty: z.number({ error: "Enter a quantity" }).int("Use a whole number").min(0, "Can't be negative").max(10_000_000),
  reasonId: id.optional().nullable(),
  note,
  version: z.number().int().min(1).optional(),
}).refine((v) => v.mode === "adjust" || v.qty > 0, { path: ["qty"], message: "Must be greater than 0" });

export const addInventorySchema = z.object({
  warehouseId: id,
  locationId: id,
  lpId: id.optional().nullable(),
  clientId: id,
  productId: id,
  packType: z.string().trim().min(1).max(60),
  reasonId: id.optional().nullable(),
  damageReason: z.string().trim().max(120).optional().nullable(),
  qty,
  lotNumber: z.string().trim().max(60).optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
  productionDate: isoDate.optional().nullable(),
  note,
});

export const transferProductSchema = z.object({ inventoryId: id, qty, target: targetSchema, version: z.number().int().min(1).optional(), note });
export const transferLocationSchema = z.object({ fromLocationId: id, target: targetSchema, note });
export const transferLpSchema = z.object({ lpId: id, target: targetSchema, note });

export const ATTRIBUTE_KEYS = ["lotNumber", "expiryDate", "productionDate", "damageReason"] as const;
export const changeAttributesSchema = z.object({
  ids: z.array(id).min(1, "Select at least one row").max(1000),
  attribute: z.enum(ATTRIBUTE_KEYS),
  /** null / "" clears the attribute. */
  value: z.string().trim().max(120).nullable(),
  /** Pack units; only with a single row selected. Default: every free unit. */
  qty: qty.optional(),
}).superRefine((v, ctx) => {
  if ((v.attribute === "expiryDate" || v.attribute === "productionDate") && v.value && !/^\d{4}-\d{2}-\d{2}$/.test(v.value)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Use YYYY-MM-DD" });
  }
  if (v.qty !== undefined && v.ids.length !== 1) ctx.addIssue({ code: "custom", path: ["qty"], message: "A quantity can only be set for one row" });
});

export type QuantityChangeInput = z.infer<typeof quantityChangeSchema>;
export type AddInventoryInput = z.infer<typeof addInventorySchema>;
export type ChangeAttributesInput = z.infer<typeof changeAttributesSchema>;

const ATTRIBUTE_LABELS: Readonly<Record<(typeof ATTRIBUTE_KEYS)[number], string>> = {
  lotNumber: "Lot/Batch Number", expiryDate: "Expiry Date", productionDate: "Production Date", damageReason: "Damage Reason",
};

/* ------------------------------------------------------------------ helpers */

function productOf(tx: AppDb, productId: string) {
  const p = tx.select().from(schema.products).where(eq(schema.products.id, productId)).get();
  if (!p) throw new DomainError("NOT_FOUND", "Product not found");
  return p;
}

function assertReason(tx: AppDb, warehouseId: string, reasonId: string | null | undefined, required: boolean): void {
  if (!reasonId) {
    if (required) throw new DomainError("VALIDATION", "An adjustment reason is required by this warehouse's settings", { fieldErrors: { reasonId: ["Select an adjustment reason"] } });
    return;
  }
  const r = tx.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, reasonId)).get();
  if (!r || r.type !== "adjustment_reason" || !r.isActive || (r.warehouseId && r.warehouseId !== warehouseId)) {
    throw new DomainError("VALIDATION", "Select a valid adjustment reason", { fieldErrors: { reasonId: ["Select a valid adjustment reason"] } });
  }
}

function warehouseRequiresReason(tx: AppDb, warehouseId: string): boolean {
  const wh = tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get();
  return Boolean(wh?.mandatoryAdjustmentReason);
}

function assertDamageReason(tx: AppDb, value: string | null | undefined): void {
  if (!value) return;
  const r = tx.select().from(schema.lookupValues)
    .where(and(eq(schema.lookupValues.type, "damage_reason"), eq(schema.lookupValues.name, value))).get();
  if (!r) throw new DomainError("VALIDATION", `"${value}" is not a damage reason`, { fieldErrors: { damageReason: ["Select a damage reason"] } });
}

function assertStock(bucket: InventoryRow): void {
  if (bucket.status !== "Stock") {
    throw invalidState(`This row is ${bucket.status}: it belongs to an order in progress and can't be changed here.`);
  }
}

function assertVersion(bucket: InventoryRow, version: number | undefined): void {
  if (version !== undefined && bucket.version !== version) throw conflictError();
}

const toUom = (tx: AppDb, b: Pick<InventoryRow, "productId" | "packType">, packs: number): number => packs * packRatio(tx, b.productId, b.packType);

function skuOf(tx: AppDb, productId: string): string {
  return tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get()?.sku ?? "?";
}

/**
 * Names the blocking SKU for the "only one SKU" rules before the ledger runs, e.g.
 * "Location MLT1-A-01 allows only 1 SKU (holds MLT-WIDGET-02)". Other rules fall
 * through to the ledger's own messages, which already name the rule.
 */
export function explainSkuRule(tx: AppDb, input: { locationId: string; lpId: string | null; productId: string; excludeInventoryId?: string }): void {
  const loc = getLocation(tx, input.locationId);
  const i = schema.inventory;
  const other = (where: ReturnType<typeof eq>) => {
    const conds = [where, gt(i.onHand, 0), ne(i.productId, input.productId)];
    if (input.excludeInventoryId) conds.push(ne(i.id, input.excludeInventoryId));
    return tx.select({ productId: i.productId }).from(i).where(and(...conds)).get();
  };
  if (loc.onlyOneSku) {
    const o = other(eq(i.locationId, loc.id));
    if (o) throw ruleViolation(`Location ${loc.code} allows only 1 SKU (holds ${skuOf(tx, o.productId)}).`, { rule: "onlyOneSku", locationId: loc.id });
  }
  if (input.lpId) {
    const lp = getLp(tx, input.lpId);
    const type = tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, lp.lpTypeId)).get();
    if (type?.onlyOneSku) {
      const o = other(eq(i.lpId, lp.id));
      if (o) throw ruleViolation(`LP ${lp.number} (${type.code}) allows only 1 SKU (holds ${skuOf(tx, o.productId)}).`, { rule: "onlyOneSku", lpId: lp.id });
    }
  }
}

function logQty(tx: AppDb, ctx: DomainCtx, bucket: InventoryRow, from: number, to: number): void {
  const loc = getLocation(tx, bucket.locationId);
  recordLine(tx, ctx, {
    entityType: "location", entityId: loc.id, entityCode: loc.code, lineEntityType: "inventory", lineEntityId: bucket.id,
    lineLabel: skuOf(tx, bucket.productId), field: "quantity", from, to,
  });
}

interface ResolvedTarget {
  readonly locationId: string;
  readonly lpId: string | null | undefined;
  readonly label: string;
}

/** Location target → stock leaves its LP only when moved to a different location. */
function resolveTarget(tx: AppDb, ctx: DomainCtx, warehouseId: string, target: TransferTarget, fallbackLocationId: string): ResolvedTarget {
  if (target.kind === "location") {
    const loc = getLocation(tx, target.id);
    if (loc.warehouseId !== warehouseId) throw ruleViolation(`Location ${loc.code} belongs to another warehouse.`);
    checkScope(ctx, loc, "Location");
    return { locationId: loc.id, lpId: null, label: loc.code };
  }
  const lp = getLp(tx, target.id);
  if (lp.warehouseId !== warehouseId) throw ruleViolation(`LP ${lp.number} belongs to another warehouse.`);
  checkScope(ctx, { warehouseId: lp.warehouseId }, "LP");
  return { locationId: lp.locationId ?? fallbackLocationId, lpId: lp.id, label: `LP ${lp.number}` };
}

/* ----------------------------------------------------------- row actions */

export interface QuantityChangeResult {
  readonly inventoryId: string;
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}

export function changeQuantity(tx: AppDb, ctx: DomainCtx, inventoryId: string, input: QuantityChangeInput): QuantityChangeResult {
  const bucket = getBucket(tx, inventoryId);
  checkScope(ctx, bucket, "Inventory");
  assertStock(bucket);
  assertVersion(bucket, input.version);
  assertReason(tx, bucket.warehouseId, input.reasonId, warehouseRequiresReason(tx, bucket.warehouseId));
  if (!bucket.clientId) throw invalidState("This row has no client.");
  const refs = { adjustmentReasonId: input.reasonId ?? null, note: input.note ?? null };
  const units = toUom(tx, bucket, input.qty);
  let after: InventoryRow;
  if (input.mode === "add") {
    explainSkuRule(tx, { locationId: bucket.locationId, lpId: bucket.lpId, productId: bucket.productId, excludeInventoryId: bucket.id });
    after = ledger.add(tx, ctx, {
      warehouseId: bucket.warehouseId, clientId: bucket.clientId, productId: bucket.productId, locationId: bucket.locationId,
      lpId: bucket.lpId, lotNumber: bucket.lotNumber, expiryDate: bucket.expiryDate, productionDate: bucket.productionDate,
      damageReason: bucket.damageReason, packType: bucket.packType, status: "Stock", qty: units, refs,
    }).bucket;
  } else if (input.mode === "remove") {
    after = ledger.remove(tx, ctx, { inventoryId: bucket.id, qty: units, refs }).bucket;
  } else {
    if (units === bucket.onHand) throw new DomainError("VALIDATION", "The new quantity equals the current quantity", { fieldErrors: { qty: ["Enter a different quantity"] } });
    after = ledger.adjustTo(tx, ctx, { inventoryId: bucket.id, targetQty: units, adjustmentReasonId: input.reasonId ?? null, refs }).bucket;
  }
  logQty(tx, ctx, after, bucket.onHand, after.onHand);
  return { inventoryId: after.id, from: bucket.onHand, to: after.onHand, delta: after.onHand - bucket.onHand };
}

export function addInventory(tx: AppDb, ctx: DomainCtx, input: AddInventoryInput): QuantityChangeResult {
  const product = productOf(tx, input.productId);
  if (product.clientId !== input.clientId) throw new DomainError("VALIDATION", `Product ${product.sku} belongs to another client.`, { fieldErrors: { productId: ["Pick a product of the selected client"] } });
  checkScope(ctx, { warehouseId: input.warehouseId, clientId: input.clientId }, "Inventory");
  const location = getLocation(tx, input.locationId);
  if (location.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "The location belongs to another warehouse", { fieldErrors: { locationId: ["Pick a location in this warehouse"] } });
  if (input.lpId) {
    const lp = getLp(tx, input.lpId);
    if (lp.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "The LP belongs to another warehouse", { fieldErrors: { lpId: ["Pick an LP in this warehouse"] } });
  }
  assertReason(tx, input.warehouseId, input.reasonId, warehouseRequiresReason(tx, input.warehouseId));
  assertDamageReason(tx, input.damageReason);
  const missing: Record<string, string[]> = {};
  if (product.trackLot && !input.lotNumber) missing.lotNumber = ["This product tracks lot/batch numbers"];
  if (product.trackExpiry && !input.expiryDate) missing.expiryDate = ["This product tracks expiry dates"];
  if (product.trackProductionDate && !input.productionDate) missing.productionDate = ["This product tracks production dates"];
  if (Object.keys(missing).length > 0) throw new DomainError("VALIDATION", "Fill in the tracked attributes", { fieldErrors: missing });
  const ratio = packRatio(tx, product.id, input.packType);
  explainSkuRule(tx, { locationId: location.id, lpId: input.lpId ?? null, productId: product.id });
  const { bucket } = ledger.add(tx, ctx, {
    warehouseId: input.warehouseId, clientId: input.clientId, productId: product.id, locationId: location.id,
    lpId: input.lpId ?? null, lotNumber: input.lotNumber || null, expiryDate: input.expiryDate || null,
    productionDate: input.productionDate || null, damageReason: input.damageReason || null, packType: input.packType,
    qty: input.qty * ratio, refs: { adjustmentReasonId: input.reasonId ?? null, note: input.note ?? null },
  });
  const from = bucket.onHand - input.qty * ratio;
  logQty(tx, ctx, bucket, from, bucket.onHand);
  return { inventoryId: bucket.id, from, to: bucket.onHand, delta: input.qty * ratio };
}

/* -------------------------------------------------------------- transfers */

export interface MovedLine {
  readonly sku: string;
  readonly qty: number;
  readonly from: string;
  readonly to: string;
}

export interface TransferResult {
  readonly moved: readonly MovedLine[];
  readonly totalQty: number;
}

function summarize(tx: AppDb, txns: readonly { productId: string; uomQty: number; fromLocationId: string | null; toLocationId: string | null }[]): TransferResult {
  const code = (locId: string | null) => (locId ? getLocation(tx, locId).code : "—");
  const map = new Map<string, MovedLine>();
  for (const t of txns) {
    const key = `${t.productId}:${t.fromLocationId}:${t.toLocationId}`;
    const prev = map.get(key);
    map.set(key, { sku: skuOf(tx, t.productId), qty: (prev?.qty ?? 0) + t.uomQty, from: code(t.fromLocationId), to: code(t.toLocationId) });
  }
  const moved = [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  return { moved, totalQty: moved.reduce((s, m) => s + m.qty, 0) };
}

export function transferProduct(tx: AppDb, ctx: DomainCtx, input: z.infer<typeof transferProductSchema>): TransferResult {
  const bucket = getBucket(tx, input.inventoryId);
  checkScope(ctx, bucket, "Inventory");
  assertStock(bucket);
  assertVersion(bucket, input.version);
  const target = resolveTarget(tx, ctx, bucket.warehouseId, input.target, bucket.locationId);
  if (target.locationId === bucket.locationId && (target.lpId ?? null) === bucket.lpId) {
    throw new DomainError("VALIDATION", `The stock is already in ${target.label}.`, { fieldErrors: { target: ["Pick a different location or LP"] } });
  }
  explainSkuRule(tx, { locationId: target.locationId, lpId: target.lpId ?? null, productId: bucket.productId, excludeInventoryId: bucket.id });
  const { txn, target: to } = ledger.move(tx, ctx, {
    inventoryId: bucket.id, qty: toUom(tx, bucket, input.qty), toLocationId: target.locationId, toLpId: target.lpId,
    refs: { note: input.note ?? null },
  });
  logQty(tx, ctx, bucket, bucket.onHand, getBucket(tx, bucket.id).onHand);
  logQty(tx, ctx, to, to.onHand - txn.uomQty, to.onHand);
  return summarize(tx, [txn]);
}

const ACTIVE = ["Allocated", "Picked", "Sorted", "Packed", "Loaded"] as const;

/** Moves one bucket (allocations travel with their stock) onto an LP / location. */
function moveBucketTo(tx: AppDb, ctx: DomainCtx, bucket: InventoryRow, locationId: string, lpId: string | null | undefined, note: string | null) {
  const txns = [];
  const allocs = tx.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.inventoryId, bucket.id)).all()
    .filter((a) => (ACTIVE as readonly string[]).includes(a.status));
  for (const a of allocs) txns.push(ledger.move(tx, ctx, { inventoryId: bucket.id, qty: a.qty, toLocationId: locationId, toLpId: lpId, allocationId: a.id, refs: { note } }).txn);
  const free = getBucket(tx, bucket.id);
  const freeUnits = free.onHand - free.allocated;
  if (freeUnits > 0) txns.push(ledger.move(tx, ctx, { inventoryId: bucket.id, qty: freeUnits, toLocationId: locationId, toLpId: lpId, refs: { note } }).txn);
  return txns;
}

function bucketsWhere(tx: AppDb, where: ReturnType<typeof eq>): InventoryRow[] {
  return tx.select().from(schema.inventory).where(and(where, gt(schema.inventory.onHand, 0))).all();
}

export function transferLocation(tx: AppDb, ctx: DomainCtx, input: z.infer<typeof transferLocationSchema>): TransferResult {
  const from = getLocation(tx, input.fromLocationId);
  checkScope(ctx, from, "Location");
  const buckets = bucketsWhere(tx, eq(schema.inventory.locationId, from.id));
  if (buckets.length === 0) throw invalidState(`Location ${from.code} is empty.`);
  for (const b of buckets) checkScope(ctx, b, "Inventory");
  const target = resolveTarget(tx, ctx, from.warehouseId, input.target, from.id);
  if (input.target.kind === "location") {
    if (target.locationId === from.id) throw new DomainError("VALIDATION", "Source and target locations are the same.", { fieldErrors: { target: ["Pick a different location"] } });
    for (const pid of new Set(buckets.map((b) => b.productId))) explainSkuRule(tx, { locationId: target.locationId, lpId: null, productId: pid });
    return summarize(tx, ledger.moveLocation(tx, ctx, { fromLocationId: from.id, toLocationId: target.locationId, refs: { note: input.note ?? null } }));
  }
  for (const pid of new Set(buckets.map((b) => b.productId))) explainSkuRule(tx, { locationId: target.locationId, lpId: target.lpId ?? null, productId: pid });
  return summarize(tx, buckets.flatMap((b) => moveBucketTo(tx, ctx, b, target.locationId, target.lpId, input.note ?? null)));
}

export function transferLp(tx: AppDb, ctx: DomainCtx, input: z.infer<typeof transferLpSchema>): TransferResult {
  const lp = getLp(tx, input.lpId);
  checkScope(ctx, { warehouseId: lp.warehouseId }, "LP");
  const buckets = bucketsWhere(tx, eq(schema.inventory.lpId, lp.id));
  for (const b of buckets) checkScope(ctx, b, "Inventory");
  if (input.target.kind === "location") {
    const target = resolveTarget(tx, ctx, lp.warehouseId, input.target, lp.locationId ?? input.target.id);
    for (const pid of new Set(buckets.map((b) => b.productId))) explainSkuRule(tx, { locationId: target.locationId, lpId: null, productId: pid });
    return summarize(tx, ledger.moveLp(tx, ctx, { lpId: lp.id, toLocationId: target.locationId, refs: { note: input.note ?? null } }));
  }
  if (input.target.id === lp.id) throw new DomainError("VALIDATION", "Source and target LP are the same.", { fieldErrors: { target: ["Pick a different LP"] } });
  if (buckets.length === 0) throw invalidState(`LP ${lp.number} is empty.`);
  const target = resolveTarget(tx, ctx, lp.warehouseId, input.target, lp.locationId ?? buckets[0].locationId);
  for (const pid of new Set(buckets.map((b) => b.productId))) explainSkuRule(tx, { locationId: target.locationId, lpId: target.lpId ?? null, productId: pid });
  return summarize(tx, buckets.flatMap((b) => moveBucketTo(tx, ctx, b, target.locationId, target.lpId, input.note ?? null)));
}

/* -------------------------------------------------------- change attributes */

export function changeAttributes(tx: AppDb, ctx: DomainCtx, input: ChangeAttributesInput): BulkResult {
  const value = input.value ? input.value : null;
  if (input.attribute === "damageReason") assertDamageReason(tx, value);
  return runBulk(tx, input.ids, (inner, bucketId) => {
    const bucket = getBucket(inner, bucketId);
    checkScope(ctx, bucket, "Inventory");
    assertStock(bucket);
    const current = bucket[input.attribute];
    if ((current ?? null) === value) throw new DomainError("VALIDATION", `${ATTRIBUTE_LABELS[input.attribute]} is already ${value ?? "empty"}.`);
    const free = bucket.onHand - bucket.allocated;
    const units = input.qty !== undefined ? toUom(inner, bucket, input.qty) : free;
    if (units <= 0) throw new DomainError("INSUFFICIENT_STOCK", "Every unit in this row is allocated; release the allocation first.");
    if (units > free) throw new DomainError("INSUFFICIENT_STOCK", `Only ${free} unallocated units can change; ${units} requested.`);
    const { target } = ledger.changeAttributes(inner, ctx, { inventoryId: bucket.id, qty: units, [input.attribute]: value });
    const loc = getLocation(inner, bucket.locationId);
    recordLine(inner, ctx, {
      entityType: "location", entityId: loc.id, entityCode: loc.code, lineEntityType: "inventory", lineEntityId: target.id,
      lineLabel: `${skuOf(inner, bucket.productId)} (${units} units)`, field: input.attribute, from: current ?? "", to: value ?? "",
    });
  });
}
