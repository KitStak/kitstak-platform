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
import { withWriteTx } from "@/server/db/sql";

let w: World;
const state: { poId?: string; orderId?: string; jobId?: string; storageBucket?: string } = {};

async function reconciled(): Promise<void> {
  expect(await ledger.reconcileLedger(w.db)).toEqual([]);
}

async function order() {
  return (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, state.orderId as string)).limit(1))[0];
}

beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe("F8.6 end-to-end ledger scenario", () => {
  it("receives 10 against a PO", async () => {
    const po = (await w.db.insert(schema.purchaseOrders).values({
      code: "PO000001", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "Vendor", status: "Pending", totalQuantity: 10, purchasePrice: 50,
    }).returning())[0];
    const line = (await w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId: w.productId, orderedQuantity: 10, unitCost: 5 }).returning())[0];
    state.poId = po.id;
    const { receipt } = await withWriteTx(w.db, async (tx) => await ledger.recordReceipt(tx, w.ctx, {
      type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 10,
      locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id, lotNumber: "LOT-A", expiryDate: "2027-12-31",
    }));
    expect(receipt.masterId).toBe(1);
    expect(await onHand(w, w.productId)).toBe(10);
    const after = (await w.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id)).limit(1))[0];
    expect(after?.status).toBe("Receiving");
    expect(after?.receivedQuantity).toBe(10);
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, po.id));
    expect(log.map((l) => l.message)).toContain("MLT-WIDGET-01 -> Received Qty is modified. 0 --> 10");
    await reconciled();
  });

  it("puts the receipt away at the suggested location", async () => {
    const suggestion = await suggestLocations(w.db, { warehouseId: w.warehouseId, productId: w.productId, qty: 10, isReceiving: true, fromLocationId: w.loc.receiving, lot: "LOT-A" });
    expect(suggestion.rule).toBe("Default Empty Location");
    const target = suggestion.suggestions[0];
    expect(target.code).toBe("A-01-01");
    const bucket = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.receiving)).limit(1))[0];
    const moved = await withWriteTx(w.db, async (tx) => await ledger.move(tx, w.ctx, { inventoryId: bucket?.id as string, qty: 10, toLocationId: target.locationId }));
    state.storageBucket = moved.target.id;
    expect(moved.source.onHand).toBe(0);
    expect(moved.target.onHand).toBe(10);
    expect(moved.target.lotNumber).toBe("LOT-A");
    await reconciled();
  });

  it("allocates 4 to a new order", async () => {
    const o = await withWriteTx(w.db, async (tx) => await createOrder(tx, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }])));
    state.orderId = o.id;
    expect(o.code).toBe("SO000001");
    expect(o.shipState).toBe("AR");
    expect(o.shipCountry).toBe("United States");
    expect(o.addressVerificationStatus).toBe("Verified");
    const r = await withWriteTx(w.db, async (tx) => await allocateOrders(tx, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId }));
    expect(r.allocated).toEqual([o.id]);
    expect((await order())?.status).toBe("Ready to Pick");
    const bucket = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, state.storageBucket as string)).limit(1))[0];
    expect(bucket?.allocated).toBe(4);
    await reconciled();
  });

  it("creates a job and picks", async () => {
    const res = await withWriteTx(w.db, async (tx) => await createJobsFromOrders(tx, w.ctx, { orderIds: [state.orderId as string], jobTypeId: w.jobTypeId }));
    expect(res.jobIds).toHaveLength(1);
    state.jobId = res.jobIds[0];
    const job = (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, state.jobId)).limit(1))[0];
    expect(job?.code).toBe("Job000001");
    expect(job?.taskCount).toBe(2);
    const pickTask = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, state.jobId), eq(schema.tasks.taskType, "Picking"))).limit(1))[0];
    await withWriteTx(w.db, async (tx) => await execute(tx, w.ctx, { taskIds: [pickTask?.id as string], targetLocationId: w.loc.pick }));
    expect((await order())?.status).toBe("Ready to Pack");
    const line = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, state.orderId as string)).limit(1))[0];
    expect(line?.pickedQuantity).toBe(4);
    await reconciled();
  });

  it("packs", async () => {
    const packTask = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, state.jobId as string), eq(schema.tasks.taskType, "Packing"))).limit(1))[0];
    await withWriteTx(w.db, async (tx) => await execute(tx, w.ctx, { taskIds: [packTask?.id as string], targetLocationId: w.loc.pack }));
    expect((await order())?.status).toBe("Ready to Ship");
    const job = (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, state.jobId as string)).limit(1))[0];
    expect(job?.status).toBe("Completed");
    const packed = (await w.db.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, w.loc.pack), eq(schema.inventory.status, "Packed"))).limit(1))[0];
    expect(packed?.onHand).toBe(4);
    expect(packed?.allocated).toBe(4);
    await reconciled();
  });

  it("creates a sandbox label with a real PDF", async () => {
    const res = await createLabel(w.db, w.ctx, {
      orderId: state.orderId as string, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground,
      packages: [{ weightOz: 32, length: 10, width: 8, height: 4 }],
    }, { files: w.files });
    expect(res.masterTrackingNumber).toMatch(/^1Z[0-9A-Z]{16}$/);
    const file = (await w.db.select().from(schema.files).where(eq(schema.files.id, res.shipments[0].labelFileId as string)).limit(1))[0];
    expect(file?.mime).toBe("application/pdf");
    const bytes = fs.readFileSync(path.join(w.filesRoot, file?.id as string));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await order())?.trackingNumber).toBe(res.masterTrackingNumber);
    await reconciled();
  });

  it("ships 4", async () => {
    const r = await withWriteTx(w.db, async (tx) => await shipOrders(tx, w.ctx, { orderIds: [state.orderId as string] }));
    expect(r.failed).toEqual([]);
    expect((await order())?.status).toBe("Shipped");
    expect(await onHand(w, w.productId)).toBe(6);
    const eod = await w.db.select().from(schema.endOfDayManifests);
    expect(eod).toHaveLength(1);
    expect(eod[0].totalPackages).toBe(1);
    await reconciled();
  });

  it("receives a return of 1 back into storage", async () => {
    const ro = (await w.db.insert(schema.returnOrders).values({ rmaCode: "RMA000001", shipmentOrderId: state.orderId, warehouseId: w.warehouseId, clientId: w.clientId }).returning())[0];
    await withWriteTx(w.db, async (tx) => await ledger.recordReceipt(tx, w.ctx, {
      type: "Return", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 1, locationId: w.loc.storageA,
      returnOrderId: ro.id, lotNumber: "LOT-A", expiryDate: "2027-12-31",
    }));
    expect(await onHand(w, w.productId)).toBe(7);
    const txn = await w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.type, "Return Receiving"));
    expect(txn).toHaveLength(1);
    await reconciled();
  });

  it("adjusts -1", async () => {
    const bucket = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, state.storageBucket as string)).limit(1))[0];
    expect(bucket?.onHand).toBe(7);
    const r = await withWriteTx(w.db, async (tx) => await ledger.adjustTo(tx, w.ctx, { inventoryId: bucket?.id as string, targetQty: 6 }));
    expect(r.txn?.uomQty).toBe(-1);
    expect(await onHand(w, w.productId)).toBe(6);
    await reconciled();
  });

  it("counts to 5", async () => {
    const r = await withWriteTx(w.db, async (tx) => await ledger.adjustTo(tx, w.ctx, { inventoryId: state.storageBucket as string, targetQty: 5, type: "Count" }));
    expect(r.txn?.type).toBe("Count");
    expect(await onHand(w, w.productId)).toBe(5);
    await reconciled();
    const types = (await w.db.select({ type: schema.inventoryTransactions.type }).from(schema.inventoryTransactions).orderBy(schema.inventoryTransactions.seq)).map((t) => t.type);
    expect(types).toEqual(["Receiving", "Inventory Movement", "Allocation", "Picking", "Packing", "Shipment", "Return Receiving", "Inventory Adjustment", "Count"]);
  });
});
