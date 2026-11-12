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
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/server/db/schema';
import type { AppDb } from '@/server/api/db';
import { conflictError } from '@/server/api/errors';
import { recordLine } from '@/server/domain/change-log';
import { DomainError, invalidState, ruleViolation } from '@/server/domain/errors';
import { ledger, type InventoryRow } from '@/server/domain/ledger';
import { getBucket, packRatio } from '@/server/domain/ledger/bucket';
import { getLocation, getLp } from '@/server/domain/ledger/rules';
import { assertNotCountLocked } from '@/server/domain/ledger/count-locks';
import { checkScope, type DomainCtx, type BulkResult } from '@/server/domain/types';
import { runBulk } from '@/server/domain/bulk';
import { LOT_MESSAGE, isValidLot } from '@/lib/grid-defs/inventory/lot-rules';
import {
  reasonAllows,
  reasonDirection,
  reasonDirectionMessage,
} from '@/lib/grid-defs/inventory/reason-direction';
import { dbGet, flatMapSeq } from '@/server/db/sql';

export { LOT_MESSAGE, LOT_PATTERN, isValidLot } from '@/lib/grid-defs/inventory/lot-rules';

const id = z.string().trim().min(1).max(64);
const note = z.string().trim().max(400).optional().nullable();
const qty = z
  .number({ error: 'Enter a quantity' })
  .int('Use a whole number')
  .positive('Must be greater than 0')
  .max(10_000_000);
/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-13-45, 2026-02-31). */
export function isValidIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
const isoDate = z.string().refine(isValidIsoDate, 'Enter a real date (YYYY-MM-DD)');

const lot = z
  .string()
  .trim()
  .max(60, 'At most 60 characters')
  .refine((v) => v === '' || isValidLot(v), LOT_MESSAGE);

export const targetSchema = z.object({ kind: z.enum(['location', 'lp']), id });
export type TransferTarget = z.infer<typeof targetSchema>;

export const quantityChangeSchema = z
  .object({
    mode: z.enum(['add', 'adjust', 'remove']),
    /** Quantity to add/remove, or the new absolute quantity for adjust (pack units). */
    qty: z
      .number({ error: 'Enter a quantity' })
      .int('Use a whole number')
      .min(0, "Can't be negative")
      .max(10_000_000),
    reasonId: id.optional().nullable(),
    note,
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => v.mode === 'adjust' || v.qty > 0, { path: ['qty'], message: 'Must be greater than 0' });

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
  lotNumber: lot.optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
  productionDate: isoDate.optional().nullable(),
  note,
});

export const transferProductSchema = z.object({
  inventoryId: id,
  qty,
  target: targetSchema,
  version: z.number().int().min(1).optional(),
  note,
});
export const transferLocationSchema = z.object({ fromLocationId: id, target: targetSchema, note });
export const transferLpSchema = z.object({ lpId: id, target: targetSchema, note });

export const ATTRIBUTE_KEYS = ['lotNumber', 'expiryDate', 'productionDate', 'damageReason'] as const;
export const changeAttributesSchema = z
  .object({
    ids: z.array(id).min(1, 'Select at least one row').max(1000),
    attribute: z.enum(ATTRIBUTE_KEYS),
    /** null / "" clears the attribute. */
    value: z.string().trim().max(120).nullable(),
    /** Pack units; only with a single row selected. Default: every free unit. */
    qty: qty.optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.attribute === 'expiryDate' || v.attribute === 'productionDate') &&
      v.value &&
      !isValidIsoDate(v.value)
    ) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a real date (YYYY-MM-DD)' });
    }
    if (v.attribute === 'lotNumber' && v.value && !isValidLot(v.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: LOT_MESSAGE });
    }
    if (v.qty !== undefined && v.ids.length !== 1)
      ctx.addIssue({ code: 'custom', path: ['qty'], message: 'A quantity can only be set for one row' });
  });

export type QuantityChangeInput = z.infer<typeof quantityChangeSchema>;
export type AddInventoryInput = z.infer<typeof addInventorySchema>;
export type ChangeAttributesInput = z.infer<typeof changeAttributesSchema>;

const ATTRIBUTE_LABELS: Readonly<Record<(typeof ATTRIBUTE_KEYS)[number], string>> = {
  lotNumber: 'Lot/Batch Number',
  expiryDate: 'Expiry Date',
  productionDate: 'Production Date',
  damageReason: 'Damage Reason',
};

