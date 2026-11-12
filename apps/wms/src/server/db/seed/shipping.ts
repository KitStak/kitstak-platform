/**
 * Outbound replay, part 4: carrier labels (rate shopping, multi-package, voids, carrier
 * errors) through the async `shipping.*` commands against the KitStak Sandbox carrier,
 * the daily carrier pickup (`shipping.shipOrders`, which posts Shipment transactions and
 * builds end-of-day manifests), manifest close, and carrier delivery confirmations.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { changeLog, shipping, stateMachines } from "@/server/domain";
import type { DomainCtx } from "@/server/domain/types";
import { SANDBOX_SERVICES } from "@/server/domain/carriers/sandbox";
import type { WarehouseCode } from "../seed-orders";
import { PACKAGES } from "./facility-data";
import { serviceKey } from "./integrations";
import { DAY_MS, HOUR_MS, MINUTE_MS, isoOf, isWeekend, setClock, utcAt, weekdayOf } from "./runtime";
import { actor, retryBusy, txAt, type Id } from "./types";
import { checkBulk } from "./outbound";
import { facilityOf, noteFailure, operatorFor, type OrderRuntime, type World } from "./world";

const MAX_CARRIER_ERRORS = 6;
const MAX_VOIDS = 3;
const counters = { labels: 0, errors: 0, voids: 0 };

export function resetShippingState(): void {
  counters.labels = 0;
  counters.errors = 0;
  counters.voids = 0;
}

type PackageInput = Parameters<typeof shipping.createLabel>[2]["packages"][number];

function packageFor(code: WarehouseCode, b2b: boolean, weightOz: number, coffee: boolean): (typeof PACKAGES)[number] {
  const pick = (c: string) => PACKAGES.find((p) => p.code === c) ?? PACKAGES[2];
  if (b2b) return pick(code === "KS2" ? "BOX-L-1612" : "CTN-B2B-2418");
  if (coffee && code === "MLT1") return pick("BOX-CF-0909");
  if (weightOz <= 12) return pick(code === "KS2" ? "BOX-S-0806" : "ENV-POLY-1013");
  if (weightOz <= 48) return pick(code === "KS2" ? "BOX-M-1210" : "BOX-M-1210");
  return pick("BOX-L-1612");
}

async function packagesFor(w: World, r: OrderRuntime): Promise<PackageInput[]> {
  const lines = (await w.env.db.select({ id: schema.orderLines.id, productId: schema.orderLines.productId, packed: schema.orderLines.packedQuantity })
    .from(schema.orderLines).where(eq(schema.orderLines.orderId, r.id))).filter((l) => l.packed > 0);
  const products = new Map(w.catalog.products.map((p) => [p.id, p]));
  const fac = facilityOf(w, r.plan.warehouse);
  const b2b = r.plan.channel === "Wholesale";
  const groups = r.plan.packages === 2 && lines.length > 1
    ? [lines.slice(0, Math.ceil(lines.length / 2)), lines.slice(Math.ceil(lines.length / 2))]
    : [lines];
  return groups.map((group) => {
    const weight = group.reduce((s, l) => s + l.packed * (products.get(l.productId)?.weightOz ?? 8), 0);
    const coffee = group.every((l) => products.get(l.productId)?.category === "Coffee");
    const pkg = packageFor(r.plan.warehouse, b2b, weight, coffee);
    return {
      weightOz: Math.max(1, Math.round((weight + pkg.emptyWeightLb * 16) * 10) / 10), length: pkg.dims[0], width: pkg.dims[1], height: pkg.dims[2],
      shipmentPackageId: fac.packages.get(pkg.code) ?? null, items: group.map((l) => ({ orderLineId: l.id, qty: l.packed })),
    };
  });
}

async function provokeCarrierError(w: World, ctx: DomainCtx, r: OrderRuntime, connectionId: Id, packages: readonly PackageInput[]): Promise<void> {
  const domestic = r.plan.shipTo.country === "United States";
  const badService = w.carriers.services.get(serviceKey(connectionId, domestic ? "SBX_INTL" : "SBX_GROUND"));
  const input = counters.errors % 2 === 0 && badService
    ? { orderId: r.id, carrierConnectionId: connectionId, carrierServiceId: badService, packages, source: "PackingStation" }
    : { orderId: r.id, carrierConnectionId: connectionId, carrierServiceId: w.carriers.services.get(serviceKey(connectionId, r.plan.serviceCode)) ?? "", packages: packages.map((p) => ({ ...p, weightOz: 0 })), source: "PackingStation" };
  try {
    await retryBusy(() => shipping.createLabel(w.env.db, ctx, input, { files: w.env.files }));
  } catch {
    counters.errors += 1; // expected: the sandbox rejects it and the call log records the error
  }
}

async function chooseService(w: World, ctx: DomainCtx, r: OrderRuntime, connectionId: Id, packages: readonly PackageInput[]): Promise<{ serviceId: Id; presetId: Id | null }> {
  const fallback = w.carriers.services.get(serviceKey(connectionId, r.plan.serviceCode)) as Id;
  const preset = r.plan.useRatePreset ? w.config.ratePresets.find((p) => p.clientId === r.plan.clientId) : undefined;
  if (!preset || r.plan.warehouse !== "MLT1") return { serviceId: fallback, presetId: null };
  const shop = await retryBusy(() => shipping.rateShop(w.env.db, ctx, { orderId: r.id, packages, presetId: preset.id, carrierConnectionIds: [connectionId] }));
  return { serviceId: shop.selected?.carrierServiceId ?? fallback, presetId: preset.id };
}

async function createLabelFor(w: World, r: OrderRuntime, atMs: number): Promise<void> {
  const fac = facilityOf(w, r.plan.warehouse);
  const connectionId = w.carriers.sandboxByWarehouse.get(fac.id) as Id;
  const ctx = actor(operatorFor(w, r.plan.warehouse, 1));
  const packages = await packagesFor(w, r);
  if (packages.length === 0) return;
  counters.labels += 1;
  if (counters.errors < MAX_CARRIER_ERRORS && counters.labels % 37 === 9) await provokeCarrierError(w, ctx, r, connectionId, packages);
  const { serviceId, presetId } = await chooseService(w, ctx, r, connectionId, packages);
  const label = await retryBusy(() => shipping.createLabel(w.env.db, ctx, { orderId: r.id, carrierConnectionId: connectionId, carrierServiceId: serviceId, packages, rateShoppingPresetId: presetId, source: r.plan.channel === "Wholesale" ? "ShipmentPlan" : "PackingStation" }, { files: w.env.files }));
  if (presetId) await w.env.db.update(schema.shipments).set({ isRateShopped: true, rateShoppingPresetId: presetId }).where(inArray(schema.shipments.id, label.shipments.map((s) => s.id)));
  const domesticSingle = r.plan.shipTo.country === "United States" && r.plan.channel !== "Wholesale";
  if (counters.voids < MAX_VOIDS && domesticSingle && counters.labels % 61 === 17) {
    counters.voids += 1;
    setClock(atMs + 25 * MINUTE_MS);
    await retryBusy(() => shipping.voidLabel(w.env.db, ctx, { shipmentId: label.shipments[0].id }));
    const upgrade = w.carriers.services.get(serviceKey(connectionId, "SBX_2DAY")) as Id;
    setClock(atMs + 30 * MINUTE_MS);
    await retryBusy(() => shipping.createLabel(w.env.db, ctx, { orderId: r.id, carrierConnectionId: connectionId, carrierServiceId: upgrade, packages, source: "OrderGrid" }, { files: w.env.files }));
  }
}

/** Schedules label creation for an order that just became Ready to Ship. */
export function scheduleLabel(w: World, r: OrderRuntime, atMs: number): void {
  w.queue.schedule(atMs, `label ${r.code}`, async () => {
    try {
      await createLabelFor(w, r, atMs);
    } catch (error) {
      noteFailure(w, `label ${r.code}`, error);
    }
  });
}

