/**
 * Returns replay: twelve RMAs against delivered orders across every status. Return labels
 * come from the sandbox carrier (In Transit), receipts post ledger Return Receiving into
 * MLT1-RTN, restocked units go back to the pick face and damaged returns stay flagged.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { desc } from "@/server/db/order";
import type { ReturnStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, sequences, shipping, stateMachines } from "@/server/domain";
import type { DomainCtx } from "@/server/domain/types";
import { serviceKey } from "./integrations";
import { lookupId } from "./lookups";
import { DAY_MS, HOUR_MS, isoOf, setClock, utcAt } from "./runtime";
import { actor, retryBusy, txAt, type Id } from "./types";
import { noteFailure, operatorFor, type World } from "./world";
import { forEachSeq, mapSeq } from "@/server/db/sql";

interface ReturnSpec {
  readonly target: ReturnStatus;
  readonly daysAgo: number;
  readonly reason: string;
  readonly damaged?: boolean;
  readonly source?: "RMA" | "Loop Returns";
}

const SPECS: readonly ReturnSpec[] = [
  { target: "Completed", daysAgo: 20, reason: "Wrong size" },
  { target: "Completed", daysAgo: 16, reason: "Damaged in transit", damaged: true },
  { target: "Cancelled", daysAgo: 14, reason: "Changed mind" },
  { target: "Completed", daysAgo: 12, reason: "Ordered by mistake", source: "Loop Returns" },
  { target: "Completed", daysAgo: 9, reason: "Defective", damaged: true },
  { target: "Started", daysAgo: 7, reason: "Wrong size", source: "Loop Returns" },
  { target: "Cancelled", daysAgo: 6, reason: "Item not as described" },
  { target: "Started", daysAgo: 5, reason: "Changed mind" },
  { target: "In Transit", daysAgo: 3, reason: "Wrong size" },
  { target: "In Transit", daysAgo: 2, reason: "Defective" },
  { target: "Pending", daysAgo: 1, reason: "Ordered by mistake", source: "Loop Returns" },
  { target: "Pending", daysAgo: 0, reason: "Changed mind" },
];

const usedOrders = new Set<Id>();
export function resetReturnState(): void {
  usedOrders.clear();
}

async function pickOrder(w: World): Promise<{ id: Id; clientId: Id; customerName: string; lines: (typeof schema.orderLines.$inferSelect)[] } | null> {
  const serial = w.catalog.products.filter((p) => p.trackSerial || p.kitType !== null).map((p) => p.id);
  const candidates = await w.env.db.select().from(schema.shipmentOrders).where(and(
    eq(schema.shipmentOrders.warehouseId, w.facility.MLT1.id), inArray(schema.shipmentOrders.status, ["Delivered", "Shipped"]),
    eq(schema.shipmentOrders.orderType, "D2C"), eq(schema.shipmentOrders.shipCountry, "United States"),
  )).orderBy(desc(schema.shipmentOrders.shippedAt)).limit(40);
  for (const o of candidates) {
    if (usedOrders.has(o.id)) continue;
    const lines = (await w.env.db.select().from(schema.orderLines).where(and(eq(schema.orderLines.orderId, o.id), notInArray(schema.orderLines.productId, serial.length > 0 ? serial : [""]))))
      .filter((l) => l.shippedQuantity > 0);
    if (lines.length === 0) continue;
    usedOrders.add(o.id);
    return { id: o.id, clientId: o.clientId, customerName: o.customerName, lines: lines.slice(0, 2) };
  }
  return null;
}

async function setStatus(w: World, ctx: DomainCtx, id: Id, code: string, to: ReturnStatus, atMs: number): Promise<void> {
  await txAt(w.env, atMs, async (tx) => {
    const ro = (await tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, id)).limit(1))[0];
    if (!ro || ro.status === to) return;
    const status = stateMachines.returnOrder.transition(ro.status, to);
    await tx.update(schema.returnOrders).set({ status, updatedBy: ctx.userId }).where(eq(schema.returnOrders.id, id));
    if (to === "Completed" || to === "Cancelled") await tx.update(schema.returnOrderLines).set({ lineStatus: to }).where(eq(schema.returnOrderLines.returnOrderId, id));
    await changeLog.recordUpdate(tx, ctx, { entityType: "return_order", entityId: id, entityCode: code, before: { status: ro.status }, after: { status } });
  });
}

async function receiveReturn(w: World, ctx: DomainCtx, spec: ReturnSpec, ro: { id: Id; code: string; clientId: Id }, lines: readonly { id: Id; productId: Id; qty: number }[], atMs: number, partial: boolean): Promise<void> {
  const fac = w.facility.MLT1;
  await txAt(w.env, atMs, async (tx) => {
    await forEachSeq(lines.slice(0, partial ? 1 : lines.length), async (l) => {
      const p = w.catalog.products.find((x) => x.id === l.productId);
      const { txn } = await ledger.recordReceipt(tx, ctx, {
        type: "Return", warehouseId: fac.id, clientId: ro.clientId, productId: l.productId, packType: p?.uom, quantity: l.qty, locationId: fac.rtn,
        returnOrderId: ro.id, returnOrderLineId: l.id, damageReason: spec.damaged ? "Customer Return - Damaged" : null,
        customerReturnReason: spec.reason, actualReturnReason: spec.damaged ? "Damaged" : spec.reason, note: `Return received for ${ro.code}`,
      });
      await tx.update(schema.returnOrderLines).set({ disposition: spec.damaged ? "Damaged" : "Restock",
        actualReturnReasonId: lookupId(w.lookups, "return_reason", spec.damaged ? "Damaged in transit" : spec.reason) }).where(eq(schema.returnOrderLines.id, l.id));
      const face = fac.pickFaces.get(l.productId);
      if (!spec.damaged && !partial && face && txn.toInventoryId) {
        await ledger.move(tx, ctx, { inventoryId: txn.toInventoryId, qty: l.qty, toLocationId: face, refs: { returnOrderId: ro.id, note: "Inspected and restocked" } });
      }
    });
  });
}

async function runReturn(w: World, spec: ReturnSpec, atMs: number): Promise<void> {
  const order = await pickOrder(w);
  if (!order) return;
  const ctx = actor(w.access.manager);
  const created = await txAt(w.env, atMs, async (tx) => {
    const code = await sequences.next(tx, "rma");
    const ro = (await tx.insert(schema.returnOrders).values({
      rmaCode: code, shipmentOrderId: order.id, warehouseId: w.facility.MLT1.id, clientId: order.clientId, source: spec.source ?? "RMA",
      customerName: order.customerName, fromCountry: "United States", expectedReturnDate: isoOf(atMs + 5 * DAY_MS), note: `Customer reason: ${spec.reason}`, createdBy: ctx.userId,
    }).returning())[0];
    const lines = await mapSeq(order.lines, async (l) => ({
      id: (await tx.insert(schema.returnOrderLines).values({ returnOrderId: ro.id, orderLineId: l.id, productId: l.productId, packType: l.packType, requestedQty: l.shippedQuantity,
        customerReturnReasonId: lookupId(w.lookups, "return_reason", spec.reason) }).returning({ id: schema.returnOrderLines.id }))[0].id,
      productId: l.productId, qty: l.shippedQuantity,
    }));
    await changeLog.recordCreate(tx, ctx, { entityType: "return_order", entityId: ro.id, entityCode: code });
    return { id: ro.id, code, clientId: ro.clientId, lines };
  });
  if (spec.target === "Pending") return;
  if (spec.target === "Cancelled") {
    await setStatus(w, ctx, created.id, created.code, "Cancelled", atMs + 6 * HOUR_MS);
    return;
  }
  const conn = w.carriers.sandboxByWarehouse.get(w.facility.MLT1.id) as Id;
  setClock(atMs + HOUR_MS);
  await retryBusy(() => shipping.createReturnLabel(w.env.db, ctx, {
    orderId: order.id, returnOrderId: created.id, carrierConnectionId: conn, carrierServiceId: w.carriers.services.get(serviceKey(conn, "SBX_GROUND_ADVANTAGE")) as Id,
    package: { weightOz: 16, length: 12, width: 10, height: 4 },
  }, { files: w.env.files }));
  if (spec.target === "In Transit") return;
  const receiver = actor(operatorFor(w, "MLT1", spec.daysAgo));
  const recvAt = atMs + Math.min(spec.daysAgo - 1, 3) * DAY_MS + 15 * HOUR_MS - atMs % DAY_MS;
  await receiveReturn(w, receiver, spec, created, created.lines, Math.max(recvAt, atMs + 2 * HOUR_MS), spec.target === "Started" && created.lines.length > 1);
  if (spec.target === "Completed") await setStatus(w, receiver, created.id, created.code, "Completed", Math.max(recvAt, atMs + 2 * HOUR_MS) + HOUR_MS);
}

export function scheduleReturns(w: World): number {
  SPECS.forEach((spec, i) => {
    const at = utcAt(spec.daysAgo, spec.daysAgo === 0 ? 14 : 16, 7 * i);
    w.queue.schedule(at, `return ${i}`, async () => {
      try {
        await runReturn(w, spec, at);
      } catch (error) {
        noteFailure(w, `return ${i}`, error);
      }
    });
  });
  return SPECS.length;
}