/* ------------------------------------------------------------------ helpers */

async function productOf(tx: AppDb, productId: string) {
  const p = (await tx.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1))[0];
  if (!p) throw new DomainError('NOT_FOUND', 'Product not found');
  return p;
}

/** `delta` (UOM units, signed) checks the reason's direction (increase / decrease / both). */
async function assertReason(
  tx: AppDb,
  warehouseId: string,
  reasonId: string | null | undefined,
  required: boolean,
  delta?: number,
): Promise<void> {
  if (!reasonId) {
    if (required)
      throw new DomainError('VALIDATION', "An adjustment reason is required by this warehouse's settings", {
        fieldErrors: { reasonId: ['Select an adjustment reason'] },
      });
    return;
  }
  const r = (
    await tx.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, reasonId)).limit(1)
  )[0];
  if (
    !r ||
    r.type !== 'adjustment_reason' ||
    !r.isActive ||
    (r.warehouseId && r.warehouseId !== warehouseId)
  ) {
    throw new DomainError('VALIDATION', 'Select a valid adjustment reason', {
      fieldErrors: { reasonId: ['Select a valid adjustment reason'] },
    });
  }
  const direction = reasonDirection(r.name, r.meta);
  if (delta !== undefined && !reasonAllows(direction, delta)) {
    const message = reasonDirectionMessage(r.name, direction);
    throw new DomainError('VALIDATION', message, { fieldErrors: { reasonId: [message] } });
  }
}

async function warehouseRequiresReason(tx: AppDb, warehouseId: string): Promise<boolean> {
  const wh = (
    await tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).limit(1)
  )[0];
  return Boolean(wh?.mandatoryAdjustmentReason);
}

async function assertDamageReason(tx: AppDb, value: string | null | undefined): Promise<void> {
  if (!value) return;
  const r = (
    await tx
      .select()
      .from(schema.lookupValues)
      .where(and(eq(schema.lookupValues.type, 'damage_reason'), eq(schema.lookupValues.name, value)))
      .limit(1)
  )[0];
  if (!r)
    throw new DomainError('VALIDATION', `"${value}" is not a damage reason`, {
      fieldErrors: { damageReason: ['Select a damage reason'] },
    });
}

function assertStock(bucket: InventoryRow): void {
  if (bucket.status !== 'Stock') {
    throw invalidState(
      `This row is ${bucket.status}: it belongs to an order in progress and can't be changed here.`,
    );
  }
}

function assertVersion(bucket: InventoryRow, version: number | undefined): void {
  if (version !== undefined && bucket.version !== version) throw conflictError();
}

const toUom = async (
  tx: AppDb,
  b: Pick<InventoryRow, 'productId' | 'packType'>,
  packs: number,
): Promise<number> => packs * (await packRatio(tx, b.productId, b.packType));

async function skuOf(tx: AppDb, productId: string): Promise<string> {
  return (
    (
      await tx
        .select({ sku: schema.products.sku })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1)
    )[0]?.sku ?? '?'
  );
}

/**
 * Names the blocking SKU for the "only one SKU" rules before the ledger runs, e.g.
 * "Location MLT1-A-01 allows only 1 SKU (holds MLT-WIDGET-02)". Other rules fall
 * through to the ledger's own messages, which already name the rule.
 */
export async function explainSkuRule(
  tx: AppDb,
  input: { locationId: string; lpId: string | null; productId: string; excludeInventoryId?: string },
): Promise<void> {
  const loc = await getLocation(tx, input.locationId);
  const i = schema.inventory;
  const other = async (where: ReturnType<typeof eq>) => {
    const conds = [where, gt(i.onHand, 0), ne(i.productId, input.productId)];
    if (input.excludeInventoryId) conds.push(ne(i.id, input.excludeInventoryId));
    return (
      await tx
        .select({ productId: i.productId })
        .from(i)
        .where(and(...conds))
        .limit(1)
    )[0];
  };
  if (loc.onlyOneSku) {
    const o = await other(eq(i.locationId, loc.id));
    if (o)
      throw ruleViolation(`Location ${loc.code} allows only 1 SKU (holds ${await skuOf(tx, o.productId)}).`, {
        rule: 'onlyOneSku',
        locationId: loc.id,
      });
  }
  if (input.lpId) {
    const lp = await getLp(tx, input.lpId);
    const type = (
      await tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, lp.lpTypeId)).limit(1)
    )[0];
    if (type?.onlyOneSku) {
      const o = await other(eq(i.lpId, lp.id));
      if (o)
        throw ruleViolation(
          `LP ${lp.number} (${type.code}) allows only 1 SKU (holds ${await skuOf(tx, o.productId)}).`,
          { rule: 'onlyOneSku', lpId: lp.id },
        );
    }
  }
}