function transitDaysOf(serviceName: string): number {
  return SANDBOX_SERVICES.find((s) => serviceName.endsWith(s.name))?.transitDays ?? 4;
}

function addBusinessDays(ms: number, days: number): number {
  let out = ms;
  let added = 0;
  while (added < days) {
    out += DAY_MS;
    if (!isWeekend(out)) added += 1;
  }
  return out;
}

function scheduleDelivery(w: World, orderId: Id, shippedMs: number, serviceName: string): void {
  const dayStart = Math.floor(shippedMs / DAY_MS) * DAY_MS;
  const at = addBusinessDays(dayStart, transitDaysOf(serviceName)) + (17 + (orderId.charCodeAt(0) % 4)) * HOUR_MS;
  w.queue.schedule(at, `deliver ${orderId}`, async () => await txAt(w.env, at, async (tx) => {
    const order = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1))[0];
    if (!order || order.status !== "Shipped") return;
    const status = stateMachines.shipmentOrder.transition(order.status, "Delivered");
    await tx.update(schema.shipmentOrders).set({ status, deliveredAt: isoOf(at), updatedBy: null }).where(eq(schema.shipmentOrders.id, orderId));
    await tx.update(schema.shipments).set({ deliveredAt: isoOf(at) }).where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.labelStatus, "Active")));
    await changeLog.recordUpdate(tx, { userId: null, source: "Integration" }, { entityType: "shipment_order", entityId: orderId, entityCode: order.code, before: { status: order.status }, after: { status } });
  }));
}

