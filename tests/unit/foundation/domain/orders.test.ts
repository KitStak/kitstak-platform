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
beforeEach(() => { w = createWorld(); });
afterEach(() => w.close());

const mkOrder = (qty = 2, extra: Record<string, unknown> = {}) => createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }], extra));
const row = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
const stock = (qty: number) => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });

describe("createOrder", () => {
  it("validates, generates codes, verifies addresses and computes totals", () => {
    const o = mkOrder(3, { shipAddress2: "Suite 5" });
    expect(o).toMatchObject({ code: "SO000001", status: "Open", totalQuantity: 3, totalWeightOz: 24, salesPrice: 30, shipAddress: "200 Oak Ave Suite 5", shipAddress2: null });
    expect(o.addressVerificationNotes).toContain("Address line 2 was merged into address line 1.");
    const skip = mkOrder(1, { skipAddressVerification: true, code: "MANUAL-1" });
    expect(skip).toMatchObject({ code: "MANUAL-1", addressVerificationStatus: "Skipped" });
    expect(() => mkOrder(1, { code: "MANUAL-1" })).toThrow(/already exists/);
    expect(() => createOrder(w.db, w.ctx, { ...orderInput(w, [{ productId: w.productId, quantity: 1 }]), clientId: w.otherClientId })).toThrow(/another client/);
    expect(() => createOrder(w.db, w.ctx, orderInput(w, [{ productId: "nope", quantity: 1 }]))).toThrow(/does not exist/);
    expect(() => createOrder(w.db, w.ctx, orderInput(w, []))).toThrow(/At least one line/);
    expect(() => createOrder(w.db, w.ctx, { ...orderInput(w, [{ productId: w.productId, quantity: 1 }]), warehouseId: "x" })).toThrow(/Warehouse not found/);
    expect(w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, o.id)).get()?.message).toBe("Shipment Order SO000001 is created.");
  });
});

describe("updateOrder", () => {
  it("diffs header changes, re-verifies the address and checks the version", () => {
    const o = mkOrder();
    const u = updateOrder(w.db, w.ctx, { id: o.id, version: o.version, patch: { shipCity: "Hot Springs", priority: "High" } });
    expect(u.version).toBe(o.version + 1);
    const msgs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, o.id)).all().map((c) => c.message);
    expect(msgs).toEqual(expect.arrayContaining(["City is modified. Little Rock --> Hot Springs", "Priority is modified. None --> High"]));
    expect(() => updateOrder(w.db, w.ctx, { id: o.id, version: o.version, patch: { note: "x" } })).toThrow(/changed since/);
  });

  it("replaces lines while unallocated and locks them afterwards", () => {
    const o = mkOrder(2);
    const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get();
    const u = updateOrder(w.db, w.ctx, { id: o.id, version: o.version, lines: [{ id: line?.id, productId: w.productId, quantity: 5 }, { productId: w.product2Id, quantity: 1 }] });
    expect(u.totalQuantity).toBe(6);
    const lineMsgs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, o.id)).all().map((c) => c.message);
    // createOrder logs one entry per line (orders-outbound REQ-2), then the replacement entries.
    expect(lineMsgs).toEqual(["MLT-WIDGET-01 -> Shipment Order Line is created.", "MLT-WIDGET-01 -> Quantity is modified. 2 --> 5", "MLT-GADGET-02 -> Quantity is modified. 0 --> 1"]);
    const u2 = updateOrder(w.db, w.ctx, { id: o.id, version: u.version, lines: [{ productId: w.productId, quantity: 1 }] });
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).all()).toHaveLength(1);
    stock(5);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const fresh = row(o.id);
    expect(() => updateOrder(w.db, w.ctx, { id: o.id, version: fresh?.version ?? 0, lines: [{ productId: w.productId, quantity: 2 }] })).toThrow(/Ready to Pick/);
    expect(() => updateOrder(w.db, w.ctx, { id: o.id, version: u2.version, lines: [{ id: "bogus", productId: w.productId, quantity: 2 }] })).toThrow();
  });

  it("only allows notes on terminal orders", () => {
    const o = mkOrder();
    cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "r" });
    const c = row(o.id);
    expect(() => updateOrder(w.db, w.ctx, { id: o.id, version: c?.version ?? 0, patch: { shipCity: "X" } })).toThrow(/Only notes/);
    expect(updateOrder(w.db, w.ctx, { id: o.id, version: c?.version ?? 0, patch: { note: "late" } }).note).toBe("late");
  });
});