/** "MLT-WIDGET-01 (1 unit)" / "MLT-WIDGET-01 (12 units)": the line label of an attribute change-log row. */
export function attributeChangeLineLabel(sku: string, units: number): string {
  return `${sku} (${units.toLocaleString('en-US')} ${units === 1 ? 'unit' : 'units'})`;
}

/**
 * An empty attribute is logged as "(none)", so the stored sentence reads
 * "Damage Reason is modified. (none) --> Damaged" instead of "is modified.  --> Damaged".
 */
export function changeLogValue(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? v : '(none)';
}

async function logQty(
  tx: AppDb,
  ctx: DomainCtx,
  bucket: InventoryRow,
  from: number,
  to: number,
): Promise<void> {
  const loc = await getLocation(tx, bucket.locationId);
  await recordLine(tx, ctx, {
    entityType: 'location',
    entityId: loc.id,
    entityCode: loc.code,
    lineEntityType: 'inventory',
    lineEntityId: bucket.id,
    lineLabel: await skuOf(tx, bucket.productId),
    field: 'quantity',
    from,
    to,
  });
}

/**
 * Deletes buckets this page emptied (on hand 0), as Logiwa does ("Setting the quantity to 0
 * will delete this inventory record"), so ghost "Stock 0" rows don't pile up. Ledger rows keep
 * their from/to ids, so history is untouched and reconcile still holds (Σ = 0). A bucket stays
 * when anything still points at it: allocation rows (FK), serial numbers, or the posted txn of a
 * live receipt (Cancel Receiving reads that bucket). Returns the ids that were deleted.
 */
export async function pruneEmptyBuckets(tx: AppDb, ids: readonly string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const bucketId of new Set(ids)) {
    const b = (await tx.select().from(schema.inventory).where(eq(schema.inventory.id, bucketId)).limit(1))[0];
    if (!b || b.onHand !== 0 || b.allocated !== 0 || b.bucketKey.startsWith('legacy:')) continue;
    const held = await dbGet<{ n: number }>(
      tx,
      sql`SELECT
        (SELECT COUNT(*) FROM inventory_allocations a WHERE a.inventory_id = ${bucketId})
      + (SELECT COUNT(*) FROM serial_numbers s WHERE s.inventory_id = ${bucketId})
      + (SELECT COUNT(*) FROM receipts r JOIN inventory_transactions t ON t.id = r.inventory_transaction_id
          WHERE r.cancelled_at IS NULL AND t.to_inventory_id = ${bucketId}) AS n`,
    );
    if ((held?.n ?? 0) > 0) continue;
    await tx.delete(schema.inventory).where(eq(schema.inventory.id, bucketId));
    deleted.push(bucketId);
  }
  return deleted;
}

const TRACKED_ATTRIBUTE: Partial<
  Record<
    (typeof ATTRIBUTE_KEYS)[number],
    { flag: 'trackLot' | 'trackExpiry' | 'trackProductionDate'; noun: string }
  >
> = {
  lotNumber: { flag: 'trackLot', noun: 'lot/batch numbers' },
  expiryDate: { flag: 'trackExpiry', noun: 'expiry dates' },
  productionDate: { flag: 'trackProductionDate', noun: 'production dates' },
};

/** Lot / expiry / production can only be SET on a product that tracks them (clearing is always allowed). */
export function untrackedAttributeMessage(
  product: { sku: string; trackLot: boolean; trackExpiry: boolean; trackProductionDate: boolean },
  attribute: (typeof ATTRIBUTE_KEYS)[number],
): string | null {
  const t = TRACKED_ATTRIBUTE[attribute];
  if (!t || product[t.flag]) return null;
  return `${product.sku} doesn't track ${t.noun}. Turn tracking on in the product first.`;
}

interface ResolvedTarget {
  readonly locationId: string;
  readonly lpId: string | null | undefined;
  readonly label: string;
}

