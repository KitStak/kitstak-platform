/**
 * Round 6 (parity loop): count-plan locks surfaced before packing / receiving (pack context,
 * scan, List & Select, station pickers, receive refusal), the real RMA status transition in the
 * audit trail, the RMA-side change log for the return shipping cost, human validation copy,
 * the hospital warehouse default and Move back reason, and the station pick helpers.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { packContext } from "@/server/repositories/packing";
import { packLock, packLockMessage } from "@/server/repositories/packing-locks";
import { packingStations, readyToPackOrders, resolveScan } from "@/server/repositories/packing-scan";
import { hospitalWarehouses, moveBackSchema } from "@/server/repositories/packing-hospitals";
import { insertRma, recordReturnShippingCost, type ScopedCtx } from "@/server/repositories/returns";
import { openRmas, receiveManualSchema, receiveRma, receiveRmaSchema, returnStations, returnTargets } from "@/server/repositories/returns-receive";
import { pickStation } from "@/components/returns/return-station-model";
import { moveBackDisabledReason, pickHospitalWarehouse } from "@/components/packing/hospital-model";
import { returnCostError } from "@/components/returns/rma-form";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let ctx: ScopedCtx;
beforeEach(() => { w = createWorld(); ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" } } as ScopedCtx; });
afterEach(() => w.close());

function lock(locationId: string, code = "CNT-T1"): void {
  const plan = w.db.insert(schema.countPlans).values({ code, warehouseId: w.warehouseId, scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", status: "Ready To Count" }).returning().get();
  w.db.insert(schema.countPlanLines).values({ planId: plan.id, locationId }).run();
}

/** An order picked into TOTE-01 (Ready to Pack), not yet packed. */
function picked(qty = 2): string {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 2 });
  const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const ids = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, "Picking"))).all().map((t) => t.id);
  execute(w.db, w.ctx, { taskIds: ids, targetLocationId: w.loc.pick });
  return o.id;
}

function shipped(qty = 1): { orderId: string; lineId: string } {
  const orderId = picked(qty);
  const ids = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.taskType, "Packing"))).all().map((t) => t.id);
  execute(w.db, w.ctx, { taskIds: ids, targetLocationId: w.loc.pack });
  expect(shipOrders(w.db, w.ctx, { orderIds: [orderId], requireLabel: false }).failed).toEqual([]);
  const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get();
  return { orderId, lineId: line?.id ?? "" };
}

const statusLog = (entityId: string) => w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, entityId), eq(schema.changeLog.field, "status"))).all();

describe("count-plan locks are surfaced before packing", () => {
  it("pack context, scan and List & Select carry the lock of the staged stock", () => {
    const orderId = picked();
    expect(packContext(w.db, ctx.scope, orderId, w.loc.pack).countLock).toBeNull();
    lock(w.loc.pick);
    const c = packContext(w.db, ctx.scope, orderId, w.loc.pack);
    expect(c.countLock?.planCode).toBe("CNT-T1");
    expect(c.countLock?.locationCode).toBe("TOTE-01");
    expect(c.countLock?.planId).toBeTruthy();
    expect(c.countLock?.reason).toMatch(/picked stock is in TOTE-01, which is locked by count plan CNT-T1/);
    const code = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get()?.code ?? "";
    const scan = resolveScan(w.db, ctx.scope, { warehouseId: w.warehouseId, mode: "order", code, stationId: w.loc.pack });
    expect(scan.orders[0]?.countLock?.planCode).toBe("CNT-T1");
    const ready = readyToPackOrders(w.db, ctx.scope, { warehouseId: w.warehouseId, stationId: w.loc.pack });
    expect(ready.find((r) => r.id === orderId)?.countLock?.reason).toMatch(/CNT-T1/);
    // The KPI path skips the lock lookups.
    expect(readyToPackOrders(w.db, ctx.scope, { warehouseId: w.warehouseId }, { locks: false })[0]?.countLock).toBeNull();
  });

  it("a locked station is named as the station, and is marked in the station list", () => {
    const orderId = picked();
    lock(w.loc.pack, "CNT-ST");
    const l = packLock(w.db, orderId, w.loc.pack);
    expect(l?.locationCode).toBe("PACK-01");
    expect(packLockMessage("SO1", l!, w.loc.pack)).toMatch(/^Station PACK-01 is locked by count plan CNT-ST\. Pack SO1 at another station/);
    expect(packingStations(w.db, ctx.scope, w.warehouseId).find((s) => s.id === w.loc.pack)?.countLockPlan).toBe("CNT-ST");
    // Without the station, only the stock matters.
    expect(packLock(w.db, orderId, null)).toBeNull();
  });
});

