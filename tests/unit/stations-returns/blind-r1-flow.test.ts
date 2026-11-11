import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { editReturnInfo, editReturnInfoSchema, getReturnDetail, insertRma, type ScopedCtx } from "@/server/repositories/returns";
import { receiveManual, receiveManualSchema, receiveRma, receiveRmaSchema } from "@/server/repositories/returns-receive";
import { listHospitals, moveBackFromHospital } from "@/server/repositories/packing-hospitals";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";
import { hospitalOf } from "./hospital-fixture";

let w: World;
let ctx: ScopedCtx;
beforeEach(async () => { w = await createWorld(); ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" } } as ScopedCtx; });
afterEach(() => w.close());

async function shippedOrder(qty = 2): Promise<{ orderId: string; lineId: string }> {
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 5 });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  for (const [type, loc] of [["Picking", w.loc.pick], ["Packing", w.loc.pack]] as const) {
    const ids = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, type)))).map((t) => t.id);
    if (ids.length) await execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
  }
  await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
  const line = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1))[0];
  return { orderId: o.id, lineId: line?.id ?? "" };
}

describe("edit return info per RMA", () => {
  it("stores carrier, option, several tracking numbers and cost; refuses completed RMAs", async () => {
    const { orderId, lineId } = await shippedOrder(2);
    const rma = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    await editReturnInfo(w.db, ctx, rma.id, editReturnInfoSchema.parse({ carrierCode: "UPS", carrierServiceName: "Ground", shippingCost: 8.25, trackingNumbers: ["1Z1", "1Z2", "1Z3"] }));
    const d = await getReturnDetail(w.db, ctx.scope, rma.id);
    expect(d.carrierCode).toBe("UPS");
    expect(d.trackingNumbers).toEqual(["1Z1", "1Z2", "1Z3"]);
    expect(d.returnShippingCost).toBe(8.25);
    await expect(async () => await editReturnInfo(w.db, ctx, rma.id, editReturnInfoSchema.parse({ carrierCode: null, carrierServiceName: null, shippingCost: null, trackingNumbers: [], version: 1 }))).rejects.toThrow(/changed by someone else/);
    await receiveRma(w.db, ctx, receiveRmaSchema.parse({ returnOrderId: rma.id, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }] }));
    await expect(async () => await editReturnInfo(w.db, ctx, rma.id, editReturnInfoSchema.parse({ carrierCode: null, carrierServiceName: null, shippingCost: null, trackingNumbers: [] }))).rejects.toThrow(/completed/);
  });
});

describe("Return Process enforced at the station", () => {
  it("Return Manually against an order blocks more than shipped (rule on), allows it when switched off", async () => {
    const { orderId } = await shippedOrder(1);
    const body = () => receiveManualSchema.parse({ warehouseId: w.warehouseId, clientId: w.clientId, shipmentOrderId: orderId, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 2, disposition: "Restock" }] });
    await expect(async () => await receiveManual(w.db, ctx, body())).rejects.toThrow(/more can be returned|Prevent exceeding/);
    const defaults = ((await w.db.select().from(schema.companySettings).limit(1))[0]?.defaults ?? {}) as Record<string, unknown>;
    await w.db.update(schema.companySettings).set({ defaults: { ...defaults, returnRules: { preventExceedingShippedQty: false } } as never });
    expect((await receiveManual(w.db, ctx, body())).status).toBe("Completed");
  });
  it("blocks a SKU that was not shipped on the order", async () => {
    const { orderId } = await shippedOrder(1);
    await expect(async () => await receiveManual(w.db, ctx, receiveManualSchema.parse({ warehouseId: w.warehouseId, clientId: w.clientId, shipmentOrderId: orderId, stationLocationId: w.loc.returns,
      items: [{ productId: w.product2Id, quantity: 1, disposition: "Restock" }] }))).rejects.toThrow(/not shipped on the order/);
  });
});

describe("hospital locations", () => {
  it("lists stock in designated hospitals and moves free units back to storage", async () => {
    const hosp = await hospitalOf(w);
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: hosp, qty: 3 });
    const list = await listHospitals(w.db, ctx.scope, w.warehouseId);
    expect(list.map((h) => h.code)).toEqual(["HOSP-01"]);
    const ret = list.find((h) => h.code === "HOSP-01");
    expect(ret?.units).toBe(3);
    const row = ret?.stock[0];
    expect(row?.free).toBe(3);
    await expect(async () => await moveBackFromHospital(w.db, ctx, { inventoryId: row?.inventoryId ?? "", qty: 4, toLocationId: w.loc.storageA })).rejects.toThrow(/Max 3/);
    await expect(async () => await moveBackFromHospital(w.db, ctx, { inventoryId: row?.inventoryId ?? "", qty: 1, toLocationId: hosp })).rejects.toThrow(/not another hospital|Location/);
    expect((await moveBackFromHospital(w.db, ctx, { inventoryId: row?.inventoryId ?? "", qty: 2, toLocationId: w.loc.storageA })).moved).toBe(2);
    expect((await listHospitals(w.db, ctx.scope, w.warehouseId)).find((h) => h.code === "HOSP-01")?.units).toBe(1);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });
});