/** Location target → stock leaves its LP only when moved to a different location. */
async function resolveTarget(
  tx: AppDb,
  ctx: DomainCtx,
  warehouseId: string,
  target: TransferTarget,
  fallbackLocationId: string,
): Promise<ResolvedTarget> {
  if (target.kind === 'location') {
    const loc = await getLocation(tx, target.id);
    if (loc.warehouseId !== warehouseId)
      throw ruleViolation(`Location ${loc.code} belongs to another warehouse.`);
    checkScope(ctx, loc, 'Location');
    return { locationId: loc.id, lpId: null, label: loc.code };
  }
  const lp = await getLp(tx, target.id);
  if (lp.warehouseId !== warehouseId) throw ruleViolation(`LP ${lp.number} belongs to another warehouse.`);
  checkScope(ctx, { warehouseId: lp.warehouseId }, 'LP');
  return { locationId: lp.locationId ?? fallbackLocationId, lpId: lp.id, label: `LP ${lp.number}` };
}

/* ----------------------------------------------------------- row actions */

export interface QuantityChangeResult {
  readonly inventoryId: string;
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}

export async function changeQuantity(
  tx: AppDb,
  ctx: DomainCtx,
  inventoryId: string,
  input: QuantityChangeInput,
): Promise<QuantityChangeResult> {
  const bucket = await getBucket(tx, inventoryId);
  checkScope(ctx, bucket, 'Inventory');
  assertStock(bucket);
  assertVersion(bucket, input.version);
  // Quantity changes mid-count would corrupt the variance: same lock as transfers.
  await assertNotCountLocked(tx, await getLocation(tx, bucket.locationId));
  if (!bucket.clientId) throw invalidState('This row has no client.');
  const refs = { adjustmentReasonId: input.reasonId ?? null, note: input.note ?? null };
  const units = await toUom(tx, bucket, input.qty);
  const delta = input.mode === 'add' ? units : input.mode === 'remove' ? -units : units - bucket.onHand;
  await assertReason(
    tx,
    bucket.warehouseId,
    input.reasonId,
    await warehouseRequiresReason(tx, bucket.warehouseId),
    delta,
  );
  let after: InventoryRow;
  if (input.mode === 'add') {
    await explainSkuRule(tx, {
      locationId: bucket.locationId,
      lpId: bucket.lpId,
      productId: bucket.productId,
      excludeInventoryId: bucket.id,
    });
    after = (
      await ledger.add(tx, ctx, {
        warehouseId: bucket.warehouseId,
        clientId: bucket.clientId,
        productId: bucket.productId,
        locationId: bucket.locationId,
        lpId: bucket.lpId,
        lotNumber: bucket.lotNumber,
        expiryDate: bucket.expiryDate,
        productionDate: bucket.productionDate,
        damageReason: bucket.damageReason,
        packType: bucket.packType,
        status: 'Stock',
        qty: units,
        refs,
      })
    ).bucket;
  } else if (input.mode === 'remove') {
    const free = bucket.onHand - bucket.allocated;
    if (units > free) {
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        `Only ${free} unallocated units can be removed; ${units} requested.`,
        { fieldErrors: { qty: [`Only ${free} unallocated units can be removed`] } },
      );
    }
    // Remove posts the same signed delta as Adjust down (−qty, "Inventory Adjustment"), so sums per
    // type / reason and shrink reports add up (Logiwa shows removals as negative).
    after = (
      await ledger.adjustTo(tx, ctx, {
        inventoryId: bucket.id,
        targetQty: bucket.onHand - units,
        adjustmentReasonId: input.reasonId ?? null,
        refs,
      })
    ).bucket;
  } else {
    if (units === bucket.onHand)
      throw new DomainError('VALIDATION', 'The new quantity equals the current quantity', {
        fieldErrors: { qty: ['Enter a different quantity'] },
      });
    after = (
      await ledger.adjustTo(tx, ctx, {
        inventoryId: bucket.id,
        targetQty: units,
        adjustmentReasonId: input.reasonId ?? null,
        refs,
      })
    ).bucket;
  }
  await logQty(tx, ctx, after, bucket.onHand, after.onHand);
  if (after.onHand === 0) await pruneEmptyBuckets(tx, [after.id]);
  return {
    inventoryId: after.id,
    from: bucket.onHand,
    to: after.onHand,
    delta: after.onHand - bucket.onHand,
  };
}

