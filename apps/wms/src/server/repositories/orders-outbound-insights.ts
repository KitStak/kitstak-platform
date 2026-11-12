/**
 * Read-only explanations for the Shipment Orders bulk flows (critic r5):
 *   - `shipPreview`: which selected orders will ship only partly (packed < ordered) and what
 *     stays behind, so the Ship confirm and result say "Partially shipped: 1 of 2 units of
 *     APX-TEE-WHT-M remain" instead of claiming the order moves to Shipped & Canceled.
 *   - `explainShortages`: why an order can't be fully allocated (locked / inactive / no-allocation
 *     location, damaged stock, count lock, excluded by the allocation rule, other client), mirroring
 *     the candidate rules of `domain/allocation.ts`, for the job dry run and the wizard ATP note.
 * Nothing here writes.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import type { Scope } from '@/server/auth/scope';
import { scopedWhere } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { allocation } from '@/server/domain';
import { evaluateConditions } from '@/server/domain/conditions';
import { bucketFacts, orderFacts } from '@/server/domain/facts';
import { splitAllocationPreferences } from '@/server/domain/allocation-preferences';
import { countLockFor } from '@/server/domain/ledger/count-locks';
import { partialShipNote, type ShipLineFacts } from '@/lib/grid-defs/orders/ship-partial';
import { bulkIdsSchema } from './platform-common';

export { partialShipNote, unshippedAfterShip } from '@/lib/grid-defs/orders/ship-partial';

export const insightIdsSchema = z.object({ ids: bulkIdsSchema });

/* ------------------------------------------------------------------ ship */

export interface ShipPreview {
  /** Order id → partial-shipment note; orders that ship in full are absent. */
  readonly partial: Readonly<Record<string, string>>;
}

export async function shipPreview(db: AppDb, scope: Scope, ids: readonly string[]): Promise<ShipPreview> {
  const so = schema.shipmentOrders;
  const ol = schema.orderLines;
  const visible = (
    await db
      .select({ id: so.id })
      .from(so)
      .where(and(inArray(so.id, [...ids]), isNull(so.deletedAt), scopedWhere(so, scope)))
  ).map((r) => r.id);
  if (visible.length === 0) return { partial: {} };
  // Same source as `shipping.shipOrders`: it ships the Packed / Loaded allocations, not the line counter.
  const shipping = sql<number>`(SELECT COALESCE(SUM(a.qty), 0) FROM inventory_allocations a WHERE a.order_line_id = ${ol.id} AND a.status IN ('Packed','Loaded'))`;
  const rows = (
    await db
      .select({
        orderId: ol.orderId,
        sku: schema.products.sku,
        quantity: ol.quantity,
        cancelledQuantity: ol.cancelledQuantity,
        packedQuantity: shipping,
        shippedQuantity: ol.shippedQuantity,
      })
      .from(ol)
      .innerJoin(schema.products, eq(schema.products.id, ol.productId))
      .where(inArray(ol.orderId, visible))
  ).map((r) => ({ ...r, packedQuantity: Number(r.packedQuantity ?? 0) }));
  const byOrder = new Map<string, ShipLineFacts[]>();
  for (const r of rows) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);
  const partial: Record<string, string> = {};
  for (const [id, lines] of byOrder) {
    const note = partialShipNote(lines);
    if (note) partial[id] = note;
  }
  return { partial };
}

/* -------------------------------------------------------------- shortage */

export type BlockReason = 'locked' | 'inactive' | 'prevent' | 'damaged' | 'count' | 'rule' | 'lot';

export interface BucketFacts {
  readonly free: number;
  readonly locationCode: string;
  readonly areaType: string | null;
  readonly isActive: boolean;
  readonly isLocked: boolean;
  readonly preventAllocation: boolean;
  readonly damaged: boolean;
  readonly countLocked: boolean;
  readonly lotMismatch: boolean;
  readonly passesRule: boolean;
}

/** First reason allocation skips this bucket (same order as `candidates()` + rule filters), or null. */
export function bucketBlocker(b: BucketFacts): BlockReason | null {
  if (b.damaged) return 'damaged';
  if (!b.isActive) return 'inactive';
  if (b.isLocked) return 'locked';
  if (b.preventAllocation) return 'prevent';
  if (b.countLocked) return 'count';
  if (b.lotMismatch) return 'lot';
  if (!b.passesRule) return 'rule';
  return null;
}

const REASON_TEXT: Readonly<Record<BlockReason, string>> = {
  locked: 'in locked location',
  inactive: 'in inactive location',
  prevent: 'in location set to prevent allocation',
  damaged: 'damaged',
  count: 'in location locked by a count',
  lot: 'with another lot / expiry than the line asks for',
  rule: 'excluded by the allocation rule',
};

export interface LineShortage {
  readonly sku: string;
  readonly need: number;
  readonly allocatable: number;
  readonly blocked: readonly {
    readonly reason: BlockReason;
    readonly qty: number;
    readonly locations: readonly string[];
    readonly areas: readonly string[];
  }[];
  readonly otherClientQty: number;
  readonly ruleName: string | null;
}

