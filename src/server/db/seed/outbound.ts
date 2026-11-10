/**
 * Outbound replay, part 1: orders are created through `orders.createOrder` (code sequence,
 * address verification, workflows, change log) at their order time, then follow their fate:
 * cancel with a reason, hold (and release), or a workflow block on a PO-box address.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { changeLog, orders } from "@/server/domain";
import type { BulkResult, DomainCtx, Tx } from "@/server/domain/types";
import { buildOrderPlans, type OrderPlan } from "../seed-orders";
import { KS2_CLIENTS } from "./facility-data";
import { serviceKey } from "./integrations";
import { lookupId } from "./lookups";
import { DAY_MS, HOUR_MS, MINUTE_MS, isoOf, utcAt } from "./runtime";
import { integrationCtx, txAt, type Id } from "./types";
import { facilityOf, managerCtx, noteFailure, type World } from "./world";

export const REPLAY_DAYS = 30;

const CANCEL_REASONS = ["Customer request", "Customer request", "Duplicate", "Fraud", "Address undeliverable"] as const;
const GIFT_NOTES = ["Happy birthday! Love, Sam", "Congrats on the new job!", "Thinking of you - enjoy!", "Merry early holidays from the team"] as const;

/** Reports bulk failures from a domain call into the seed counters. */
export function checkBulk(w: World, label: string, result: BulkResult): void {
  for (const f of result.failed) noteFailure(w, label, new Error(`${f.code}: ${f.message}`));
}

function createInput(w: World, plan: OrderPlan): Parameters<typeof orders.createOrder>[2] {
  const fac = facilityOf(w, plan.warehouse);
  const connection = w.carriers.sandboxByWarehouse.get(fac.id) ?? null;
  const preset = plan.useRatePreset ? w.config.ratePresets.find((p) => p.clientId === plan.clientId) : undefined;
  const b2b = plan.channel === "Wholesale";
  const s = plan.shipTo;
  return {
    warehouseId: fac.id, clientId: plan.clientId, channel: plan.channel, storeName: plan.storeName, storeOrderNumber: plan.storeOrderNumber,
    customerName: s.customerName, customerEmail: s.email, customerPhone: s.phone, customerFirstName: s.firstName, customerLastName: s.lastName,
    companyName: s.companyName, shipAddress: s.line1, shipCity: s.city, shipState: s.state, shipZip: s.zip, shipCountry: s.country,
    addressType: b2b ? "Commercial" : "Residential", orderType: b2b ? "B2B" : "D2C",
    orderTypeId: lookupId(w.lookups, "so_type", b2b ? "B2B Order" : "D2C Order"), priority: plan.priority,
    carrierConnectionId: connection, carrierServiceId: connection ? w.carriers.services.get(serviceKey(connection, plan.serviceCode)) ?? null : null,
    rateShoppingPresetId: preset?.id ?? null, orderDate: isoOf(plan.createdMs), expectedShipDate: isoOf(plan.createdMs + (b2b ? 3 : 1) * DAY_MS),
    isGift: plan.isGift, giftNote: plan.isGift ? GIFT_NOTES[plan.key % GIFT_NOTES.length] : null,
    customFields: plan.isGift ? { textBox1: `GW-${["RED", "KRAFT", "NAVY"][plan.key % 3]}` } : {},
    packingInstructions: b2b ? "Floor-ready: one SKU per carton, case label on two sides, BOL in pouch." : null,
    lines: plan.lines.map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice })),
  };
}

function createPlannedOrder(w: World, tx: Tx, plan: OrderPlan): { id: Id; code: string } {
  const ctx: DomainCtx = plan.channel === "Manual" || plan.channel === "Wholesale" ? managerCtx(w) : integrationCtx;
  const order = orders.createOrder(tx, ctx, createInput(w, plan), { trigger: plan.channel === "Manual" ? "Shipment Order Created" : "Shipment Order Imported" });
  const connection = plan.viaChannelConnection ? w.channels.byClient.get(plan.clientId) : undefined;
  tx.update(schema.shipmentOrders).set({
    customerId: plan.customerId, retailerId: plan.retailerId, isPrime: plan.isPrime, channelConnectionId: connection?.id ?? null,
    channelPaymentStatus: plan.channel === "Manual" || plan.channel === "Wholesale" ? null : "paid",
    requestedShippingOption: plan.serviceCode === "SBX_NEXT_DAY" ? "Overnight" : plan.serviceCode === "SBX_2DAY" ? "2-Day" : "Standard",
    retailerPo: plan.retailerId ? `PO${4_500_000 + plan.key * 13}` : null, dept: plan.retailerId ? String(20 + (plan.key % 60)) : null,
  }).where(eq(schema.shipmentOrders.id, order.id)).run();
  return { id: order.id, code: order.code };
}

