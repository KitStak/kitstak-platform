/** Shipment-order commands, products, workflows engine, notifications. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { notify } from "@/server/domain/notify";
import {
  cancelOrders, changeWarehouse, createBackorder, createOrder, deleteOrders, holdOrders, releaseOrders, unmergeOrder, updateOrder,
} from "@/server/domain/orders";
import { createProduct, ensureProductForListing } from "@/server/domain/products";
import { runWorkflows } from "@/server/domain/workflows";
import { createWorld, orderInput, type World } from "./fixtures";

let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());

const mkOrder = async (qty = 2, extra: Record<string, unknown> = {}) => await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }], extra));
const row = async (id: string) => (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
const stock = async (qty: number) => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });

describe("createOrder", () => {
  it("validates, generates codes, verifies addresses and computes totals", async () => {
    const o = await mkOrder(3, { shipAddress2: "Suite 5" });
    expect(o).toMatchObject({ code: "SO000001", status: "Open", totalQuantity: 3, totalWeightOz: 24, salesPrice: 30, shipAddress: "200 Oak Ave Suite 5", shipAddress2: null });
    expect(o.addressVerificationNotes).toContain("Address line 2 was merged into address line 1.");
    const skip = await mkOrder(1, { skipAddressVerification: true, code: "MANUAL-1" });
    expect(skip).toMatchObject({ code: "MANUAL-1", addressVerificationStatus: "Skipped" });
    await expect(async () => await mkOrder(1, { code: "MANUAL-1" })).rejects.toThrow(/already exists/);
    await expect(async () => await createOrder(w.db, w.ctx, { ...orderInput(w, [{ productId: w.productId, quantity: 1 }]), clientId: w.otherClientId })).rejects.toThrow(/another client/);
    await expect(async () => await createOrder(w.db, w.ctx, orderInput(w, [{ productId: "nope", quantity: 1 }]))).rejects.toThrow(/does not exist/);
    await expect(async () => await createOrder(w.db, w.ctx, orderInput(w, []))).rejects.toThrow(/At least one line/);
    await expect(async () => await createOrder(w.db, w.ctx, { ...orderInput(w, [{ productId: w.productId, quantity: 1 }]), warehouseId: "x" })).rejects.toThrow(/Warehouse not found/);
    expect((await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, o.id)).limit(1))[0]?.message).toBe("Shipment Order SO000001 is created.");
  });
});

describe("updateOrder", () => {
  it("diffs header changes, re-verifies the address and checks the version", async () => {
    const o = await mkOrder();
    const u = await updateOrder(w.db, w.ctx, { id: o.id, version: o.version, patch: { shipCity: "Hot Springs", priority: "High" } });
    expect(u.version).toBe(o.version + 1);
    const msgs = (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, o.id))).map((c) => c.message);
    expect(msgs).toEqual(expect.arrayContaining(["City is modified. Little Rock --> Hot Springs", "Priority is modified. None --> High"]));
    await expect(async () => await updateOrder(w.db, w.ctx, { id: o.id, version: o.version, patch: { note: "x" } })).rejects.toThrow(/changed since/);
  });

  it("replaces lines while unallocated and locks them afterwards", async () => {
    const o = await mkOrder(2);
    const line = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1))[0];
    const u = await updateOrder(w.db, w.ctx, { id: o.id, version: o.version, lines: [{ id: line?.id, productId: w.productId, quantity: 5 }, { productId: w.product2Id, quantity: 1 }] });
    expect(u.totalQuantity).toBe(6);
    const lineMsgs = (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, o.id))).map((c) => c.message);
    // createOrder logs one entry per line (orders-outbound REQ-2), then the replacement entries.
    expect(lineMsgs).toEqual(["MLT-WIDGET-01 -> Shipment Order Line is created.", "MLT-WIDGET-01 -> Quantity is modified. 2 --> 5", "MLT-GADGET-02 -> Quantity is modified. 0 --> 1"]);
    const u2 = await updateOrder(w.db, w.ctx, { id: o.id, version: u.version, lines: [{ productId: w.productId, quantity: 1 }] });
    expect(await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id))).toHaveLength(1);
    await stock(5);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const fresh = await row(o.id);
    await expect(async () => await updateOrder(w.db, w.ctx, { id: o.id, version: fresh?.version ?? 0, lines: [{ productId: w.productId, quantity: 2 }] })).rejects.toThrow(/Ready to Pick/);
    await expect(async () => await updateOrder(w.db, w.ctx, { id: o.id, version: u2.version, lines: [{ id: "bogus", productId: w.productId, quantity: 2 }] })).rejects.toThrow();
  });

  it("only allows notes on terminal orders", async () => {
    const o = await mkOrder();
    await cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "r" });
    const c = await row(o.id);
    await expect(async () => await updateOrder(w.db, w.ctx, { id: o.id, version: c?.version ?? 0, patch: { shipCity: "X" } })).rejects.toThrow(/Only notes/);
    expect((await updateOrder(w.db, w.ctx, { id: o.id, version: c?.version ?? 0, patch: { note: "late" } })).note).toBe("late");
  });
});

describe("status commands", () => {
  it("cancels with a reason and deallocates", async () => {
    await stock(5);
    const o = await mkOrder();
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    await expect(async () => await cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "" })).rejects.toThrow(/reason/);
    expect((await cancelOrders(w.db, w.ctx, { ids: [o.id, "nope"], reasonId: "r1", note: "dup" })).succeeded).toEqual([o.id]);
    expect(await row(o.id)).toMatchObject({ status: "Cancelled", cancelReasonId: "r1" });
    expect((await row(o.id))?.note).not.toBe("dup");
    expect((await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1))[0]).toMatchObject({ allocatedQuantity: 0, cancelledQuantity: 2 });
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses to cancel orders in jobs", async () => {
    await stock(5);
    const o = await mkOrder();
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    expect((await cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "r" })).failed[0].message).toMatch(/in a job/);
    expect((await deleteOrders(w.db, w.ctx, { ids: [o.id] })).failed[0].message).toMatch(/Only Open/);
  });

  it("holds and releases to the previous status", async () => {
    await stock(5);
    const o = await mkOrder();
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    await holdOrders(w.db, w.ctx, { ids: [o.id] });
    expect((await row(o.id))?.status).toBe("On Hold");
    await releaseOrders(w.db, w.ctx, { ids: [o.id] });
    expect((await row(o.id))?.status).toBe("Ready to Pick");
    expect((await releaseOrders(w.db, w.ctx, { ids: [o.id] })).failed[0].message).toMatch(/not on hold/);
  });

  it("changes warehouse, deallocating first", async () => {
    await stock(1);
    const o = await mkOrder(2);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: "partial" });
    const wh2 = (await w.db.insert(schema.warehouses).values({ code: "W2", name: "W2", addressLine: "a", city: "c", state: "TN" }).returning())[0];
    expect((await changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: wh2.id })).succeeded).toEqual([o.id]);
    expect(await row(o.id)).toMatchObject({ warehouseId: wh2.id, status: "Open" });
    expect((await changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: wh2.id })).failed[0].message).toMatch(/already/);
    await expect(async () => await changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: "nope" })).rejects.toThrow(/Warehouse/);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("creates a back order from the unallocated remainder", async () => {
    await stock(2);
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 5 }, { productId: w.product2Id, quantity: 1 }]));
    await expect(async () => await createBackorder(w.db, w.ctx, { orderId: o.id })).rejects.toThrow(/Only Shortage/);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: "partial" });
    const child = await createBackorder(w.db, w.ctx, { orderId: o.id });
    expect(child).toMatchObject({ code: "SO000001-BO1", isBackOrder: true, masterOrderId: o.id, status: "Open", totalQuantity: 4 });
    expect((await row(o.id))?.status).toBe("Ready to Pick");
    const parentLines = await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id));
    expect(parentLines.map((l) => l.quantity)).toEqual([2]);
    expect((await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, child.id))).map((l) => l.quantity).sort()).toEqual([1, 3]);
    const none = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [none.id], warehouseId: w.warehouseId });
    await expect(async () => await createBackorder(w.db, w.ctx, { orderId: none.id })).rejects.toThrow(/Nothing is allocated/);
  });

  it("soft-deletes open orders and hides them", async () => {
    const o = await mkOrder();
    expect((await deleteOrders(w.db, w.ctx, { ids: [o.id] })).succeeded).toEqual([o.id]);
    expect((await row(o.id))?.deletedAt).not.toBeNull();
    expect((await deleteOrders(w.db, w.ctx, { ids: [o.id] })).failed[0].code).toBe("NOT_FOUND");
  });

  it("unmerges a merged order", async () => {
    const master = await mkOrder(1);
    const child = await mkOrder(2);
    await w.db.update(schema.shipmentOrders).set({ isMerged: true }).where(eq(schema.shipmentOrders.id, master.id));
    await holdOrders(w.db, w.ctx, { ids: [child.id] });
    await w.db.update(schema.shipmentOrders).set({ mergedIntoOrderId: master.id }).where(eq(schema.shipmentOrders.id, child.id));
    await w.db.insert(schema.orderLines).values({ orderId: master.id, productId: w.productId, quantity: 2, unitPrice: 1, originalOrderCode: child.code });
    expect((await unmergeOrder(w.db, w.ctx, { orderId: master.id })).restored).toEqual([child.id]);
    expect(await row(child.id)).toMatchObject({ status: "Open", mergedIntoOrderId: null });
    expect((await row(master.id))?.isMerged).toBe(false);
    expect(await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, master.id))).toHaveLength(1);
    await expect(async () => await unmergeOrder(w.db, w.ctx, { orderId: master.id })).rejects.toThrow(/not a merged/);
  });
});

describe("products", () => {
  it("creates products with a primary pack type and barcode", async () => {
    const p = await createProduct(w.db, w.ctx, { clientId: w.clientId, sku: "NEW-1", name: "New" });
    expect(p).toMatchObject({ barcode: "NEW-1", status: "Active", uom: "Each" });
    expect((await w.db.select().from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, p.id)).limit(1))[0]?.kind).toBe("Primary");
    await expect(async () => await createProduct(w.db, w.ctx, { clientId: w.clientId, sku: "NEW-1", name: "Dup" })).rejects.toThrow(/already exists/);
    await expect(async () => await createProduct(w.db, w.ctx, { clientId: "x", sku: "Z", name: "z" })).rejects.toThrow(/Client not found/);
    expect((await ensureProductForListing(w.db, w.ctx, { clientId: w.clientId, sellerSku: "NEW-1", name: "x" })).created).toBe(false);
    expect((await ensureProductForListing(w.db, w.ctx, { clientId: w.clientId, sellerSku: "NEW-2", name: "x", price: 3 })).created).toBe(true);
  });
});

describe("workflows", () => {
  it("evaluates in sequence, honours stop-processing and records runs", async () => {
    const add = async (name: string, sequence: number, extra: Partial<typeof schema.workflows.$inferInsert> = {}) => (await w.db.insert(schema.workflows).values({
      name, trigger: "Shipment Order Created", sequence, actions: [{ action: "Set Priority", params: { priority: "High" } }], ...extra,
    }).returning())[0];
    const first = await add("Big orders", 1, { conditions: [{ field: "orderQuantity", comparator: "gte", value: 5 }], stopProcessing: true });
    await add("Everything", 2, { actions: [{ action: "Add Note", params: {} }] });
    await add("Other warehouse", 3, { warehouseId: "other" });
    const big = await mkOrder(5);
    const runs = await w.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.entityId, big.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ workflowId: first.id, matched: true, error: null }); // M12 registered the Set Priority executor
    const small = await mkOrder(1);
    const summary = await runWorkflows(w.db, w.ctx, "Shipment Order Created", { type: "shipment_order", id: small.id }, {
      executors: {
        "Add Note": () => ({ applied: true }),
        "Set Priority": () => { throw new Error("bad"); },
      },
    });
    expect(summary.map((s) => [s.name, s.matched, s.actionsApplied])).toEqual([["Big orders", false, []], ["Everything", true, ["Add Note"]]]);
    const blocked = await runWorkflows(w.db, w.ctx, "Shipment Order Created", { type: "shipment_order", id: big.id }, {
      executors: { "Set Priority": () => ({ applied: true, blockType: "Partially" }) },
    });
    expect(blocked[0]).toMatchObject({ blockType: "Partially", actionsApplied: ["Set Priority"] });
    expect((await w.db.select().from(schema.workflows).where(eq(schema.workflows.id, first.id)).limit(1))[0]?.runCount).toBe(2);
    const po = (await w.db.insert(schema.purchaseOrders).values({ code: "PO9", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status: "Pending", totalQuantity: 1, purchasePrice: 1 }).returning())[0];
    expect(await runWorkflows(w.db, w.ctx, "Purchase Order Created", { type: "purchase_order", id: po.id })).toEqual([]);
    await expect(async () => await runWorkflows(w.db, w.ctx, "Order Shipped", { type: "shipment_order", id: "x" })).rejects.toThrow(/not found/);
  });
});

describe("notify", () => {
  it("notifies users and roles", async () => {
    const viewer = (await w.db.insert(schema.users).values({ email: "v@x.io", name: "V", passwordHash: "x", role: "viewer" }).returning())[0];
    const role = (await w.db.insert(schema.roles).values({ key: "supervisor", name: "Supervisor" }).returning())[0];
    await w.db.insert(schema.userRoles).values({ userId: viewer.id, roleId: role.id });
    expect(await notify(w.db, [w.userId, w.userId, "ghost"], { kind: "wave.completed", title: "Wave done", href: "/jobs" })).toBe(1);
    expect(await notify(w.db, { roleKey: "supervisor" }, { kind: "k", title: "t" })).toBe(1);
    expect(await notify(w.db, { roleKey: "admin" }, { kind: "k", title: "t", severity: "warning" })).toBe(1);
    expect(await notify(w.db, { roleKey: "nobody" }, { kind: "k", title: "t" })).toBe(0);
    expect(await notify(w.db, [], { kind: "k", title: "t" })).toBe(0);
    await expect(async () => await notify(w.db, [w.userId], { kind: "k", title: "t", href: "https://evil" })).rejects.toThrow();
    expect(await w.db.select().from(schema.notifications)).toHaveLength(3);
  });
});
