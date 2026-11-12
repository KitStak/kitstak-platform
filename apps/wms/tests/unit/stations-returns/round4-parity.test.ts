/** Round 4 (parity loop): explicit hospital designation, hospital move-back audit + damaged guard. */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { hospitalOptions, packContext, reportIssue } from "@/server/repositories/packing";
import { hospitalDesignation, listHospitals, moveBackBlockReason, moveBackFromHospital, moveBackTargets } from "@/server/repositories/packing-hospitals";
import { editReturnInfo, editReturnInfoSchema, getReturnDetail, insertRma, rmaExtraColumns, type ScopedCtx } from "@/server/repositories/returns";
import { listReturnLines } from "@/server/repositories/returns-grid";
import { lookupRmas } from "@/server/repositories/returns-receive";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";
import { hospitalOf } from "./hospital-fixture";
import { withWriteTx } from "@/server/db/sql";

let w: World;
let ctx: ScopedCtx;
beforeEach(async () => { w = await createWorld(); ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" } } as ScopedCtx; });
afterEach(() => w.close());

async function pickedOrder(qty = 2): Promise<string> {
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 3 });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const picks = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, "Picking")))).map((t) => t.id);
  await execute(w.db, w.ctx, { taskIds: picks, targetLocationId: w.loc.pick });
  return o.id;
}

describe("hospital designation (no Returns-bin fallback)", () => {
  it("a warehouse with only Return Station bins has no hospital, and Report Issue refuses a Returns bin", async () => {
    expect(await listHospitals(w.db, ctx.scope, w.warehouseId)).toEqual([]);
    expect(await hospitalOptions(w.db, ctx.scope, w.warehouseId)).toEqual([]);
    const id = await pickedOrder(1);
    expect((await packContext(w.db, ctx.scope, id)).hospital).toBeNull();
    await expect(async () => await withWriteTx(w.db, async (tx) => await reportIssue(tx, ctx, { orderId: id, hospitalLocationId: w.loc.returns, note: "crushed" }))).rejects.toThrow(/not a hospital location/);
  });

  it("the Location Group \"Hospital\" designates a hospital and wins the default over a HOSP* code", async () => {
    await hospitalOf(w, "HOSP-09");
    const group = (await w.db.insert(schema.lookupValues).values({ type: "location_group", name: "Hospital", warehouseId: w.warehouseId }).returning())[0];
    const zone = await hospitalOf(w, "QC-HOLD", { locationGroupId: group.id });
    const opts = await hospitalOptions(w.db, ctx.scope, w.warehouseId);
    expect(opts.map((o) => o.code)).toEqual(["QC-HOLD", "HOSP-09"]);
    expect(opts[0]).toMatchObject({ id: zone, isDefault: true });
    expect(opts[0]?.detail).toMatch(/Hospital group/);
    expect(hospitalDesignation({ code: "HOSP-1", locationType: "Shelves", groupName: "Hospital" })).toBe("group");
    // An inactive group no longer designates.
    await w.db.update(schema.lookupValues).set({ isActive: false }).where(eq(schema.lookupValues.id, group.id));
    expect((await hospitalOptions(w.db, ctx.scope, w.warehouseId)).map((o) => o.code)).toEqual(["HOSP-09"]);
  });

  it("Report Issue to a HOSP location holds the stock there; the hospital page shows the pack-short order", async () => {
    const hosp = await hospitalOf(w);
    const id = await pickedOrder(2);
    const c = await packContext(w.db, ctx.scope, id);
    expect(c.hospital?.code).toBe("HOSP-01");
    await withWriteTx(w.db, async (tx) => await reportIssue(tx, ctx, { orderId: id, hospitalLocationId: hosp, note: "Box crushed" }));
    const h = (await listHospitals(w.db, ctx.scope, w.warehouseId))[0];
    expect(h?.units).toBe(2);
    expect(h?.heldForOrders).toBe(1);
    expect(h?.stock[0]?.free).toBe(0);
    expect(h?.stock[0]?.orders[0]?.packShortStatus).toBe("Open");
    await expect(async () => await moveBackFromHospital(w.db, ctx, { inventoryId: h?.stock[0]?.inventoryId ?? "", qty: 1, toLocationId: w.loc.storageA })).rejects.toThrow(/held for a pack-short order/);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });
});

describe("hospital move back", () => {
  it("writes change-log rows on both locations", async () => {
    const hosp = await hospitalOf(w);
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: hosp, qty: 3 });
    const inv = (await listHospitals(w.db, ctx.scope, w.warehouseId))[0]?.stock[0];
    await moveBackFromHospital(w.db, ctx, { inventoryId: inv?.inventoryId ?? "", qty: 2, toLocationId: w.loc.storageA, note: "checked OK" });
    const rows = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityType, "inventory"));
    const msgs = rows.map((r) => `${r.parentEntityId === hosp ? "from" : "to"}: ${r.message}`).sort();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatch(/^from: .+ -> .+ is modified\. 3 --> 1$/);
    expect(msgs[1]).toMatch(/^to: .+ is modified\. 0 --> 2$/);
    const txn = (await w.db.select().from(schema.inventoryTransactions)).find((t) => (t.note ?? "").includes("Hospital move back"));
    expect(txn?.note).toMatch(/HOSP-01 to A-01-01: checked OK/);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("damaged stock may go to Storage but not to a Picking location; non-storage targets are refused", async () => {
    const hosp = await hospitalOf(w);
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: hosp, qty: 2, damageReason: "Crushed" });
    const inv = (await listHospitals(w.db, ctx.scope, w.warehouseId))[0]?.stock[0];
    expect(inv?.damageReason).toBe("Crushed");
    await expect(async () => await moveBackFromHospital(w.db, ctx, { inventoryId: inv?.inventoryId ?? "", qty: 1, toLocationId: w.loc.storageB })).rejects.toThrow(/Damaged/);
    await expect(async () => await moveBackFromHospital(w.db, ctx, { inventoryId: inv?.inventoryId ?? "", qty: 1, toLocationId: w.loc.returns })).rejects.toThrow(/Storage or Picking/);
    expect((await moveBackFromHospital(w.db, ctx, { inventoryId: inv?.inventoryId ?? "", qty: 1, toLocationId: w.loc.storageA })).toCode).toBe("A-01-01");
    expect(moveBackBlockReason({ damageReason: null }, { areaType: "Picking" })).toBeNull();
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("targets exclude hospitals and carry the area type", async () => {
    await hospitalOf(w, "HOSP-02", { areaType: "Storage" });
    const t = await moveBackTargets(w.db, ctx.scope, w.warehouseId, "");
    expect(t.some((x) => x.code.startsWith("HOSP"))).toBe(false);
    expect(t.find((x) => x.code === "A-02-01")?.areaType).toBe("Picking");
  });
});