async function shipBatch(w: World, code: WarehouseCode, atMs: number): Promise<void> {
  const fac = facilityOf(w, code);
  const ctx = actor(operatorFor(w, code, 2));
  const ready = await txAt(w.env, atMs, async (tx) => await tx.select({ id: schema.shipmentOrders.id }).from(schema.shipmentOrders)
    .innerJoin(schema.shipments, and(eq(schema.shipments.orderId, schema.shipmentOrders.id), eq(schema.shipments.labelStatus, "Active"),
      eq(schema.shipments.labelType, "Shipping Label"), isNull(schema.shipments.actualShipmentAt)))
    .where(and(eq(schema.shipmentOrders.warehouseId, fac.id), eq(schema.shipmentOrders.status, "Ready to Ship"))));
  const ids = [...new Set(ready.map((r) => r.id))];
  if (ids.length === 0) return;
  const result = await txAt(w.env, atMs, async (tx) => await shipping.shipOrders(tx, ctx, { orderIds: ids, shipDate: isoOf(atMs) }));
  checkBulk(w, `ship ${code}`, result);
  for (const id of result.succeeded) {
    const svc = (await w.env.db.select({ name: schema.shipments.serviceName }).from(schema.shipments).where(and(eq(schema.shipments.orderId, id), eq(schema.shipments.labelStatus, "Active"))).limit(1))[0];
    scheduleDelivery(w, id, atMs, svc?.name ?? "Ground");
  }
  const closeAt = atMs + 3 * DAY_MS - 6 * HOUR_MS;
  w.queue.schedule(closeAt, `close EOD ${code}`, async () => await txAt(w.env, closeAt, async (tx) => {
    const manifests = (await tx.select().from(schema.endOfDayManifests).where(and(eq(schema.endOfDayManifests.warehouseId, fac.id), eq(schema.endOfDayManifests.status, "Open"))))
      .filter((m) => m.shipDate <= isoOf(atMs).slice(0, 10));
    for (const m of manifests) {
      await shipping.closeEndOfDay(tx, ctx, { manifestId: m.id });
      await tx.update(schema.endOfDayManifests).set({ isPrinted: true }).where(eq(schema.endOfDayManifests.id, m.id));
    }
  }));
}

/** Daily carrier pickups (Mon-Sat, 21:15 UTC) for both warehouses. */
export function scheduleCarrierPickups(w: World, days: number): number {
  let n = 0;
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo -= 1) {
    const at = utcAt(daysAgo, 21, 15);
    if (weekdayOf(at) === 0) continue;
    for (const code of ["MLT1", "KS2"] as const) {
      if (w.queue.schedule(at, `pickup ${code}`, async () => await shipBatch(w, code, at))) n += 1;
    }
  }
  return n;
}
