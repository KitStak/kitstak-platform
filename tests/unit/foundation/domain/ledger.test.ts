/** Ledger: operations, placement rules, LP mixing, receipts, serials, invariants. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { bucketKey, findBucket, specOf } from "@/server/domain/ledger/bucket";
import { CANCEL_COMPLETED_PO_MESSAGE } from "@/server/domain/ledger/receipts";
import { createWorld, locationRow, type World } from "./fixtures";

let w: World;
beforeEach(() => { w = createWorld(); });
afterEach(() => w.close());

const addStock = (qty: number, locationId = w.loc.storageA, extra: Record<string, unknown> = {}) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId, qty, ...extra });
const mkLoc = (code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}) =>
  w.db.insert(schema.locations).values(locationRow(w.warehouseId, code, extra)).returning().get().id;
const mkLp = (number: string, typeExtra: Partial<typeof schema.lpTypes.$inferInsert> = {}, locationId: string | null = null) => {
  const type = w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: `T-${number}`, numberPrefix: "LP", numberLength: 4, ...typeExtra }).returning().get();
  return w.db.insert(schema.licensePlates).values({ number, warehouseId: w.warehouseId, lpTypeId: type.id, locationId }).returning().get().id;
};
const clean = () => expect(ledger.reconcileLedger(w.db)).toEqual([]);

describe("add / remove / adjust", () => {
  it("adds into one bucket per tuple and removes free stock", () => {
    const a = addStock(5);
    const b = addStock(3);
    expect(b.bucket.id).toBe(a.bucket.id);
    expect(b.bucket.onHand).toBe(8);
    expect(a.bucket.bucketKey).toBe(bucketKey(specOf(a.bucket)));
    const lot = addStock(2, w.loc.storageA, { lotNumber: "L2" });
    expect(lot.bucket.id).not.toBe(a.bucket.id);
    ledger.remove(w.db, w.ctx, { inventoryId: a.bucket.id, qty: 8 });
    expect(() => ledger.remove(w.db, w.ctx, { inventoryId: a.bucket.id, qty: 1 })).toThrow(/unallocated/);
    expect(() => addStock(0)).toThrow(/positive/);
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId, productId: w.productId, locationId: w.loc.storageA, qty: 1 })).toThrow(/another client/);
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: "nope", locationId: w.loc.storageA, qty: 1 })).toThrow(/Product not found/);
    clean();
  });

  it("adjusts to an absolute target with a signed delta and reasons", () => {
    const { bucket } = addStock(5);
    expect(ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 5 }).txn).toBeNull();
    expect(ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 9 }).txn?.uomQty).toBe(4);
    const created = ledger.adjustTo(w.db, w.ctx, { bucket: { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageB, qty: 0 }, targetQty: 2, type: "Count" });
    expect(created.bucket.onHand).toBe(2);
    expect(() => ledger.adjustTo(w.db, w.ctx, { targetQty: 1 })).toThrow(/required/);
    expect(() => ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: -1 })).toThrow(/zero or a positive/);
    w.db.update(schema.warehouses).set({ mandatoryAdjustmentReason: true }).where(eq(schema.warehouses.id, w.warehouseId)).run();
    expect(() => ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 1 })).toThrow(/adjustment reason/);
    const r = ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 1, adjustmentReasonId: "r1" });
    expect(r.txn?.adjustmentReasonId).toBe("r1");
    ledger.allocate(w.db, w.ctx, { inventoryId: bucket.id, qty: 1 });
    expect(() => ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 0, adjustmentReasonId: "r" })).toThrow(/allocated/);
    clean();
  });

  it("adopts legacy buckets by tuple", () => {
    const legacy = w.db.insert(schema.inventory).values({ warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, onHand: 0, receivedAt: "2026-01-01" }).returning().get();
    const found = findBucket(w.db, specOf(legacy));
    expect(found?.id).toBe(legacy.id);
    expect(found?.bucketKey.startsWith("legacy:")).toBe(false);
  });
});

describe("location rules", () => {
  it("enforces locked, inactive, damaged-only, dedicated client, single client", () => {
    const locked = mkLoc("LCK", { isLocked: true });
    expect(() => addStock(1, locked)).toThrow(/locked/);
    const inactive = mkLoc("INA", { isActive: false });
    expect(() => addStock(1, inactive)).toThrow(/inactive/);
    expect(() => addStock(1, w.loc.damaged)).toThrow(/only accepts damaged/);
    expect(addStock(1, w.loc.damaged, { damageReason: "Crushed" }).bucket.damaged).toBe(1);
    const ded = mkLoc("DED", { dedicatedClientId: w.otherClientId });
    expect(() => addStock(1, ded)).toThrow(/dedicated/);
    const single = mkLoc("SGL", { singleClient: true });
    addStock(1, single);
    const other = w.db.insert(schema.products).values({ clientId: w.otherClientId, sku: "B-1", barcode: "B-1", name: "b", category: "c", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active" }).returning().get();
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId, productId: other.id, locationId: single, qty: 1 })).toThrow(/single client/);
  });

  it("enforces only-one SKU/lot/expiry/production date, max SKUs and capacity", () => {
    const one = mkLoc("ONE", { onlyOneSku: true, onlyOneLot: true });
    addStock(1, one, { lotNumber: "A" });
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: one, qty: 1, lotNumber: "A" })).toThrow(/one SKU/);
    expect(() => addStock(1, one, { lotNumber: "B" })).toThrow(/lot/);
    const exp = mkLoc("EXP", { onlyOneExpiry: true, onlyOneProductionDate: true });
    addStock(1, exp, { expiryDate: "2027-01-01", productionDate: "2026-01-01" });
    expect(() => addStock(1, exp, { expiryDate: "2028-01-01", productionDate: "2026-01-01" })).toThrow(/expiry/);
    expect(() => addStock(1, exp, { expiryDate: "2027-01-01", productionDate: "2026-02-01" })).toThrow(/production/);
    const maxSku = mkLoc("MSK", { maxSkuQty: 1 });
    addStock(1, maxSku);
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: maxSku, qty: 1 })).toThrow(/at most 1 SKUs/);
    const cap = mkLoc("CAP", { capacityType: "Maximum Unit Quantity", maxCapacityQty: 5 });
    addStock(5, cap);
    expect(() => addStock(1, cap)).toThrow(/capacity exceeded/);
    w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Case", kind: "Hierarchical", uomQty: 6 }).run();
    const packCap = mkLoc("PCAP", { capacityType: "Maximum Pack Quantity", maxCapacityQty: 1 });
    addStock(6, packCap, { packType: "Case" });
    expect(() => addStock(6, packCap, { packType: "Case" })).toThrow(/packs/);
    const lpLoc = mkLoc("OLP", { onlyOneLp: true });
    addStock(1, lpLoc, { lpId: mkLp("LP1") });
    expect(() => addStock(1, lpLoc, { lpId: mkLp("LP2") })).toThrow(/one LP/);
  });
});

describe("LP rules and moves", () => {
  it("places an LP, enforces type mixing and keeps LP status", () => {
    const lp = mkLp("LP10", { onlyOneSku: true, onlyOneLot: true, onlyOneExpiry: true, onlyOneProductionDate: true, onlyOneClient: true });
    addStock(2, w.loc.storageA, { lpId: lp, lotNumber: "A" });
    const row = w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lp)).get();
    expect(row?.locationId).toBe(w.loc.storageA);
    expect(row?.status).toBe("Occupied");
    expect(() => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: w.loc.storageA, lpId: lp, qty: 1, lotNumber: "A" })).toThrow(/one SKU/);
    expect(() => addStock(1, w.loc.storageA, { lpId: lp, lotNumber: "B" })).toThrow(/lot/);
    expect(() => addStock(1, w.loc.storageB, { lpId: lp, lotNumber: "A" })).toThrow(/another location/);
    w.db.update(schema.licensePlates).set({ status: "Shipped" }).where(eq(schema.licensePlates.id, lp)).run();
    expect(() => addStock(1, w.loc.storageA, { lpId: lp, lotNumber: "A" })).toThrow(/shipped/);
  });

  it("enforces only-one-order / only-one-job on LPs", () => {
    const lp = mkLp("LP20", { onlyOneOrder: true, onlyOneJob: true }, w.loc.pick);
    const a = addStock(4).bucket;
    const al1 = ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o1", jobId: "j1" }).allocation;
    const al2 = ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o2", jobId: "j2" }).allocation;
    ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toLpId: lp, toStatus: "Picked", allocationId: al1.id, type: "Picking" });
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toLpId: lp, toStatus: "Picked", allocationId: al2.id, type: "Picking" })).toThrow(/one order/);
  });

  it("moves free and allocated stock, splits allocations and validates", () => {
    const a = addStock(10).bucket;
    const alloc = ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 6, orderId: "o1" }).allocation;
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 5, toLocationId: w.loc.storageB })).toThrow(/unallocated/);
    const free = ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 4, toLocationId: w.loc.storageB });
    expect(free.target.onHand).toBe(4);
    const part = ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toStatus: "Picked", allocationId: alloc.id, type: "Picking" });
    expect(part.allocationId).not.toBe(alloc.id);
    expect(part.target.allocated).toBe(2);
    expect(part.source.allocated).toBe(4);
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 9, allocationId: alloc.id, toLocationId: w.loc.pick, toStatus: "Picked" })).toThrow(/allocated/);
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: part.target.id, qty: 1, allocationId: alloc.id, toLocationId: w.loc.pack })).toThrow(/does not hold/);
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 1, toLocationId: w.loc.storageA })).toThrow(/same/);
    const st = ledger.setStatus(w.db, w.ctx, { inventoryId: part.target.id, qty: 2, toStatus: "Packed", allocationId: part.allocationId as string });
    expect(st.target.status).toBe("Packed");
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: free.target.id, qty: 1, toLocationId: mkLoc("LK2", { isLocked: true }) })).toThrow(/locked/);
    clean();
  });

  it("changes attributes, moving damaged stock out of allocatable qty", () => {
    const a = addStock(5).bucket;
    const r = ledger.changeAttributes(w.db, w.ctx, { inventoryId: a.id, qty: 2, damageReason: "Wet", lotNumber: "L9" });
    expect(r.target.damaged).toBe(2);
    expect(r.txn.type).toBe("Attributes Change");
    expect(() => ledger.allocate(w.db, w.ctx, { inventoryId: r.target.id, qty: 1 })).toThrow(/Damaged/);
    clean();
  });

  it("moves a whole location and an LP tree", () => {
    const a = addStock(5).bucket;
    ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o" });
    const parent = mkLp("PAR");
    const child = mkLp("CHD");
    w.db.update(schema.licensePlates).set({ parentLpId: parent }).where(eq(schema.licensePlates.id, child)).run();
    addStock(3, w.loc.storageA, { lpId: child });
    const t = ledger.moveLocation(w.db, w.ctx, { fromLocationId: w.loc.storageA, toLocationId: w.loc.storageB });
    expect(t.length).toBe(3);
    expect(w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, child)).get()?.locationId).toBe(w.loc.storageB);
    const allocs = w.db.select().from(schema.inventoryAllocations).all();
    const moved = w.db.select().from(schema.inventory).where(eq(schema.inventory.id, allocs[0].inventoryId)).get();
    expect(moved?.locationId).toBe(w.loc.storageB);
    w.db.update(schema.licensePlates).set({ locationId: w.loc.storageB }).where(eq(schema.licensePlates.id, parent)).run();
    const lpMoves = ledger.moveLp(w.db, w.ctx, { lpId: parent, toLocationId: w.loc.returns });
    expect(lpMoves).toHaveLength(1);
    expect(() => ledger.moveLp(w.db, w.ctx, { lpId: parent, toLocationId: w.loc.returns })).toThrow(/already/);
    expect(() => ledger.moveLocation(w.db, w.ctx, { fromLocationId: w.loc.returns, toLocationId: w.loc.returns })).toThrow(/same/);
    clean();
  });

  it("consumes allocated stock and releases allocations", () => {
    const a = addStock(5).bucket;
    const al = ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 3, orderId: "o" }).allocation;
    expect(() => ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 3 })).toThrow(/Only 2 units/);
    expect(() => ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 0 })).toThrow(/positive/);
    ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 1, allocationId: al.id, type: "Kitting" });
    expect(() => ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 5, allocationId: al.id, type: "Kitting" })).toThrow(/enough/);
    expect(ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id, qty: 1 }).released).toBe(1);
    expect(() => ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id, qty: 5 })).toThrow(/between/);
    ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id });
    expect(() => ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id })).toThrow(/cancelled/);
    expect(ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 4, type: "Inventory Adjustment" }).bucket.onHand).toBe(0);
    clean();
  });
});

describe("receipts and serials", () => {
  let poSeq = 0;
  const mkPo = (status: "Pending" | "Completed" = "Pending") => {
    poSeq += 1;
    const po = w.db.insert(schema.purchaseOrders).values({ code: `PO-T${poSeq}`, warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status, totalQuantity: 4, purchasePrice: 1 }).returning().get();
    const line = w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId: w.productId, orderedQuantity: 4, unitCost: 1 }).returning().get();
    return { po, line };
  };

  it("cancels a receipt and reverses PO quantities", () => {
    const { po, line } = mkPo();
    const { receipt } = ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 4, locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id });
    const r = ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id });
    expect(r.txn?.type).toBe("Cancel Receiving");
    expect(r.receipt.cancelledAt).not.toBeNull();
    expect(w.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, line.id)).get()?.receivedQuantity).toBe(0);
    expect(() => ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).toThrow(/already cancelled/);
    expect(() => ledger.cancelReceipt(w.db, w.ctx, { receiptId: "x" })).toThrow(/not found/);
    clean();
  });

  it("blocks cancelling a receipt of a completed PO and receiving into closed POs", () => {
    const { po, line } = mkPo();
    const { receipt } = ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 4, locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id });
    w.db.update(schema.purchaseOrders).set({ status: "Completed" }).where(eq(schema.purchaseOrders.id, po.id)).run();
    expect(() => ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).toThrow(CANCEL_COMPLETED_PO_MESSAGE);
    expect(() => ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 1, locationId: w.loc.receiving, purchaseOrderId: po.id })).toThrow(/completed status/);
    expect(() => ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 0, locationId: w.loc.receiving })).toThrow(/positive/);
    const { po: p2, line: l2 } = mkPo();
    expect(() => ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, quantity: 1, locationId: w.loc.receiving, purchaseOrderId: p2.id, purchaseOrderLineId: l2.id })).toThrow(/does not match/);
  });

  it("converts pack quantities and registers, picks and ships serials", () => {
    w.db.update(schema.products).set({ trackSerial: true }).where(eq(schema.products.id, w.productId)).run();
    w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Pair", kind: "Hierarchical", uomQty: 2 }).run();
    expect(() => ledger.recordReceipt(w.db, w.ctx, { type: "Add Inventory", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, packType: "Pair", quantity: 1, locationId: w.loc.storageA, serials: [{ primary: "S1" }] })).toThrow(/2 serial numbers/);
    const { receipt, txn } = ledger.recordReceipt(w.db, w.ctx, { type: "Add Inventory", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, packType: "Pair", quantity: 1, locationId: w.loc.storageA, serials: [{ primary: "S1" }, { primary: "S2" }] });
    expect(receipt.uomQuantity).toBe(2);
    expect(txn.packQty).toBe(1);
    expect(() => ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "S1" }], inventoryId: "i", txnId: "t" })).toThrow(/already in stock/);
    expect(() => ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "X" }, { primary: "X" }], inventoryId: "i", txnId: "t" })).toThrow(/more than once/);
    expect(() => ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: " " }], inventoryId: "i", txnId: "t" })).toThrow(/empty/);
    const bucket = w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageA)).get();
    expect(() => ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: "other", toInventoryId: "t", txnId: "x" })).toThrow(/not in the picked/);
    ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: bucket?.id as string, toInventoryId: "t", txnId: "x" });
    expect(() => ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: "t", toInventoryId: "t", txnId: "x" })).toThrow(/picked/);
    expect(() => ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "NOPE", orderLineId: "l", fromInventoryId: "t", toInventoryId: "t", txnId: "x" })).toThrow(/not found/);
    expect(() => ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).toThrow(/already picked/);
    expect(ledger.shipSerials(w.db, w.ctx, { orderLineId: "l", shipmentId: null, txnId: "x" })).toBe(1);
    const reused = ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "S1" }], inventoryId: "i", txnId: "t" });
    expect(reused[0].status).toBe("Received");
  });

  it("receives returns and moves the return to Started", () => {
    const ro = w.db.insert(schema.returnOrders).values({ rmaCode: "RMA1", warehouseId: w.warehouseId, clientId: w.clientId, status: "Pending" }).returning().get();
    const line = w.db.insert(schema.returnOrderLines).values({ returnOrderId: ro.id, productId: w.productId, packType: "Each", requestedQty: 2 }).returning().get();
    const { receipt } = ledger.recordReceipt(w.db, w.ctx, { type: "Return", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 2, locationId: w.loc.returns, returnOrderId: ro.id, returnOrderLineId: line.id });
    expect(w.db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).get()?.status).toBe("Started");
    expect(w.db.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, line.id)).get()?.returnedQty).toBe(2);
    ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id });
    expect(w.db.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, line.id)).get()?.returnedQty).toBe(0);
  });
});

describe("reconciliation", () => {
  it("detects broken invariants", () => {
    const a = addStock(3).bucket;
    w.db.update(schema.inventory).set({ onHand: 9, allocated: 1 }).where(eq(schema.inventory.id, a.id)).run();
    const checks = ledger.reconcileLedger(w.db).map((i) => i.check);
    expect(checks).toEqual(expect.arrayContaining(["bucket_balance", "bucket_allocated"]));
  });
});
