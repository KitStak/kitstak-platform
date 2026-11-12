/**
 * Inbound replay: purchase orders are created, checked in, received (receipts + ledger
 * Receiving, damaged units to DMG-01), put away to storage (Inventory Movement) and
 * completed or cancelled through the PO state machine.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { changeLog, ledger, sequences, stateMachines } from '@/server/domain';
import { getBucket } from '@/server/domain/ledger';
import type { DomainCtx, Tx } from '@/server/domain/types';
import { buildPoPlans, type PoLinePlan, type PoPlan } from '../seed-builders';
import type { ProductRef } from './catalog';
import type { LpRef, WarehouseFacility } from './facility';
import { expiryFor, lotCode } from './opening';
import { HOUR_MS, MINUTE_MS, dateOf, isoOf, utcAt } from './runtime';
import { actor, round2, txAt, type Id } from './types';
import { facilityOf, managerCtx, noteFailure, operatorFor, type World } from './world';
import { mapSeq } from '@/server/db/sql';

const RECEIVING_DOORS = ['RECV-01', 'RECV-02', 'RECV-03'] as const;

interface PoRuntime {
  readonly plan: PoPlan;
  readonly id: Id;
  readonly code: string;
  readonly lineIds: readonly Id[];
}

function vendorOf(w: World, plan: PoPlan): { id: Id | null; name: string } {
  const vendors = w.org.vendorsByClient.get(plan.clientId) ?? [];
  const v = vendors[plan.vendorIndex] ?? vendors[0];
  return { id: v?.id ?? null, name: v?.name ?? 'Unknown vendor' };
}

const productOf = (w: World, id: Id): ProductRef => {
  const p = w.catalog.products.find((x) => x.id === id);
  if (!p) throw new Error(`Seed PO references unknown product ${id}`);
  return p;
};

async function createPo(w: World, tx: Tx, plan: PoPlan): Promise<PoRuntime> {
  const ctx = managerCtx(w);
  const fac = facilityOf(w, plan.warehouse);
  const vendor = vendorOf(w, plan);
  const code = await sequences.next(tx, 'po');
  const totalQuantity = plan.lines.reduce((s, l) => s + l.orderedQty, 0);
  const arrivalMs = utcAt(plan.arrivalDaysAgo, 13);
  const po = (
    await tx
      .insert(schema.purchaseOrders)
      .values({
        code,
        warehouseId: fac.id,
        clientId: plan.clientId,
        vendorId: vendor.id,
        vendorName: vendor.name,
        referenceNumber: plan.reference,
        status: 'Pending',
        poType: plan.poType,
        totalQuantity,
        purchasePrice: round2(plan.lines.reduce((s, l) => s + l.orderedQty * l.unitCost, 0)),
        poDate: dateOf(utcAt(plan.createdDaysAgo, 14)),
        expectedDate: isoOf(arrivalMs),
        plannedArrivalDate: isoOf(arrivalMs),
        plannedReceivingDate: isoOf(arrivalMs + 2 * HOUR_MS),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
  )[0];
  const lineIds = await mapSeq(plan.lines, async (l) => {
    const p = productOf(w, l.productId);
    return (
      await tx
        .insert(schema.purchaseOrderLines)
        .values({
          purchaseOrderId: po.id,
          productId: p.id,
          orderedQuantity: l.orderedQty,
          unitCost: l.unitCost,
          packType: l.packType === 'Case' ? 'Case' : p.uom,
          uomQuantity: l.packType === 'Case' ? (p.caseQty ?? 1) : 1,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: schema.purchaseOrderLines.id })
    )[0].id;
  });
  await changeLog.recordCreate(tx, ctx, { entityType: 'purchase_order', entityId: po.id, entityCode: code });
  return { plan, id: po.id, code, lineIds };
}

async function transitionPo(
  tx: Tx,
  ctx: DomainCtx,
  poId: Id,
  to: 'Started' | 'Completed' | 'Cancelled',
  stamp: Partial<typeof schema.purchaseOrders.$inferInsert>,
): Promise<void> {
  const po = (
    await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId)).limit(1)
  )[0];
  if (!po || po.status === to) return;
  const status = stateMachines.purchaseOrder.transition(po.status, to, { activeReceipts: 0 });
  await tx
    .update(schema.purchaseOrders)
    .set({ status, ...stamp, updatedBy: ctx.userId })
    .where(eq(schema.purchaseOrders.id, poId));
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'purchase_order',
    entityId: poId,
    entityCode: po.code,
    before: { status: po.status },
    after: { status },
  });
}

/** A storage location already holding the SKU (same-SKU putaway), else the next one in rotation. */
async function putawayTarget(
  tx: Tx,
  fac: WarehouseFacility,
  productId: Id,
  cursor: { n: number },
): Promise<Id> {
  const existing = (
    await tx
      .select({ locationId: schema.inventory.locationId })
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.productId, productId),
          eq(schema.inventory.warehouseId, fac.id),
          gt(schema.inventory.onHand, 0),
          inArray(schema.inventory.locationId, [...fac.reserve]),
        ),
      )
      .limit(1)
  )[0];
  if (existing) return existing.locationId;
  cursor.n += 1;
  return fac.reserve[(cursor.n * 7) % fac.reserve.length];
}

