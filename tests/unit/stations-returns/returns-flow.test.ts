/** M04 returns against an in-memory migrated DB: Create RMA caps, receive at station (Restock / Damaged / Dispose), roll-up, status guards, manual RMA, grid. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { changeReturnStatus, getReturnDetail, insertRma, selectionTransitions, shippableOrder, transitionOptions, type ScopedCtx } from "@/server/repositories/returns";
import { listReturnLines, returnStatusCounts } from "@/server/repositories/returns-grid";
import { searchShippedOrders } from "@/server/repositories/returns-search";
import { lookupRmas, receiveManual, receiveRma, receiveRmaSchema, receiveManualSchema, returnStations, returnTargets } from "@/server/repositories/returns-receive";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let ctx: ScopedCtx;

beforeEach(() => {
  w = createWorld();
  ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" } } as ScopedCtx;
});
afterEach(() => w.close());

const orderRow = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();

/** Order of `qty` units taken through pick → pack → ship (no label). */
function shippedOrder(qty = 2): { orderId: string; lineId: string } {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 5 });
  const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  for (const [type, loc] of [["Picking", w.loc.pick], ["Packing", w.loc.pack]] as const) {
    const ids = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, type))).all().map((t) => t.id);
    if (ids.length) execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
  }
  const r = shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
  expect(r.failed).toEqual([]);
  const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get();
  return { orderId: o.id, lineId: line?.id ?? "" };
}

const restock = (returnOrderId: string, quantity: number, extra: Record<string, unknown> = {}) =>
  receiveRmaSchema.parse({ returnOrderId, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity, disposition: "Restock", ...extra }] });

describe("shipped order search", () => {
  it("finds shipped orders by code, customer and returnable units, scoped and escaped", () => {
    const { orderId, lineId } = shippedOrder(2);
    const code = orderRow(orderId)?.code as string;
    const hit = searchShippedOrders(w.db, ctx.scope, { q: code.toLowerCase() });
    expect(hit.map((h) => h.id)).toEqual([orderId]);
    expect(hit[0]).toMatchObject({ shippedUnits: 2, returnableUnits: 2, status: "Shipped" });
    expect(searchShippedOrders(w.db, ctx.scope, { q: "jane" }).map((h) => h.id)).toContain(orderId);
    expect(searchShippedOrders(w.db, ctx.scope, { q: "100%_" })).toEqual([]);
    insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    expect(searchShippedOrders(w.db, ctx.scope, { q: code })[0]?.returnableUnits).toBe(0);
    expect(searchShippedOrders(w.db, { warehouseIds: [], clientIds: "all" } as unknown as ScopedCtx["scope"], {})).toEqual([]);
  });
});

describe("create RMA", () => {
  it("caps quantity at shipped minus already returned and starts Pending", () => {
    const { orderId, lineId } = shippedOrder(2);
    expect(orderRow(orderId)?.status).toBe("Shipped");
    const before = shippableOrder(w.db, ctx.scope, orderId);
    expect(before.eligible).toBe(true);
    expect(before.lines[0]?.returnable).toBe(2);
    expect(() => insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 3 }] })).toThrow(/Max 2/);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const detail = getReturnDetail(w.db, ctx.scope, rma.id);
    expect(detail.status).toBe("Pending");
    expect(detail.requestedQty).toBe(1);
    expect(shippableOrder(w.db, ctx.scope, orderId).lines[0]?.returnable).toBe(1);
    expect(w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, rma.id)).all().length).toBeGreaterThan(0);
  });

  it("refuses orders that are not shipped", () => {
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    expect(shippableOrder(w.db, ctx.scope, o.id).eligible).toBe(false);
    const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get();
    expect(() => insertRma(w.db, ctx, { shipmentOrderId: o.id, lines: [{ orderLineId: line?.id ?? "", quantity: 1 }] })).toThrow(/Only shipped orders/);
  });

  it("hides orders outside the caller's client scope", () => {
    const { orderId } = shippedOrder(1);
    expect(() => shippableOrder(w.db, { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] }, orderId)).toThrow();
  });
});