function blockOrder(tx: Tx, ctx: DomainCtx, id: Id, code: string): void {
  tx.update(schema.shipmentOrders).set({ workflowBlocked: "Fully", note: "Blocked by workflow 'Block PO box addresses': confirm a street address with the customer." })
    .where(eq(schema.shipmentOrders.id, id)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: id, entityCode: code, before: { workflowBlocked: "None" }, after: { workflowBlocked: "Fully" } });
}

function scheduleFate(w: World, plan: OrderPlan, id: Id, code: string): void {
  const mgr = managerCtx(w);
  const rng = w.env.rng;
  if (plan.fate === "cancel") {
    const at = plan.createdMs + rng.int(10, 40) * MINUTE_MS;
    const reasonId = lookupId(w.lookups, "so_cancel_reason", CANCEL_REASONS[plan.key % CANCEL_REASONS.length]);
    w.queue.schedule(at, `cancel ${code}`, () => checkBulk(w, `cancel ${code}`, txAt(w.env, at, (tx) => {
      // The request came too late when the order is already in a picking job: it ships.
      const inJob = tx.select({ jobId: schema.shipmentOrders.jobId }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get()?.jobId;
      return inJob ? { succeeded: [], failed: [] } : orders.cancelOrders(tx, mgr, { ids: [id], reasonId });
    })));
  }
  if (plan.fate === "hold" || plan.fate === "holdRelease") {
    const at = plan.createdMs + rng.int(5, 25) * MINUTE_MS;
    w.queue.schedule(at, `hold ${code}`, () => {
      checkBulk(w, `hold ${code}`, txAt(w.env, at, (tx) => orders.holdOrders(tx, mgr, { ids: [id] })));
      txAt(w.env, at, (tx) => tx.update(schema.shipmentOrders).set({ note: "On hold: payment verification requested by the client." }).where(eq(schema.shipmentOrders.id, id)).run());
    });
    if (plan.fate === "holdRelease") {
      const rel = at + 20 * HOUR_MS;
      w.queue.schedule(rel, `release ${code}`, () => checkBulk(w, `release ${code}`, txAt(w.env, rel, (tx) => orders.releaseOrders(tx, mgr, { ids: [id] }))));
    }
  }
  if (plan.fate === "blocked") {
    const at = plan.createdMs + 1000;
    w.queue.schedule(at, `block ${code}`, () => txAt(w.env, at, (tx) => blockOrder(tx, integrationCtx, id, code)));
  }
}

/** Builds the order plans and schedules their creation. Returns the plans. */
export function scheduleOrders(w: World): readonly OrderPlan[] {
  const ks2ClientIds = new Set(KS2_CLIENTS.flatMap((code) => {
    const c = w.org.clientByCode.get(code);
    return c ? [c.id] : [];
  }));
  const productsFor = (code: "MLT1" | "KS2") => {
    const stocked = new Set(facilityOf(w, code).products.map((p) => p.id));
    return new Map([...w.catalog.sellableByClient].map(([clientId, list]) => [clientId, list
      .filter((p) => stocked.has(p.id))
      .map((p) => ({ id: p.id, clientId: p.clientId, price: p.price, isKit: p.kitType !== null }))]));
  };
  const plans = buildOrderPlans(w.env.rng, {
    days: REPLAY_DAYS, at: utcAt, endMs: w.endMs,
    clients: w.org.clients.map((c) => ({ id: c.id, name: c.name, weight: c.weight, hasChannelConnection: w.channels.byClient.has(c.id) })),
    products: { MLT1: productsFor("MLT1"), KS2: productsFor("KS2") },
    customersByClient: w.org.customersByClient, retailers: w.org.retailers, ks2ClientIds,
  });
  for (const plan of plans) {
    w.queue.schedule(plan.createdMs, `order ${plan.key}`, () => {
      const created = txAt(w.env, plan.createdMs, (tx) => createPlannedOrder(w, tx, plan));
      w.orders.set(plan.key, { plan, id: created.id, code: created.code });
      scheduleFate(w, plan, created.id, created.code);
    });
  }
  return plans;
}