describe("per-RMA return cost and tracking numbers (R3-1)", () => {
  async function shippedOrder(qty = 2): Promise<{ orderId: string; lineId: string }> {
    const id = await pickedOrder(qty);
    const pack = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.orderId, id), eq(schema.tasks.taskType, "Packing")))).map((t) => t.id);
    if (pack.length) await execute(w.db, w.ctx, { taskIds: pack, targetLocationId: w.loc.pack });
    await shipOrders(w.db, w.ctx, { orderIds: [id], requireLabel: false });
    const line = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, id)).limit(1))[0];
    return { orderId: id, lineId: line?.id ?? "" };
  }

  it("with the per-RMA columns, two RMAs on one order keep their own cost and tracking list", async () => {
    // The columns ship in migration 0003 (foundation round 2, R4-1).
    expect(await rmaExtraColumns(w.db)).toMatchObject({ cost: true, tracking: true });
    const { orderId, lineId } = await shippedOrder(2);
    const a = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }], returnInfo: { carrierCode: "UPS", carrierServiceName: "Ground", shippingCost: 5, trackingNumbers: ["1ZA1", "1ZA2"] } });
    const b = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }], returnInfo: { carrierCode: "UPS", carrierServiceName: "Ground", shippingCost: 9.5, trackingNumbers: ["1ZB1"] } });
    expect(await getReturnDetail(w.db, ctx.scope, a.id)).toMatchObject({ returnShippingCost: 5, trackingNumbers: ["1ZA1", "1ZA2"] });
    expect(await getReturnDetail(w.db, ctx.scope, b.id)).toMatchObject({ returnShippingCost: 9.5, trackingNumbers: ["1ZB1"] });
    await editReturnInfo(w.db, ctx, a.id, editReturnInfoSchema.parse({ carrierCode: "UPS", carrierServiceName: "Ground", shippingCost: 6.25, trackingNumbers: ["1ZA3"] }));
    expect(await getReturnDetail(w.db, ctx.scope, a.id)).toMatchObject({ returnShippingCost: 6.25, trackingNumbers: ["1ZA3"] });
    expect((await getReturnDetail(w.db, ctx.scope, b.id)).returnShippingCost).toBe(9.5);
    const log = await w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, a.id), eq(schema.changeLog.field, "returnShippingCost")));
    expect(log.map((r) => `${r.fromValue}->${r.toValue}`)).toEqual(["->5", "5->6.25"]);
  });

  it("stores a single RMA's cost and tracking list on the RMA row (migration 0003 columns)", async () => {
    // The pre-migration fallback (shipment order Return section) can no longer be reached: the
    // drizzle schema now writes these columns on every insert.
    expect(await rmaExtraColumns(w.db)).toMatchObject({ cost: true, tracking: true });
    const { orderId, lineId } = await shippedOrder(1);
    const a = await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }], returnInfo: { carrierCode: null, carrierServiceName: null, shippingCost: 4, trackingNumbers: ["T1", "T2"] } });
    expect(await getReturnDetail(w.db, ctx.scope, a.id)).toMatchObject({ returnShippingCost: 4, trackingNumbers: ["T1", "T2"] });
  });

  it("exact tracking search and filters match each of several tracking numbers", async () => {
    const { orderId, lineId } = await shippedOrder(1);
    await insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }], returnInfo: { carrierCode: null, carrierServiceName: null, shippingCost: null, trackingNumbers: ["1ZRET0001", "1ZRET0002"] } });
    const q = async (extra: Partial<typeof EMPTY_GRID_QUERY>) => (await listReturnLines(w.db, ctx.scope, { ...EMPTY_GRID_QUERY, ...extra })).total;
    expect(await q({ q: "1zret0002", qm: "eq" })).toBe(1);
    expect(await q({ q: "1ZRET0002", qm: "sw" })).toBe(1);
    expect(await q({ q: "1ZRET000", qm: "eq" })).toBe(0);
    expect(await q({ filters: [{ field: "trackingNumber", op: "eq", value: "1ZRET0001" }] })).toBe(1);
    expect(await q({ filters: [{ field: "trackingNumber", op: "in", values: ["NOPE", "1ZRET0002"] }] })).toBe(1);
    expect(await q({ filters: [{ field: "trackingNumber", op: "nin", values: ["1ZRET0002"] }] })).toBe(0);
    expect(await lookupRmas(w.db, ctx.scope, w.warehouseId, "1zret0002")).toHaveLength(1);
  });
});