export async function addInventory(
  tx: AppDb,
  ctx: DomainCtx,
  input: AddInventoryInput,
): Promise<QuantityChangeResult> {
  const product = await productOf(tx, input.productId);
  if (product.clientId !== input.clientId)
    throw new DomainError('VALIDATION', `Product ${product.sku} belongs to another client.`, {
      fieldErrors: { productId: ['Pick a product of the selected client'] },
    });
  checkScope(ctx, { warehouseId: input.warehouseId, clientId: input.clientId }, 'Inventory');
  const location = await getLocation(tx, input.locationId);
  if (location.warehouseId !== input.warehouseId)
    throw new DomainError('VALIDATION', 'The location belongs to another warehouse', {
      fieldErrors: { locationId: ['Pick a location in this warehouse'] },
    });
  await assertNotCountLocked(tx, location);
  if (input.lpId) {
    const lp = await getLp(tx, input.lpId);
    if (lp.warehouseId !== input.warehouseId)
      throw new DomainError('VALIDATION', 'The LP belongs to another warehouse', {
        fieldErrors: { lpId: ['Pick an LP in this warehouse'] },
      });
  }
  await assertReason(
    tx,
    input.warehouseId,
    input.reasonId,
    await warehouseRequiresReason(tx, input.warehouseId),
    input.qty,
  );
  await assertDamageReason(tx, input.damageReason);
  const missing: Record<string, string[]> = {};
  if (product.trackLot && !input.lotNumber) missing.lotNumber = ['This product tracks lot/batch numbers'];
  if (product.trackExpiry && !input.expiryDate) missing.expiryDate = ['This product tracks expiry dates'];
  if (product.trackProductionDate && !input.productionDate)
    missing.productionDate = ['This product tracks production dates'];
  if (Object.keys(missing).length > 0)
    throw new DomainError('VALIDATION', 'Fill in the tracked attributes', { fieldErrors: missing });
  // Untracked attributes are never written (db invariant: no lot / expiry / production on untracked products).
  const untracked: Record<string, string[]> = {};
  for (const key of ['lotNumber', 'expiryDate', 'productionDate'] as const) {
    const msg = input[key] ? untrackedAttributeMessage(product, key) : null;
    if (msg) untracked[key] = [msg];
  }
  if (Object.keys(untracked).length > 0)
    throw new DomainError('VALIDATION', "This product doesn't track some of the attributes entered", {
      fieldErrors: untracked,
    });
  const ratio = await packRatio(tx, product.id, input.packType);
  await explainSkuRule(tx, { locationId: location.id, lpId: input.lpId ?? null, productId: product.id });
  const { bucket } = await ledger.add(tx, ctx, {
    warehouseId: input.warehouseId,
    clientId: input.clientId,
    productId: product.id,
    locationId: location.id,
    lpId: input.lpId ?? null,
    lotNumber: input.lotNumber || null,
    expiryDate: input.expiryDate || null,
    productionDate: input.productionDate || null,
    damageReason: input.damageReason || null,
    packType: input.packType,
    qty: input.qty * ratio,
    refs: { adjustmentReasonId: input.reasonId ?? null, note: input.note ?? null },
  });
  const from = bucket.onHand - input.qty * ratio;
  await logQty(tx, ctx, bucket, from, bucket.onHand);
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

async function summarize(
  tx: AppDb,
  txns: readonly {
    productId: string;
    uomQty: number;
    fromLocationId: string | null;
    toLocationId: string | null;
  }[],
): Promise<TransferResult> {
  const code = async (locId: string | null) => (locId ? (await getLocation(tx, locId)).code : '—');
  const map = new Map<string, MovedLine>();
  for (const t of txns) {
    const key = `${t.productId}:${t.fromLocationId}:${t.toLocationId}`;
    const prev = map.get(key);
    map.set(key, {
      sku: await skuOf(tx, t.productId),
      qty: (prev?.qty ?? 0) + t.uomQty,
      from: await code(t.fromLocationId),
      to: await code(t.toLocationId),
    });
  }
  const moved = [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  return { moved, totalQty: moved.reduce((s, m) => s + m.qty, 0) };
}

export async function transferProduct(
  tx: AppDb,
  ctx: DomainCtx,
  input: z.infer<typeof transferProductSchema>,
): Promise<TransferResult> {
  const bucket = await getBucket(tx, input.inventoryId);
  checkScope(ctx, bucket, 'Inventory');
  assertStock(bucket);
  assertVersion(bucket, input.version);
  const target = await resolveTarget(tx, ctx, bucket.warehouseId, input.target, bucket.locationId);
  if (target.locationId === bucket.locationId && (target.lpId ?? null) === bucket.lpId) {
    throw new DomainError('VALIDATION', `The stock is already in ${target.label}.`, {
      fieldErrors: { target: ['Pick a different location or LP'] },
    });
  }
  await explainSkuRule(tx, {
    locationId: target.locationId,
    lpId: target.lpId ?? null,
    productId: bucket.productId,
    excludeInventoryId: bucket.id,
  });
  const moveUnits = await toUom(tx, bucket, input.qty);
  if (moveUnits > bucket.onHand) {
    throw new DomainError(
      'INSUFFICIENT_STOCK',
      'The entered transfer quantity exceeds the existing inventory amount.',
      { fieldErrors: { qty: ['The entered transfer quantity exceeds the existing inventory amount.'] } },
    );
  }
  const { txn, target: to } = await ledger.move(tx, ctx, {
    inventoryId: bucket.id,
    qty: moveUnits,
    toLocationId: target.locationId,
    toLpId: target.lpId,
    refs: { note: input.note ?? null },
  });
  await logQty(tx, ctx, bucket, bucket.onHand, (await getBucket(tx, bucket.id)).onHand);
  await logQty(tx, ctx, to, to.onHand - txn.uomQty, to.onHand);
  await pruneEmptyBuckets(tx, [bucket.id]);
  return await summarize(tx, [txn]);
}

const ACTIVE = ['Allocated', 'Picked', 'Sorted', 'Packed', 'Loaded'] as const;

/** Moves one bucket (allocations travel with their stock) onto an LP / location. */
async function moveBucketTo(
  tx: AppDb,
  ctx: DomainCtx,
  bucket: InventoryRow,
  locationId: string,
  lpId: string | null | undefined,
  note: string | null,
) {
  const txns = [];
  const allocs = (
    await tx
      .select()
      .from(schema.inventoryAllocations)
      .where(eq(schema.inventoryAllocations.inventoryId, bucket.id))
  ).filter((a) => (ACTIVE as readonly string[]).includes(a.status));
  for (const a of allocs)
    txns.push(
      (
        await ledger.move(tx, ctx, {
          inventoryId: bucket.id,
          qty: a.qty,
          toLocationId: locationId,
          toLpId: lpId,
          allocationId: a.id,
          refs: { note },
        })
      ).txn,
    );
  const free = await getBucket(tx, bucket.id);
  const freeUnits = free.onHand - free.allocated;
  if (freeUnits > 0)
    txns.push(
      (
        await ledger.move(tx, ctx, {
          inventoryId: bucket.id,
          qty: freeUnits,
          toLocationId: locationId,
          toLpId: lpId,
          refs: { note },
        })
      ).txn,
    );
  return txns;
}

async function bucketsWhere(tx: AppDb, where: ReturnType<typeof eq>): Promise<InventoryRow[]> {
  return await tx
    .select()
    .from(schema.inventory)
    .where(and(where, gt(schema.inventory.onHand, 0)));
}

export async function transferLocation(
  tx: AppDb,
  ctx: DomainCtx,
  input: z.infer<typeof transferLocationSchema>,
): Promise<TransferResult> {
  const from = await getLocation(tx, input.fromLocationId);
  checkScope(ctx, from, 'Location');
  const buckets = await bucketsWhere(tx, eq(schema.inventory.locationId, from.id));
  if (buckets.length === 0) throw invalidState(`Location ${from.code} is empty.`);
  for (const b of buckets) checkScope(ctx, b, 'Inventory');
  const target = await resolveTarget(tx, ctx, from.warehouseId, input.target, from.id);
  if (input.target.kind === 'location') {
    if (target.locationId === from.id)
      throw new DomainError('VALIDATION', 'Source and target locations are the same.', {
        fieldErrors: { target: ['Pick a different location'] },
      });
    for (const pid of new Set(buckets.map((b) => b.productId)))
      await explainSkuRule(tx, { locationId: target.locationId, lpId: null, productId: pid });
    const moved = await summarize(
      tx,
      await ledger.moveLocation(tx, ctx, {
        fromLocationId: from.id,
        toLocationId: target.locationId,
        refs: { note: input.note ?? null },
      }),
    );
    await pruneEmptyBuckets(
      tx,
      buckets.map((b) => b.id),
    );
    return moved;
  }
  for (const pid of new Set(buckets.map((b) => b.productId)))
    await explainSkuRule(tx, { locationId: target.locationId, lpId: target.lpId ?? null, productId: pid });
  const moved = await summarize(
    tx,
    await flatMapSeq(
      buckets,
      async (b) => await moveBucketTo(tx, ctx, b, target.locationId, target.lpId, input.note ?? null),
    ),
  );
  await pruneEmptyBuckets(
    tx,
    buckets.map((b) => b.id),
  );
  return moved;
}

export async function transferLp(
  tx: AppDb,
  ctx: DomainCtx,
  input: z.infer<typeof transferLpSchema>,
): Promise<TransferResult> {
  const lp = await getLp(tx, input.lpId);
  checkScope(ctx, { warehouseId: lp.warehouseId }, 'LP');
  const buckets = await bucketsWhere(tx, eq(schema.inventory.lpId, lp.id));
  for (const b of buckets) checkScope(ctx, b, 'Inventory');
  if (input.target.kind === 'location') {
    const target = await resolveTarget(
      tx,
      ctx,
      lp.warehouseId,
      input.target,
      lp.locationId ?? input.target.id,
    );
    for (const pid of new Set(buckets.map((b) => b.productId)))
      await explainSkuRule(tx, { locationId: target.locationId, lpId: null, productId: pid });
    return await summarize(
      tx,
      await ledger.moveLp(tx, ctx, {
        lpId: lp.id,
        toLocationId: target.locationId,
        refs: { note: input.note ?? null },
      }),
    );
  }
  if (input.target.id === lp.id)
    throw new DomainError('VALIDATION', 'Source and target LP are the same.', {
      fieldErrors: { target: ['Pick a different LP'] },
    });
  if (buckets.length === 0) throw invalidState(`LP ${lp.number} is empty.`);
  const target = await resolveTarget(
    tx,
    ctx,
    lp.warehouseId,
    input.target,
    lp.locationId ?? buckets[0].locationId,
  );
  for (const pid of new Set(buckets.map((b) => b.productId)))
    await explainSkuRule(tx, { locationId: target.locationId, lpId: target.lpId ?? null, productId: pid });
  const moved = await summarize(
    tx,
    await flatMapSeq(
      buckets,
      async (b) => await moveBucketTo(tx, ctx, b, target.locationId, target.lpId, input.note ?? null),
    ),
  );
  await pruneEmptyBuckets(
    tx,
    buckets.map((b) => b.id),
  );
  return moved;
}

/* -------------------------------------------------------- change attributes */

export async function changeAttributes(
  tx: AppDb,
  ctx: DomainCtx,
  input: ChangeAttributesInput,
): Promise<BulkResult> {
  const value = input.value ? input.value : null;
  if (input.attribute === 'damageReason') await assertDamageReason(tx, value);
  return await runBulk(tx, input.ids, async (inner, bucketId) => {
    const bucket = await getBucket(inner, bucketId);
    checkScope(ctx, bucket, 'Inventory');
    assertStock(bucket);
    await assertNotCountLocked(inner, await getLocation(inner, bucket.locationId));
    if (value !== null) {
      const untracked = untrackedAttributeMessage(await productOf(inner, bucket.productId), input.attribute);
      if (untracked) throw ruleViolation(untracked);
    }
    const current = bucket[input.attribute];
    if ((current ?? null) === value)
      throw new DomainError(
        'VALIDATION',
        `${ATTRIBUTE_LABELS[input.attribute]} is already ${value ?? 'empty'}.`,
      );
    const free = bucket.onHand - bucket.allocated;
    const units = input.qty !== undefined ? await toUom(inner, bucket, input.qty) : free;
    if (units <= 0)
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        'Every unit in this row is allocated; release the allocation first.',
      );
    if (units > free)
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        `Only ${free} unallocated units can change; ${units} requested.`,
      );
    const { target } = await ledger.changeAttributes(inner, ctx, {
      inventoryId: bucket.id,
      qty: units,
      [input.attribute]: value,
    });
    const loc = await getLocation(inner, bucket.locationId);
    await recordLine(inner, ctx, {
      entityType: 'location',
      entityId: loc.id,
      entityCode: loc.code,
      lineEntityType: 'inventory',
      lineEntityId: target.id,
      lineLabel: attributeChangeLineLabel(await skuOf(inner, bucket.productId), units),
      field: input.attribute,
      from: changeLogValue(current),
      to: changeLogValue(value),
    });
    await pruneEmptyBuckets(inner, [bucket.id]);
  });
}
