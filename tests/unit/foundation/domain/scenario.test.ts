/**
 * BUILD_PLAN F8.6 scenario: receive 10, put away, allocate 4, pick, pack, label, ship 4,
 * return 1, adjust -1, count to 5 — with ledger reconciliation after every step.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { ledger } from "@/server/domain/ledger";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { createOrder } from "@/server/domain/orders";
import { suggestLocations } from "@/server/domain/putaway";
import { createLabel, shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { createWorld, onHand, orderInput, type World } from "./fixtures";

let w: World;
const state: { poId?: string; orderId?: string; jobId?: string; storageBucket?: string } = {};

function reconciled(): void {
  expect(ledger.reconcileLedger(w.db)).toEqual([]);
}

function order() {
  return w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, state.orderId as string)).get();
}

beforeAll(() => {
  w = createWorld();
});
afterAll(() => w.close());

describe("F8.6 end-to-end ledger scenario", () => {
  it("receives 10 against a PO", () => {
    const po = w.db.insert(schema.purchaseOrders).values({
      code: "PO000001", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "Vendor", status: "Pending", totalQuantity: 10, purchasePrice: 50,
    }).returning().get();
    const line = w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId: w.productId, orderedQuantity: 10, unitCost: 5 }).returning().get();
    state.poId = po.id;
    const { receipt } = w.db.transaction((tx) => ledger.recordReceipt(tx, w.ctx, {
      type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 10,
      locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id, lotNumber: "LOT-A", expiryDate: "2027-12-31",
    }));
    expect(receipt.masterId).toBe(1);
    expect(onHand(w, w.productId)).toBe(10);
    const after = w.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id)).get();
    expect(after?.status).toBe("Receiving");
    expect(after?.receivedQuantity).toBe(10);
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, po.id)).all();
    expect(log.map((l) => l.message)).toContain("MLT-WIDGET-01 -> Received Qty is modified. 0 --> 10");
    reconciled();
  });

  it("puts the receipt away at the suggested location", () => {
    const suggestion = suggestLocations(w.db, { warehouseId: w.warehouseId, productId: w.productId, qty: 10, isReceiving: true, fromLocationId: w.loc.receiving, lot: "LOT-A" });
    expect(suggestion.rule).toBe("Default Empty Location");
    const target = suggestion.suggestions[0];
    expect(target.code).toBe("A-01-01");
    const bucket = w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.receiving)).get();
    const moved = w.db.transaction((tx) => ledger.move(tx, w.ctx, { inventoryId: bucket?.id as string, qty: 10, toLocationId: target.locationId }));
    state.storageBucket = moved.target.id;
    expect(moved.source.onHand).toBe(0);
    expect(moved.target.onHand).toBe(10);
    expect(moved.target.lotNumber).toBe("LOT-A");
    reconciled();
  });

  it("allocates 4 to a new order", () => {
    const o = w.db.transaction((tx) => createOrder(tx, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }])));
    state.orderId = o.id;
    expect(o.code).toBe("SO000001");
    expect(o.shipState).toBe("AR");
    expect(o.shipCountry).toBe("United States");
    expect(o.addressVerificationStatus).toBe("Verified");
    const r = w.db.transaction((tx) => allocateOrders(tx, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId }));
    expect(r.allocated).toEqual([o.id]);
    expect(order()?.status).toBe("Ready to Pick");
    const bucket = w.db.select().from(schema.inventory).where(eq(schema.inventory.id, state.storageBucket as string)).get();
    expect(bucket?.allocated).toBe(4);
    reconciled();
  });

  it("creates a job and picks", () => {
    const res = w.db.transaction((tx) => createJobsFromOrders(tx, w.ctx, { orderIds: [state.orderId as string], jobTypeId: w.jobTypeId }));
    expect(res.jobIds).toHaveLength(1);
    state.jobId = res.jobIds[0];
    const job = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, state.jobId)).get();
    expect(job?.code).toBe("Job000001");
    expect(job?.taskCount).toBe(2);
    const pickTask = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, state.jobId), eq(schema.tasks.taskType, "Picking"))).get();
    w.db.transaction((tx) => execute(tx, w.ctx, { taskIds: [pickTask?.id as string], targetLocationId: w.loc.pick }));
    expect(order()?.status).toBe("Ready to Pack");
    const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, state.orderId as string)).get();
    expect(line?.pickedQuantity).toBe(4);
    reconciled();
  });

  it("packs", () => {
    const packTask = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, state.jobId as string), eq(schema.tasks.taskType, "Packing"))).get();
    w.db.transaction((tx) => execute(tx, w.ctx, { taskIds: [packTask?.id as string], targetLocationId: w.loc.pack }));
    expect(order()?.status).toBe("Ready to Ship");
    const job = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, state.jobId as string)).get();
    expect(job?.status).toBe("Completed");
    const packed = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, w.loc.pack), eq(schema.inventory.status, "Packed"))).get();
    expect(packed?.onHand).toBe(4);
    expect(packed?.allocated).toBe(4);
    reconciled();
  });

  it("creates a sandbox label with a real PDF", async () => {
    const res = await createLabel(w.db, w.ctx, {
      orderId: state.orderId as string, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground,
      packages: [{ weightOz: 32, length: 10, width: 8, height: 4 }],
    }, { files: w.files });
    expect(res.masterTrackingNumber).toMatch(/^1Z[0-9A-Z]{16}$/);
    const file = w.db.select().from(schema.files).where(eq(schema.files.id, res.shipments[0].labelFileId as string)).get();
    expect(file?.mime).toBe("application/pdf");
    const bytes = fs.readFileSync(path.join(w.filesRoot, file?.id as string));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(order()?.trackingNumber).toBe(res.masterTrackingNumber);
    reconciled();
  });

  it("ships 4", () => {
    const r = w.db.transaction((tx) => shipOrders(tx, w.ctx, { orderIds: [state.orderId as string] }));
    expect(r.failed).toEqual([]);
    expect(order()?.status).toBe("Shipped");
    expect(onHand(w, w.productId)).toBe(6);
    const eod = w.db.select().from(schema.endOfDayManifests).all();
    expect(eod).toHaveLength(1);
    expect(eod[0].totalPackages).toBe(1);
    reconciled();
  });

  it("receives a return of 1 back into storage", () => {
    const ro = w.db.insert(schema.returnOrders).values({ rmaCode: "RMA000001", shipmentOrderId: state.orderId, warehouseId: w.warehouseId, clientId: w.clientId }).returning().get();
    w.db.transaction((tx) => ledger.recordReceipt(tx, w.ctx, {
      type: "Return", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 1, locationId: w.loc.storageA,
      returnOrderId: ro.id, lotNumber: "LOT-A", expiryDate: "2027-12-31",
    }));
    expect(onHand(w, w.productId)).toBe(7);
    const txn = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.type, "Return Receiving")).all();
    expect(txn).toHaveLength(1);
    reconciled();
  });

  it("adjusts -1", () => {
    const bucket = w.db.select().from(schema.inventory).where(eq(schema.inventory.id, state.storageBucket as string)).get();
    expect(bucket?.onHand).toBe(7);
    const r = w.db.transaction((tx) => ledger.adjustTo(tx, w.ctx, { inventoryId: bucket?.id as string, targetQty: 6 }));
    expect(r.txn?.uomQty).toBe(-1);
    expect(onHand(w, w.productId)).toBe(6);
    reconciled();
  });

  it("counts to 5", () => {
    const r = w.db.transaction((tx) => ledger.adjustTo(tx, w.ctx, { inventoryId: state.storageBucket as string, targetQty: 5, type: "Count" }));
    expect(r.txn?.type).toBe("Count");
    expect(onHand(w, w.productId)).toBe(5);
    reconciled();
    const types = w.db.select({ type: schema.inventoryTransactions.type }).from(schema.inventoryTransactions).orderBy(schema.inventoryTransactions.seq).all().map((t) => t.type);
    expect(types).toEqual(["Receiving", "Inventory Movement", "Allocation", "Picking", "Packing", "Shipment", "Return Receiving", "Inventory Adjustment", "Count"]);
  });
});