interface ReceiveArgs {
  readonly po: PoRuntime;
  readonly lineIndex: number;
  readonly qty: number;
  readonly lp: LpRef | null;
  readonly door: Id;
  readonly damaged?: boolean;
}

async function receive(
  w: World,
  tx: Tx,
  ctx: DomainCtx,
  a: ReceiveArgs,
): Promise<{ inventoryId: Id | null; receiptId: Id }> {
  const line: PoLinePlan = a.po.plan.lines[a.lineIndex];
  const p = productOf(w, line.productId);
  const fac = facilityOf(w, a.po.plan.warehouse);
  const now = Date.now();
  const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
    type: 'Purchase Order',
    warehouseId: fac.id,
    clientId: a.po.plan.clientId,
    productId: p.id,
    packType: line.packType === 'Case' ? 'Case' : p.uom,
    quantity: a.qty,
    locationId: a.damaged ? (fac.damaged ?? fac.recv) : a.door,
    lpId: a.lp?.id ?? null,
    purchaseOrderId: a.po.id,
    purchaseOrderLineId: a.po.lineIds[a.lineIndex],
    lotNumber: p.trackLot ? lotCode(now, a.lineIndex) : null,
    expiryDate: p.trackLot ? expiryFor(now) : null,
    damageReason: a.damaged ? 'Crushed Packaging' : null,
    lineNote: a.damaged ? 'Outer carton crushed on arrival; photos attached to the BOL.' : null,
  });
  if (a.damaged) {
    await tx
      .update(schema.purchaseOrderLines)
      .set({ damagedQuantity: a.qty })
      .where(eq(schema.purchaseOrderLines.id, a.po.lineIds[a.lineIndex]));
  }
  return { inventoryId: txn.toInventoryId, receiptId: receipt.id };
}

async function putaway(
  w: World,
  tx: Tx,
  ctx: DomainCtx,
  fac: WarehouseFacility,
  inventoryId: Id,
  lp: LpRef | null,
  cursor: { n: number },
): Promise<void> {
  const bucket = await getBucket(tx, inventoryId);
  if (bucket.onHand - bucket.allocated <= 0) return;
  const target = await putawayTarget(tx, fac, bucket.productId, cursor);
  const refs = {
    algorithmName: 'SAME_SKU_EMPTY_LOCATION_ALGORITHM',
    algorithmRuleName: 'Same SKU in storage',
  };
  if (lp) {
    await ledger.moveLp(tx, ctx, { lpId: lp.id, toLocationId: target, refs });
    return;
  }
  const product = productOf(w, bucket.productId);
  await ledger.move(tx, ctx, {
    inventoryId,
    qty: bucket.onHand - bucket.allocated,
    toLocationId: target,
    toPackType: product.uom,
    refs,
  });
}

interface ScheduleState {
  readonly palletCursor: Map<string, number>;
  readonly putawayCursor: Map<string, { n: number }>;
}

function takePallet(fac: WarehouseFacility, state: ScheduleState): LpRef | null {
  const start = fac.pallets.length - 14;
  const used = state.palletCursor.get(fac.code) ?? 0;
  if (used >= 14) return null;
  state.palletCursor.set(fac.code, used + 1);
  return fac.pallets[start + used] ?? null;
}

function scheduleLineReceipts(
  w: World,
  po: PoRuntime,
  i: number,
  startMs: number,
  state: ScheduleState,
): number {
  const line = po.plan.lines[i];
  const fac = facilityOf(w, po.plan.warehouse);
  const user = operatorFor(w, po.plan.warehouse, po.plan.key + i);
  const ctx = actor(user);
  const door =
    fac.code === 'MLT1' ? (fac.locations.get(RECEIVING_DOORS[(po.plan.key + i) % 3]) ?? fac.recv) : fac.recv;
  const lp =
    line.packType === 'primary' &&
    !w.catalog.products.find((p) => p.id === line.productId)?.trackSerial &&
    w.env.rng.chance(0.4)
      ? takePallet(fac, state)
      : null;
  const cursor = state.putawayCursor.get(fac.code) ?? { n: 40 };
  state.putawayCursor.set(fac.code, cursor);
  const firstQty = line.orderedQty - line.secondReceiptQty - (line.damagedQty > 0 ? line.damagedQty : 0);
  const at = startMs + i * 18 * MINUTE_MS;
  w.queue.schedule(at, `receive ${po.code}#${i + 1}`, async () => {
    const got = await txAt(w.env, at, async (tx) => {
      if (po.plan.hasCancelledReceipt && i === 0) {
        const wrong = await receive(w, tx, ctx, { po, lineIndex: i, qty: firstQty + 12, lp: null, door });
        await ledger.cancelReceipt(tx, ctx, { receiptId: wrong.receiptId });
      }
      const r = await receive(w, tx, ctx, { po, lineIndex: i, qty: firstQty, lp, door });
      if (line.damagedQty > 0)
        await receive(w, tx, ctx, { po, lineIndex: i, qty: line.damagedQty, lp: null, door, damaged: true });
      return r;
    });
    const putAt = at + 2 * HOUR_MS + w.env.rng.int(0, 40) * MINUTE_MS;
    if (got.inventoryId) {
      const inventoryId = got.inventoryId;
      w.queue.schedule(
        putAt,
        `putaway ${po.code}#${i + 1}`,
        async () =>
          await txAt(w.env, putAt, async (tx) => await putaway(w, tx, ctx, fac, inventoryId, lp, cursor)),
      );
    }
  });
  if (line.secondReceiptQty > 0) {
    const later = at + 22 * HOUR_MS;
    w.queue.schedule(later, `receive-2 ${po.code}#${i + 1}`, async () => {
      const r = await txAt(
        w.env,
        later,
        async (tx) =>
          await receive(w, tx, ctx, { po, lineIndex: i, qty: line.secondReceiptQty, lp: null, door }),
      );
      if (r.inventoryId) {
        const inventoryId = r.inventoryId;
        const putAt = later + 90 * MINUTE_MS;
        w.queue.schedule(
          putAt,
          `putaway-2 ${po.code}`,
          async () =>
            await txAt(w.env, putAt, async (tx) => await putaway(w, tx, ctx, fac, inventoryId, null, cursor)),
        );
      }
    });
  }
  return at;
}