describe("return station receiving", () => {
  it("receives 1 of 1 as Restock into the target: receipt Return, ledger Return Receiving, RMA Completed", () => {
    const { orderId, lineId } = shippedOrder(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const found = lookupRmas(w.db, ctx.scope, w.warehouseId, rma.rmaCode);
    expect(found[0]?.receivable).toBe(true);
    expect(lookupRmas(w.db, ctx.scope, w.warehouseId, orderRow(orderId)?.code ?? "")[0]?.id).toBe(rma.id);
    const res = receiveRma(w.db, ctx, { ...restock(rma.id, 1), targetLocationId: w.loc.storageA });
    expect(res.status).toBe("Completed");
    const receipt = w.db.select().from(schema.receipts).where(eq(schema.receipts.returnOrderId, rma.id)).get();
    expect(receipt?.type).toBe("Return");
    expect(receipt?.locationId).toBe(w.loc.storageA);
    const txns = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.type, "Return Receiving")).all();
    expect(txns.length).toBe(1);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
    const detail = getReturnDetail(w.db, ctx.scope, rma.id);
    expect(detail.lines[0]?.returnedQty).toBe(1);
    expect(detail.actualReturnDate).not.toBeNull();
  });

  it("blocks over-receiving and requires a damage reason for Damaged", () => {
    const { orderId, lineId } = shippedOrder(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    expect(() => receiveRma(w.db, ctx, restock(rma.id, 2))).toThrow(/Max 1 left/);
    expect(() => receiveRma(w.db, ctx, restock(rma.id, 1, { disposition: "Damaged" }))).toThrow(/damage reason/);
  });

  it("partial receive without complete keeps the RMA Started; Dispose writes the stock off", () => {
    const { orderId, lineId } = shippedOrder(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    const before = ledger.reconcileLedger(w.db);
    const r1 = receiveRma(w.db, ctx, { ...restock(rma.id, 1, { disposition: "Dispose" }), complete: false });
    expect(r1.status).toBe("Started");
    expect(before).toEqual([]);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
    const atStation = w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.returns)).all().reduce((s, r) => s + r.onHand, 0);
    expect(atStation).toBe(0);
    const r2 = receiveRma(w.db, ctx, restock(rma.id, 1));
    expect(r2.status).toBe("Completed");
  });

  it("a Cancelled RMA can't be received", () => {
    const { orderId, lineId } = shippedOrder(1);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const res = changeReturnStatus(w.db, ctx, { ids: [rma.id], status: "Cancelled" });
    expect(res.succeeded).toEqual([rma.id]);
    expect(() => receiveRma(w.db, ctx, restock(rma.id, 1))).toThrow(/can't be received/);
    expect(lookupRmas(w.db, ctx.scope, w.warehouseId, rma.rmaCode)[0]?.receivable).toBe(false);
    // Cancelled RMAs free their quantity for a new return.
    expect(shippableOrder(w.db, ctx.scope, orderId).lines[0]?.returnable).toBe(1);
  });

  it("Return Manually creates a Manual RMA and receives it", () => {
    const res = receiveManual(w.db, ctx, receiveManualSchema.parse({
      warehouseId: w.warehouseId, clientId: w.clientId, stationLocationId: w.loc.returns, customerName: "Walk-in",
      items: [{ productId: w.productId, quantity: 2, disposition: "Quarantine" }],
    }));
    expect(res.status).toBe("Completed");
    const detail = getReturnDetail(w.db, ctx.scope, res.returnOrderId);
    expect(detail.source).toBe("Manual");
    expect(detail.receivedQty).toBe(2);
    expect(() => receiveManual(w.db, ctx, receiveManualSchema.parse({
      warehouseId: w.warehouseId, clientId: w.otherClientId, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }],
    }))).toThrow(/another client/);
  });

  it("lists Returns-area stations and target candidates", () => {
    expect(returnStations(w.db, ctx.scope, w.warehouseId).map((s) => s.code)).toEqual(["RET-01"]);
    const targets = returnTargets(w.db, ctx.scope, { warehouseId: w.warehouseId, kind: "location", q: "" });
    expect(targets[0]?.code).toBe("RET-01");
    expect(() => returnStations(w.db, { warehouseIds: [], clientIds: "all" }, w.warehouseId)).toThrow(/not found/);
  });
});

describe("status transitions", () => {
  it("offers only legal moves", () => {
    const pending = transitionOptions("Pending", 0);
    expect(pending.find((o) => o.status === "Cancelled")?.ok).toBe(true);
    expect(pending.find((o) => o.status === "Completed")?.ok).toBe(false);
    expect(transitionOptions("Completed", 1).every((o) => !o.ok)).toBe(true);
    expect(transitionOptions("Started", 1).find((o) => o.status === "Cancelled")?.ok).toBe(false);
  });

  it("bulk change reports per-id failures and selection eligibility", () => {
    const a = shippedOrder(1);
    const ra = insertRma(w.db, ctx, { shipmentOrderId: a.orderId, lines: [{ orderLineId: a.lineId, quantity: 1 }] });
    receiveRma(w.db, ctx, restock(ra.id, 1));
    const b = shippedOrder(1);
    const rb = insertRma(w.db, ctx, { shipmentOrderId: b.orderId, lines: [{ orderLineId: b.lineId, quantity: 1 }] });
    const sel = selectionTransitions(w.db, ctx.scope, [ra.id, rb.id]);
    expect(sel.options.find((o) => o.status === "In Transit")?.eligible).toBe(1);
    const res = changeReturnStatus(w.db, ctx, { ids: [ra.id, rb.id], status: "In Transit" });
    expect(res.succeeded).toEqual([rb.id]);
    expect(res.failed[0]?.id).toBe(ra.id);
    expect(returnStatusCounts(w.db, ctx.scope)).toMatchObject({ Completed: 1, "In Transit": 1 });
  });
});

describe("return orders grid", () => {
  it("lists one row per RMA line with search, filters and sort", () => {
    const { orderId, lineId } = shippedOrder(1);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const all = listReturnLines(w.db, ctx.scope, EMPTY_GRID_QUERY);
    expect(all.total).toBe(1);
    expect(all.rows[0]?.rmaCode).toBe(rma.rmaCode);
    expect(listReturnLines(w.db, ctx.scope, { ...EMPTY_GRID_QUERY, q: rma.rmaCode, qm: "eq" }).total).toBe(1);
    expect(listReturnLines(w.db, ctx.scope, { ...EMPTY_GRID_QUERY, filters: [{ field: "status", op: "in", values: ["Completed"] }] }).total).toBe(0);
    expect(listReturnLines(w.db, ctx.scope, { ...EMPTY_GRID_QUERY, sort: [{ field: "rmaCode", dir: "asc" }] }).total).toBe(1);
    expect(() => listReturnLines(w.db, ctx.scope, { ...EMPTY_GRID_QUERY, sort: [{ field: "nope", dir: "asc" }] })).toThrow(/Cannot sort/);
    expect(listReturnLines(w.db, { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] }, EMPTY_GRID_QUERY).total).toBe(0);
  });
});