describe("status commands", () => {
  it("cancels with a reason and deallocates", () => {
    stock(5);
    const o = mkOrder();
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect(() => cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "" })).toThrow(/reason/);
    expect(cancelOrders(w.db, w.ctx, { ids: [o.id, "nope"], reasonId: "r1", note: "dup" }).succeeded).toEqual([o.id]);
    expect(row(o.id)).toMatchObject({ status: "Cancelled", cancelReasonId: "r1" });
    expect(row(o.id)?.note).not.toBe("dup");
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get()).toMatchObject({ allocatedQuantity: 0, cancelledQuantity: 2 });
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses to cancel orders in jobs", () => {
    stock(5);
    const o = mkOrder();
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    expect(cancelOrders(w.db, w.ctx, { ids: [o.id], reasonId: "r" }).failed[0].message).toMatch(/in a job/);
    expect(deleteOrders(w.db, w.ctx, { ids: [o.id] }).failed[0].message).toMatch(/Only Open/);
  });

  it("holds and releases to the previous status", () => {
    stock(5);
    const o = mkOrder();
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    holdOrders(w.db, w.ctx, { ids: [o.id] });
    expect(row(o.id)?.status).toBe("On Hold");
    releaseOrders(w.db, w.ctx, { ids: [o.id] });
    expect(row(o.id)?.status).toBe("Ready to Pick");
    expect(releaseOrders(w.db, w.ctx, { ids: [o.id] }).failed[0].message).toMatch(/not on hold/);
  });

  it("changes warehouse, deallocating first", () => {
    stock(1);
    const o = mkOrder(2);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: "partial" });
    const wh2 = w.db.insert(schema.warehouses).values({ code: "W2", name: "W2", addressLine: "a", city: "c", state: "TN" }).returning().get();
    expect(changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: wh2.id }).succeeded).toEqual([o.id]);
    expect(row(o.id)).toMatchObject({ warehouseId: wh2.id, status: "Open" });
    expect(changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: wh2.id }).failed[0].message).toMatch(/already/);
    expect(() => changeWarehouse(w.db, w.ctx, { ids: [o.id], warehouseId: "nope" })).toThrow(/Warehouse/);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("creates a back order from the unallocated remainder", () => {
    stock(2);
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 5 }, { productId: w.product2Id, quantity: 1 }]));
    expect(() => createBackorder(w.db, w.ctx, { orderId: o.id })).toThrow(/Only Shortage/);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: "partial" });
    const child = createBackorder(w.db, w.ctx, { orderId: o.id });
    expect(child).toMatchObject({ code: "SO000001-BO1", isBackOrder: true, masterOrderId: o.id, status: "Open", totalQuantity: 4 });
    expect(row(o.id)?.status).toBe("Ready to Pick");
    const parentLines = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).all();
    expect(parentLines.map((l) => l.quantity)).toEqual([2]);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, child.id)).all().map((l) => l.quantity).sort()).toEqual([1, 3]);
    const none = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }]));
    allocateOrders(w.db, w.ctx, { orderIds: [none.id], warehouseId: w.warehouseId });
    expect(() => createBackorder(w.db, w.ctx, { orderId: none.id })).toThrow(/Nothing is allocated/);
  });

  it("soft-deletes open orders and hides them", () => {
    const o = mkOrder();
    expect(deleteOrders(w.db, w.ctx, { ids: [o.id] }).succeeded).toEqual([o.id]);
    expect(row(o.id)?.deletedAt).not.toBeNull();
    expect(deleteOrders(w.db, w.ctx, { ids: [o.id] }).failed[0].code).toBe("NOT_FOUND");
  });

  it("unmerges a merged order", () => {
    const master = mkOrder(1);
    const child = mkOrder(2);
    w.db.update(schema.shipmentOrders).set({ isMerged: true }).where(eq(schema.shipmentOrders.id, master.id)).run();
    holdOrders(w.db, w.ctx, { ids: [child.id] });
    w.db.update(schema.shipmentOrders).set({ mergedIntoOrderId: master.id }).where(eq(schema.shipmentOrders.id, child.id)).run();
    w.db.insert(schema.orderLines).values({ orderId: master.id, productId: w.productId, quantity: 2, unitPrice: 1, originalOrderCode: child.code }).run();
    expect(unmergeOrder(w.db, w.ctx, { orderId: master.id }).restored).toEqual([child.id]);
    expect(row(child.id)).toMatchObject({ status: "Open", mergedIntoOrderId: null });
    expect(row(master.id)?.isMerged).toBe(false);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, master.id)).all()).toHaveLength(1);
    expect(() => unmergeOrder(w.db, w.ctx, { orderId: master.id })).toThrow(/not a merged/);
  });
});