/** "APX-TEE-BLK-S needs 1, 0 allocatable: 36 in locked location A-01-01-1; 589 excluded by the allocation rule 'Pick face' (Storage)." */
export function describeLineShortage(s: LineShortage): string {
  const parts = s.blocked.map((b) => {
    const where = b.locations.length
      ? ` ${b.locations.slice(0, 3).join(', ')}${b.locations.length > 3 ? ` +${b.locations.length - 3}` : ''}`
      : '';
    if (b.reason === 'rule')
      return `${b.qty} excluded by the allocation rule${s.ruleName ? ` '${s.ruleName}'` : ''}${b.areas.length ? ` (${b.areas.join(', ')} area)` : ''}`;
    return `${b.qty} ${REASON_TEXT[b.reason]}${b.reason === 'locked' || b.reason === 'inactive' || b.reason === 'prevent' || b.reason === 'count' ? where : ''}`;
  });
  if (s.otherClientQty > 0) parts.push(`${s.otherClientQty} belong to another client`);
  const head = `${s.sku} needs ${s.need}, ${s.allocatable} allocatable`;
  return parts.length ? `${head}: ${parts.join('; ')}.` : `${head}: no stock in this warehouse.`;
}

export interface OrderShortage {
  readonly orderId: string;
  readonly lines: readonly LineShortage[];
  readonly summary: string;
}

/** Why each order (Open / Shortage) can't be fully allocated. Orders that could be are omitted. */
export async function explainShortages(
  db: AppDb,
  scope: Scope,
  ids: readonly string[],
): Promise<Readonly<Record<string, OrderShortage>>> {
  const so = schema.shipmentOrders;
  const orders = await db
    .select()
    .from(so)
    .where(and(inArray(so.id, [...ids]), isNull(so.deletedAt), scopedWhere(so, scope)));
  const out: Record<string, OrderShortage> = {};
  const algos = new Map<string, Awaited<ReturnType<typeof allocation.loadAllocationAlgorithm>>>();
  for (const order of orders) {
    const algo =
      algos.get(order.warehouseId) ?? (await allocation.loadAllocationAlgorithm(db, order.warehouseId));
    algos.set(order.warehouseId, algo);
    const facts = await orderFacts(db, order);
    const rule = algo.rules.find((r) => evaluateConditions(r.conditions, facts)) ?? null;
    const filters = rule ? splitAllocationPreferences(rule.inventoryConditions).conditions : [];
    const lines = await db
      .select({ line: schema.orderLines, sku: schema.products.sku })
      .from(schema.orderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
      .where(eq(schema.orderLines.orderId, order.id));
    const shortLines: LineShortage[] = [];
    for (const { line, sku } of lines) {
      const need = line.quantity - line.cancelledQuantity - line.allocatedQuantity;
      if (need <= 0) continue;
      const i = schema.inventory;
      const l = schema.locations;
      const buckets = await db
        .select({ bucket: i, location: l, lpNumber: schema.licensePlates.number })
        .from(i)
        .innerJoin(l, eq(l.id, i.locationId))
        .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, i.lpId))
        .where(
          and(eq(i.warehouseId, order.warehouseId), eq(i.productId, line.productId), eq(i.status, 'Stock')),
        );
      let allocatable = 0;
      let otherClientQty = 0;
      const blocked = new Map<BlockReason, { qty: number; locations: Set<string>; areas: Set<string> }>();
      for (const { bucket, location, lpNumber } of buckets) {
        const free = bucket.onHand - bucket.allocated;
        if (free <= 0) continue;
        if (bucket.clientId !== order.clientId) {
          otherClientQty += free;
          continue;
        }
        const lotMismatch = Boolean(
          (line.lotNumber && bucket.lotNumber !== line.lotNumber) ||
          (line.expiryDate && bucket.expiryDate !== line.expiryDate) ||
          (line.productionDate && bucket.productionDate !== line.productionDate) ||
          (line.pinnedLocationId && bucket.locationId !== line.pinnedLocationId) ||
          (line.pinnedLpId && bucket.lpId !== line.pinnedLpId),
        );
        const reason = bucketBlocker({
          free,
          locationCode: location.code,
          areaType: location.areaType,
          isActive: location.isActive,
          isLocked: location.isLocked,
          preventAllocation: location.preventAllocation,
          damaged: bucket.damageReason !== null,
          countLocked: (await countLockFor(db, location.id)) !== null,
          lotMismatch,
          passesRule: rule ? evaluateConditions(filters, bucketFacts(bucket, location, lpNumber)) : false,
        });
        if (!reason) {
          allocatable += free;
          continue;
        }
        const entry = blocked.get(reason) ?? {
          qty: 0,
          locations: new Set<string>(),
          areas: new Set<string>(),
        };
        entry.qty += free;
        entry.locations.add(location.code);
        if (location.areaType) entry.areas.add(location.areaType);
        blocked.set(reason, entry);
      }
      if (allocatable >= need) continue;
      shortLines.push({
        sku,
        need,
        allocatable,
        otherClientQty,
        ruleName: rule?.name ?? null,
        blocked: [...blocked].map(([reason, e]) => ({
          reason,
          qty: e.qty,
          locations: [...e.locations].sort(),
          areas: [...e.areas].sort(),
        })),
      });
    }
    if (shortLines.length === 0) continue;
    const summary = !rule
      ? `No allocation rule of '${algo.name}' matches this order.`
      : shortLines.map(describeLineShortage).join(' ');
    out[order.id] = { orderId: order.id, lines: shortLines, summary };
  }
  return out;
}
