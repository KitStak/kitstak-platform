/** M04 Returns: Create RMA (cap, label), Return Station receive (Restock / Damaged), Manual RMA, Change Status guards. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import {
  changeReturnStatus, createRma, getReturnDetail, selectionTransitions, shippableOrder, transitionOptions,
} from "@/server/repositories/returns";
import { listReturnLines, returnStatusCounts } from "@/server/repositories/returns-grid";
import { lookupRmas, receiveManual, receiveManualSchema, receiveRma, receiveRmaSchema, returnStations } from "@/server/repositories/returns-receive";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let scope: Scope;
const previousFilesDir = process.env.KITSTAK_FILES_DIR;

beforeEach(() => {
  w = createWorld();
  process.env.KITSTAK_FILES_DIR = w.filesRoot;
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
});
afterEach(() => {
  w.close();
  process.env.KITSTAK_FILES_DIR = previousFilesDir;
});

const ctx = () => ({ ...w.ctx, scope });
const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };
const rma = (id: string) => w.db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, id)).get();
const onHandAt = (locationId: string) => w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, locationId)).all().reduce((s, r) => s + r.onHand, 0);

/** An order of `qty` units taken all the way to Shipped. */
function shippedOrder(qty = 2): { orderId: string; lineId: string } {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 3 });
  const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all();
  execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Picking").map((t) => t.id), targetLocationId: w.loc.pick });
  execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Packing").map((t) => t.id), targetLocationId: w.loc.pack });
  const shipped = shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
  expect(shipped.failed).toEqual([]);
  const lineId = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get()?.id as string;
  return { orderId: o.id, lineId };
}

async function newRma(orderId: string, lineId: string, quantity = 1, withLabel = false) {
  return createRma(w.db, ctx(), {
    shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity }], expectedReturnDate: "2026-11-20",
    label: withLabel ? { carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, package: pkg } : null,
  });
}

describe("transition guards", () => {
  it("only offers legal moves", () => {
    const ok = (s: Parameters<typeof transitionOptions>[0], received: number) => transitionOptions(s, received).filter((o) => o.ok).map((o) => o.status);
    expect(ok("Pending", 0)).toEqual(["Started", "In Transit", "Cancelled"]);
    expect(ok("Pending", 0)).not.toContain("Completed");
    expect(ok("Completed", 1)).toEqual([]);
    expect(ok("Cancelled", 0)).toEqual([]);
    expect(ok("Started", 1)).toContain("Completed");
    expect(ok("Started", 1)).not.toContain("Cancelled");
  });
});

describe("create RMA", () => {
  it("caps quantity at shipped minus already returned and buys a return label", async () => {
    const { orderId, lineId } = shippedOrder(2);
    const shippable = shippableOrder(w.db, scope, orderId);
    expect(shippable.lines[0]?.returnable).toBe(2);
    await expect(newRma(orderId, lineId, 3)).rejects.toThrow(/Max 2/);
    const created = await newRma(orderId, lineId, 1, true);
    expect(created.status).toBe("Pending");
    expect(created.labelError).toBeNull();
    expect(created.trackingNumber).toBeTruthy();
    expect(shippableOrder(w.db, scope, orderId).lines[0]?.returnable).toBe(1);
    const rows = listReturnLines(w.db, scope, EMPTY_GRID_QUERY).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("Pending");
    expect(returnStatusCounts(w.db, scope).Pending).toBe(1);
    expect(getReturnDetail(w.db, scope, created.id).rmaCode).toBe(created.rmaCode);
  });

  it("refuses an order that has not shipped", async () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 3 });
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const lineId = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get()?.id as string;
    await expect(newRma(o.id, lineId)).rejects.toThrow();
  });
});

describe("return station", () => {
  it("receives 1 unit as Restock into the target: receipt, ledger Return Receiving, Completed", async () => {
    const { orderId, lineId } = shippedOrder(2);
    const created = await newRma(orderId, lineId, 1);
    expect(returnStations(w.db, scope, w.warehouseId).map((s) => s.code)).toContain("RET-01");
    expect(lookupRmas(w.db, scope, w.warehouseId, created.rmaCode)[0]?.receivable).toBe(true);
    const line = w.db.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.returnOrderId, created.id)).get();
    const before = onHandAt(w.loc.storageB);
    const res = w.db.transaction((tx) => receiveRma(tx, ctx(), receiveRmaSchema.parse({
      returnOrderId: created.id, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB,
      items: [{ returnOrderLineId: line?.id, productId: w.productId, quantity: 1, disposition: "Restock" }],
    })));
    expect(res.status).toBe("Completed");
    expect(onHandAt(w.loc.storageB)).toBe(before + 1);
    const receipts = w.db.select().from(schema.receipts).where(eq(schema.receipts.returnOrderId, created.id)).all();
    expect(receipts.map((r) => r.type)).toEqual(["Return"]);
    const txns = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.returnOrderId, created.id)).all();
    expect(txns.map((t) => t.type)).toContain("Return Receiving");
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
    // fully received: nothing left
    expect(() => w.db.transaction((tx) => receiveRma(tx, ctx(), receiveRmaSchema.parse({
      returnOrderId: created.id, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB,
      items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }],
    })))).toThrow();
  });

  it("requires a damage reason for Damaged and refuses a Cancelled RMA", async () => {
    const { orderId, lineId } = shippedOrder(2);
    const created = await newRma(orderId, lineId, 1);
    const body = { returnOrderId: created.id, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB };
    expect(() => w.db.transaction((tx) => receiveRma(tx, ctx(), receiveRmaSchema.parse({
      ...body, items: [{ productId: w.productId, quantity: 1, disposition: "Damaged" }],
    })))).toThrow(/damage reason/);
    const cancel = w.db.transaction((tx) => changeReturnStatus(tx, ctx(), { ids: [created.id], status: "Cancelled" }));
    expect(cancel.succeeded).toEqual([created.id]);
    expect(rma(created.id)?.status).toBe("Cancelled");
    expect(() => w.db.transaction((tx) => receiveRma(tx, ctx(), receiveRmaSchema.parse({
      ...body, items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }],
    })))).toThrow(/cancelled and can't be received/);
    const illegal = w.db.transaction((tx) => changeReturnStatus(tx, ctx(), { ids: [created.id], status: "Pending" }));
    expect(illegal.failed[0]?.code).toBe("INVALID_STATE");
    expect(selectionTransitions(w.db, scope, [created.id]).options.every((o) => !o.ok)).toBe(true);
  });

  it("Return Manually creates a Manual RMA and posts the receipt", () => {
    const res = w.db.transaction((tx) => receiveManual(tx, ctx(), receiveManualSchema.parse({
      warehouseId: w.warehouseId, clientId: w.clientId, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB,
      customerName: "Walk-in", items: [{ productId: w.productId, quantity: 2, disposition: "Restock" }],
    })));
    expect(res.status).toBe("Completed");
    expect(rma(res.returnOrderId)?.source).toBe("Manual");
    expect(onHandAt(w.loc.storageB)).toBe(2);
    expect(() => w.db.transaction((tx) => receiveManual(tx, ctx(), receiveManualSchema.parse({
      warehouseId: w.warehouseId, clientId: w.otherClientId, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB,
      items: [{ productId: w.productId, quantity: 1, disposition: "Restock" }],
    })))).toThrow(/another client/);
  });
});