describe("products", () => {
  it("creates products with a primary pack type and barcode", () => {
    const p = createProduct(w.db, w.ctx, { clientId: w.clientId, sku: "NEW-1", name: "New" });
    expect(p).toMatchObject({ barcode: "NEW-1", status: "Active", uom: "Each" });
    expect(w.db.select().from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, p.id)).get()?.kind).toBe("Primary");
    expect(() => createProduct(w.db, w.ctx, { clientId: w.clientId, sku: "NEW-1", name: "Dup" })).toThrow(/already exists/);
    expect(() => createProduct(w.db, w.ctx, { clientId: "x", sku: "Z", name: "z" })).toThrow(/Client not found/);
    expect(ensureProductForListing(w.db, w.ctx, { clientId: w.clientId, sellerSku: "NEW-1", name: "x" }).created).toBe(false);
    expect(ensureProductForListing(w.db, w.ctx, { clientId: w.clientId, sellerSku: "NEW-2", name: "x", price: 3 }).created).toBe(true);
  });
});

describe("workflows", () => {
  it("evaluates in sequence, honours stop-processing and records runs", () => {
    const add = (name: string, sequence: number, extra: Partial<typeof schema.workflows.$inferInsert> = {}) => w.db.insert(schema.workflows).values({
      name, trigger: "Shipment Order Created", sequence, actions: [{ action: "Set Priority", params: { priority: "High" } }], ...extra,
    }).returning().get();
    const first = add("Big orders", 1, { conditions: [{ field: "orderQuantity", comparator: "gte", value: 5 }], stopProcessing: true });
    add("Everything", 2, { actions: [{ action: "Add Note", params: {} }] });
    add("Other warehouse", 3, { warehouseId: "other" });
    const big = mkOrder(5);
    const runs = w.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.entityId, big.id)).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ workflowId: first.id, matched: true, error: null }); // M12 registered the Set Priority executor
    const small = mkOrder(1);
    const summary = runWorkflows(w.db, w.ctx, "Shipment Order Created", { type: "shipment_order", id: small.id }, {
      executors: {
        "Add Note": () => ({ applied: true }),
        "Set Priority": () => { throw new Error("bad"); },
      },
    });
    expect(summary.map((s) => [s.name, s.matched, s.actionsApplied])).toEqual([["Big orders", false, []], ["Everything", true, ["Add Note"]]]);
    const blocked = runWorkflows(w.db, w.ctx, "Shipment Order Created", { type: "shipment_order", id: big.id }, {
      executors: { "Set Priority": () => ({ applied: true, blockType: "Partially" }) },
    });
    expect(blocked[0]).toMatchObject({ blockType: "Partially", actionsApplied: ["Set Priority"] });
    expect(w.db.select().from(schema.workflows).where(eq(schema.workflows.id, first.id)).get()?.runCount).toBe(2);
    const po = w.db.insert(schema.purchaseOrders).values({ code: "PO9", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status: "Pending", totalQuantity: 1, purchasePrice: 1 }).returning().get();
    expect(runWorkflows(w.db, w.ctx, "Purchase Order Created", { type: "purchase_order", id: po.id })).toEqual([]);
    expect(() => runWorkflows(w.db, w.ctx, "Order Shipped", { type: "shipment_order", id: "x" })).toThrow(/not found/);
  });
});

describe("notify", () => {
  it("notifies users and roles", () => {
    const viewer = w.db.insert(schema.users).values({ email: "v@x.io", name: "V", passwordHash: "x", role: "viewer" }).returning().get();
    const role = w.db.insert(schema.roles).values({ key: "supervisor", name: "Supervisor" }).returning().get();
    w.db.insert(schema.userRoles).values({ userId: viewer.id, roleId: role.id }).run();
    expect(notify(w.db, [w.userId, w.userId, "ghost"], { kind: "wave.completed", title: "Wave done", href: "/jobs" })).toBe(1);
    expect(notify(w.db, { roleKey: "supervisor" }, { kind: "k", title: "t" })).toBe(1);
    expect(notify(w.db, { roleKey: "admin" }, { kind: "k", title: "t", severity: "warning" })).toBe(1);
    expect(notify(w.db, { roleKey: "nobody" }, { kind: "k", title: "t" })).toBe(0);
    expect(notify(w.db, [], { kind: "k", title: "t" })).toBe(0);
    expect(() => notify(w.db, [w.userId], { kind: "k", title: "t", href: "https://evil" })).toThrow();
    expect(w.db.select().from(schema.notifications).all()).toHaveLength(3);
  });
});