function schedulePo(w: World, plan: PoPlan, state: ScheduleState): void {
  const createdAt = utcAt(plan.createdDaysAgo, 14, w.env.rng.int(0, 50));
  const arrivalAt = utcAt(plan.arrivalDaysAgo, 12, 30);
  w.queue.schedule(createdAt, `create PO ${plan.key}`, async () => {
    const po = await txAt(w.env, createdAt, async (tx) => await createPo(w, tx, plan));
    const mgr = managerCtx(w);
    if (plan.status === 'Cancelled') {
      const at = createdAt + 2 * 24 * HOUR_MS;
      w.queue.schedule(
        at,
        `cancel ${po.code}`,
        async () =>
          await txAt(
            w.env,
            at,
            async (tx) =>
              await transitionPo(tx, mgr, po.id, 'Cancelled', {
                cancelledAt: isoOf(at),
                note: 'Cancelled by client: vendor could not meet the ship window.',
              }),
          ),
      );
      return;
    }
    if (plan.status === 'Pending') return;
    w.queue.schedule(
      arrivalAt - 30 * MINUTE_MS,
      `arrive ${po.code}`,
      async () =>
        await txAt(w.env, arrivalAt - 30 * MINUTE_MS, async (tx) =>
          plan.status === 'Started'
            ? await transitionPo(tx, mgr, po.id, 'Started', {
                actualArrivalDate: isoOf(arrivalAt - 30 * MINUTE_MS),
              })
            : void (await tx
                .update(schema.purchaseOrders)
                .set({ actualArrivalDate: isoOf(arrivalAt - 30 * MINUTE_MS) })
                .where(eq(schema.purchaseOrders.id, po.id))),
        ),
    );
    if (plan.status === 'Started') return;
    const last = plan.lines.reduce(
      (max, _l, i) => Math.max(max, scheduleLineReceipts(w, po, i, arrivalAt, state)),
      arrivalAt,
    );
    if (plan.status === 'Completed') {
      const doneAt = last + 3 * HOUR_MS;
      w.queue.schedule(
        doneAt,
        `complete ${po.code}`,
        async () =>
          await txAt(
            w.env,
            doneAt,
            async (tx) => await transitionPo(tx, mgr, po.id, 'Completed', { completedAt: isoOf(doneAt) }),
          ),
      );
    }
  });
}

/** Builds the PO plan and schedules every PO's lifecycle on the queue. */
export function scheduleInbound(w: World): number {
  const forWarehouse = (code: 'MLT1' | 'KS2') => {
    const fac = facilityOf(w, code);
    const clients = [...new Set(fac.products.map((p) => p.clientId))];
    return clients
      .map((clientId) => ({
        id: clientId,
        vendorIds: (w.org.vendorsByClient.get(clientId) ?? []).map((v) => v.id),
        products: fac.products
          .filter((p) => p.clientId === clientId && !p.isPackaging && !p.kitType && !p.trackSerial)
          .map((p) => ({ id: p.id, price: p.price, caseQty: p.caseQty })),
      }))
      .filter((c) => c.products.length > 0 && w.org.clients.find((x) => x.id === c.id)?.code !== 'PXP');
  };
  const plans = buildPoPlans(w.env.rng, forWarehouse('MLT1'), forWarehouse('KS2'));
  const state: ScheduleState = { palletCursor: new Map(), putawayCursor: new Map() };
  for (const plan of plans) {
    try {
      schedulePo(w, plan, state);
    } catch (error) {
      noteFailure(w, `schedule PO ${plan.key}`, error);
    }
  }
  return plans.length;
}