describe("count-plan locks at the Return Station", () => {
  it("marks locked stations and targets, and sorts unlocked stations first", () => {
    lock(w.loc.returns, "CNT-R");
    const stations = returnStations(w.db, ctx.scope, w.warehouseId);
    expect(stations.find((s) => s.id === w.loc.returns)?.countLockPlan).toBe("CNT-R");
    expect(stations.find((s) => s.id === w.loc.returns)?.lockReason).toMatch(/Station RET-01 is locked by count plan CNT-R/);
    const targets = returnTargets(w.db, ctx.scope, { warehouseId: w.warehouseId, kind: "location", q: "RET" });
    expect(targets.find((t) => t.id === w.loc.returns)?.countLockPlan).toBe("CNT-R");
  });

  it("refuses a receive into a locked station before any ledger write, but allows an unlocked target", () => {
    const { orderId, lineId } = shipped(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    lock(w.loc.returns, "CNT-R");
    const receipts = () => w.db.select().from(schema.receipts).where(eq(schema.receipts.returnOrderId, rma.id)).all().length;
    const base = { returnOrderId: rma.id, stationLocationId: w.loc.returns, complete: false };
    expect(() => receiveRma(w.db, ctx, receiveRmaSchema.parse({ ...base, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] })))
      .toThrow(/Return station RET-01 is locked by count plan CNT-R/);
    expect(() => receiveRma(w.db, ctx, receiveRmaSchema.parse({ ...base, targetLocationId: w.loc.storageA, items: [{ productId: w.productId, quantity: 1, disposition: "Quarantine" }] })))
      .toThrow(/Return station RET-01 is locked/);
    expect(receipts()).toBe(0);
    // Restock into an unlocked storage target never touches the station.
    const ok = receiveRma(w.db, ctx, receiveRmaSchema.parse({ ...base, targetLocationId: w.loc.storageA, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
    expect(ok.receivedQty).toBe(1);
    // A locked target is refused with its own field.
    lock(w.loc.storageB, "CNT-T");
    try {
      receiveRma(w.db, ctx, receiveRmaSchema.parse({ ...base, targetLocationId: w.loc.storageB, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
      expect.unreachable();
    } catch (e) {
      expect((e as { details?: { fieldErrors?: Record<string, string[]> } }).details?.fieldErrors?.targetLocationId?.[0] ?? String(e)).toMatch(/A-02-01 is locked by count plan CNT-T/);
    }
  });
});

describe("RMA audit trail logs the real status transition", () => {
  it("Pending received in one go logs Pending --> Completed", () => {
    const { orderId, lineId } = shipped(1);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    receiveRma(w.db, ctx, receiveRmaSchema.parse({ returnOrderId: rma.id, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
    const rows = statusLog(rma.id);
    expect(rows.map((r) => `${r.fromValue} --> ${r.toValue}`)).toContain("Pending --> Completed");
    expect(rows.some((r) => r.fromValue === "Started")).toBe(false);
  });

  it("Save progress on a Pending RMA logs Pending --> Started", () => {
    const { orderId, lineId } = shipped(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    receiveRma(w.db, ctx, receiveRmaSchema.parse({ returnOrderId: rma.id, stationLocationId: w.loc.returns, complete: false, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
    expect(statusLog(rma.id).map((r) => `${r.fromValue} --> ${r.toValue}`)).toEqual(["Pending --> Started"]);
  });

  it("the return shipping cost is logged on the RMA too when it is stored on the order", () => {
    const { orderId, lineId } = shipped(1);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    recordReturnShippingCost(w.db, ctx, { id: rma.id, rmaCode: rma.rmaCode, shipmentOrderId: orderId }, 0);
    const rows = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, rma.id), eq(schema.changeLog.field, "returnShippingCost"))).all();
    expect(rows).toHaveLength(1);
  });

  it("open RMAs list for the station", () => {
    const { orderId, lineId } = shipped(1);
    insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const open = openRmas(w.db, ctx.scope, w.warehouseId);
    expect(open.total).toBe(1);
    expect(open.rows[0]?.requestedQty).toBe(1);
  });
});

describe("validation copy", () => {
  it("names the missing station and client instead of zod's raw text", () => {
    const r = receiveManualSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(msgs).toContain("stationLocationId: Choose a return station");
    expect(msgs).toContain("clientId: Choose a client");
    expect(msgs.join(" ")).not.toMatch(/expected string/);
    const m = moveBackSchema.safeParse({});
    expect(m.success ? [] : m.error.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Choose the hospital stock to move", "Enter a quantity", "Choose a location"]));
  });

  it("return shipping cost", () => {
    expect(returnCostError(-5)).toBe("Cost can't be negative");
    expect(returnCostError(0)).toBeNull();
    expect(returnCostError(null)).toBeNull();
    expect(returnCostError(200_000)).toBe("Check the cost");
  });
});

describe("station and hospital pick helpers", () => {
  it("pickStation skips a locked remembered station", () => {
    const opts = [{ id: "a", countLockPlan: "CNT1" }, { id: "b", countLockPlan: null }];
    expect(pickStation(opts, "a")?.id).toBe("b");
    expect(pickStation(opts, "b")?.id).toBe("b");
    expect(pickStation([{ id: "a", countLockPlan: "CNT1" }], "a")?.id).toBe("a");
  });

  it("pickHospitalWarehouse prefers a remembered warehouse with hospitals, else the one with most units", () => {
    const whs = [{ id: "KS" }, { id: "MLT1" }, { id: "KS2" }];
    const summary = [{ warehouseId: "KS", hospitals: 0, units: 0 }, { warehouseId: "MLT1", hospitals: 1, units: 3 }, { warehouseId: "KS2", hospitals: 0, units: 0 }];
    expect(pickHospitalWarehouse(whs, ["KS", null], summary)).toBe("MLT1");
    expect(pickHospitalWarehouse(whs, ["KS2", "MLT1"], summary)).toBe("MLT1");
    expect(pickHospitalWarehouse(whs, ["KS"], [])).toBe("KS");
    expect(pickHospitalWarehouse(whs, ["KS"], null)).toBe("KS");
  });

  it("hospitalWarehouses counts hospitals per warehouse", () => {
    const rows = hospitalWarehouses(w.db, ctx.scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.warehouseId).toBe(w.warehouseId);
  });

  it("Move back reason names the pack-short order", () => {
    expect(moveBackDisabledReason({ free: 0, orders: [{ code: "SO010927", packShortStatus: "Open" }] }, true))
      .toBe("All units are held for SO010927 (pack short). Resolve the pack short on the order first.");
    expect(moveBackDisabledReason({ free: 2, orders: [] }, true)).toBeNull();
    expect(moveBackDisabledReason({ free: 2, orders: [] }, false)).toMatch(/Execute Task/);
  });
});
