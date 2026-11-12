/** Ledger: operations, placement rules, LP mixing, receipts, serials, invariants. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { bucketKey, findBucket, specOf } from "@/server/domain/ledger/bucket";
import { CANCEL_COMPLETED_PO_MESSAGE } from "@/server/domain/ledger/receipts";
import { createWorld, locationRow, type World } from "./fixtures";

let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());

const addStock = async (qty: number, locationId = w.loc.storageA, extra: Record<string, unknown> = {}) =>
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId, qty, ...extra });
const mkLoc = async (code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}) =>
  (await w.db.insert(schema.locations).values(locationRow(w.warehouseId, code, extra)).returning())[0].id;
const mkLp = async (number: string, typeExtra: Partial<typeof schema.lpTypes.$inferInsert> = {}, locationId: string | null = null) => {
  const type = (await w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: `T-${number}`, numberPrefix: "LP", numberLength: 4, ...typeExtra }).returning())[0];
  return (await w.db.insert(schema.licensePlates).values({ number, warehouseId: w.warehouseId, lpTypeId: type.id, locationId }).returning())[0].id;
};
const clean = async () => expect(await ledger.reconcileLedger(w.db)).toEqual([]);

describe("add / remove / adjust", () => {
  it("adds into one bucket per tuple and removes free stock", async () => {
    const a = await addStock(5);
    const b = await addStock(3);
    expect(b.bucket.id).toBe(a.bucket.id);
    expect(b.bucket.onHand).toBe(8);
    expect(a.bucket.bucketKey).toBe(bucketKey(specOf(a.bucket)));
    const lot = await addStock(2, w.loc.storageA, { lotNumber: "L2" });
    expect(lot.bucket.id).not.toBe(a.bucket.id);
    await ledger.remove(w.db, w.ctx, { inventoryId: a.bucket.id, qty: 8 });
    await expect(async () => await ledger.remove(w.db, w.ctx, { inventoryId: a.bucket.id, qty: 1 })).rejects.toThrow(/unallocated/);
    await expect(async () => await addStock(0)).rejects.toThrow(/positive/);
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId, productId: w.productId, locationId: w.loc.storageA, qty: 1 })).rejects.toThrow(/another client/);
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: "nope", locationId: w.loc.storageA, qty: 1 })).rejects.toThrow(/Product not found/);
    await clean();
  });

  it("adjusts to an absolute target with a signed delta and reasons", async () => {
    const { bucket } = await addStock(5);
    expect((await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 5 })).txn).toBeNull();
    expect((await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 9 })).txn?.uomQty).toBe(4);
    const created = await ledger.adjustTo(w.db, w.ctx, { bucket: { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageB, qty: 0 }, targetQty: 2, type: "Count" });
    expect(created.bucket.onHand).toBe(2);
    await expect(async () => await ledger.adjustTo(w.db, w.ctx, { targetQty: 1 })).rejects.toThrow(/required/);
    await expect(async () => await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: -1 })).rejects.toThrow(/zero or a positive/);
    await w.db.update(schema.warehouses).set({ mandatoryAdjustmentReason: true }).where(eq(schema.warehouses.id, w.warehouseId));
    await expect(async () => await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 1 })).rejects.toThrow(/adjustment reason/);
    const r = await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 1, adjustmentReasonId: "r1" });
    expect(r.txn?.adjustmentReasonId).toBe("r1");
    await ledger.allocate(w.db, w.ctx, { inventoryId: bucket.id, qty: 1 });
    await expect(async () => await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 0, adjustmentReasonId: "r" })).rejects.toThrow(/allocated/);
    await clean();
  });

  it("adopts legacy buckets by tuple", async () => {
    const legacy = (await w.db.insert(schema.inventory).values({ warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, onHand: 0, receivedAt: "2026-01-01" }).returning())[0];
    const found = await findBucket(w.db, specOf(legacy));
    expect(found?.id).toBe(legacy.id);
    expect(found?.bucketKey.startsWith("legacy:")).toBe(false);
  });
});

describe("location rules", () => {
  it("enforces locked, inactive, damaged-only, dedicated client, single client", async () => {
    const locked = await mkLoc("LCK", { isLocked: true });
    await expect(async () => await addStock(1, locked)).rejects.toThrow(/locked/);
    const inactive = await mkLoc("INA", { isActive: false });
    await expect(async () => await addStock(1, inactive)).rejects.toThrow(/inactive/);
    await expect(async () => await addStock(1, w.loc.damaged)).rejects.toThrow(/only accepts damaged/);
    expect((await addStock(1, w.loc.damaged, { damageReason: "Crushed" })).bucket.damaged).toBe(1);
    const ded = await mkLoc("DED", { dedicatedClientId: w.otherClientId });
    await expect(async () => await addStock(1, ded)).rejects.toThrow(/dedicated/);
    const single = await mkLoc("SGL", { singleClient: true });
    await addStock(1, single);
    const other = (await w.db.insert(schema.products).values({ clientId: w.otherClientId, sku: "B-1", barcode: "B-1", name: "b", category: "c", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active" }).returning())[0];
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId, productId: other.id, locationId: single, qty: 1 })).rejects.toThrow(/single client/);
  });

  it("enforces only-one SKU/lot/expiry/production date, max SKUs and capacity", async () => {
    const one = await mkLoc("ONE", { onlyOneSku: true, onlyOneLot: true });
    await addStock(1, one, { lotNumber: "A" });
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: one, qty: 1, lotNumber: "A" })).rejects.toThrow(/one SKU/);
    await expect(async () => await addStock(1, one, { lotNumber: "B" })).rejects.toThrow(/lot/);
    const exp = await mkLoc("EXP", { onlyOneExpiry: true, onlyOneProductionDate: true });
    await addStock(1, exp, { expiryDate: "2027-01-01", productionDate: "2026-01-01" });
    await expect(async () => await addStock(1, exp, { expiryDate: "2028-01-01", productionDate: "2026-01-01" })).rejects.toThrow(/expiry/);
    await expect(async () => await addStock(1, exp, { expiryDate: "2027-01-01", productionDate: "2026-02-01" })).rejects.toThrow(/production/);
    const maxSku = await mkLoc("MSK", { maxSkuQty: 1 });
    await addStock(1, maxSku);
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: maxSku, qty: 1 })).rejects.toThrow(/at most 1 SKUs/);
    const cap = await mkLoc("CAP", { capacityType: "Maximum Unit Quantity", maxCapacityQty: 5 });
    await addStock(5, cap);
    await expect(async () => await addStock(1, cap)).rejects.toThrow(/capacity exceeded/);
    await w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Case", kind: "Hierarchical", uomQty: 6 });
    const packCap = await mkLoc("PCAP", { capacityType: "Maximum Pack Quantity", maxCapacityQty: 1 });
    await addStock(6, packCap, { packType: "Case" });
    await expect(async () => await addStock(6, packCap, { packType: "Case" })).rejects.toThrow(/packs/);
    const lpLoc = await mkLoc("OLP", { onlyOneLp: true });
    await addStock(1, lpLoc, { lpId: await mkLp("LP1") });
    await expect(async () => await addStock(1, lpLoc, { lpId: await mkLp("LP2") })).rejects.toThrow(/one LP/);
  });
});

describe("LP rules and moves", () => {
  it("places an LP, enforces type mixing and keeps LP status", async () => {
    const lp = await mkLp("LP10", { onlyOneSku: true, onlyOneLot: true, onlyOneExpiry: true, onlyOneProductionDate: true, onlyOneClient: true });
    await addStock(2, w.loc.storageA, { lpId: lp, lotNumber: "A" });
    const row = (await w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lp)).limit(1))[0];
    expect(row?.locationId).toBe(w.loc.storageA);
    expect(row?.status).toBe("Occupied");
    await expect(async () => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: w.loc.storageA, lpId: lp, qty: 1, lotNumber: "A" })).rejects.toThrow(/one SKU/);
    await expect(async () => await addStock(1, w.loc.storageA, { lpId: lp, lotNumber: "B" })).rejects.toThrow(/lot/);
    await expect(async () => await addStock(1, w.loc.storageB, { lpId: lp, lotNumber: "A" })).rejects.toThrow(/another location/);
    await w.db.update(schema.licensePlates).set({ status: "Shipped" }).where(eq(schema.licensePlates.id, lp));
    await expect(async () => await addStock(1, w.loc.storageA, { lpId: lp, lotNumber: "A" })).rejects.toThrow(/shipped/);
  });

  it("enforces only-one-order / only-one-job on LPs", async () => {
    const lp = await mkLp("LP20", { onlyOneOrder: true, onlyOneJob: true }, w.loc.pick);
    const a = (await addStock(4)).bucket;
    const al1 = (await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o1", jobId: "j1" })).allocation;
    const al2 = (await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o2", jobId: "j2" })).allocation;
    await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toLpId: lp, toStatus: "Picked", allocationId: al1.id, type: "Picking" });
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toLpId: lp, toStatus: "Picked", allocationId: al2.id, type: "Picking" })).rejects.toThrow(/one order/);
  });

  it("moves free and allocated stock, splits allocations and validates", async () => {
    const a = (await addStock(10)).bucket;
    const alloc = (await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 6, orderId: "o1" })).allocation;
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 5, toLocationId: w.loc.storageB })).rejects.toThrow(/unallocated/);
    const free = await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 4, toLocationId: w.loc.storageB });
    expect(free.target.onHand).toBe(4);
    const part = await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 2, toLocationId: w.loc.pick, toStatus: "Picked", allocationId: alloc.id, type: "Picking" });
    expect(part.allocationId).not.toBe(alloc.id);
    expect(part.target.allocated).toBe(2);
    expect(part.source.allocated).toBe(4);
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 9, allocationId: alloc.id, toLocationId: w.loc.pick, toStatus: "Picked" })).rejects.toThrow(/allocated/);
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: part.target.id, qty: 1, allocationId: alloc.id, toLocationId: w.loc.pack })).rejects.toThrow(/does not hold/);
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: a.id, qty: 1, toLocationId: w.loc.storageA })).rejects.toThrow(/same/);
    const st = await ledger.setStatus(w.db, w.ctx, { inventoryId: part.target.id, qty: 2, toStatus: "Packed", allocationId: part.allocationId as string });
    expect(st.target.status).toBe("Packed");
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: free.target.id, qty: 1, toLocationId: await mkLoc("LK2", { isLocked: true }) })).rejects.toThrow(/locked/);
    await clean();
  });

  it("changes attributes, moving damaged stock out of allocatable qty", async () => {
    const a = (await addStock(5)).bucket;
    const r = await ledger.changeAttributes(w.db, w.ctx, { inventoryId: a.id, qty: 2, damageReason: "Wet", lotNumber: "L9" });
    expect(r.target.damaged).toBe(2);
    expect(r.txn.type).toBe("Attributes Change");
    await expect(async () => await ledger.allocate(w.db, w.ctx, { inventoryId: r.target.id, qty: 1 })).rejects.toThrow(/Damaged/);
    await clean();
  });

  it("moves a whole location and an LP tree", async () => {
    const a = (await addStock(5)).bucket;
    await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 2, orderId: "o" });
    const parent = await mkLp("PAR");
    const child = await mkLp("CHD");
    await w.db.update(schema.licensePlates).set({ parentLpId: parent }).where(eq(schema.licensePlates.id, child));
    await addStock(3, w.loc.storageA, { lpId: child });
    const t = await ledger.moveLocation(w.db, w.ctx, { fromLocationId: w.loc.storageA, toLocationId: w.loc.storageB });
    expect(t.length).toBe(3);
    expect((await w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, child)).limit(1))[0]?.locationId).toBe(w.loc.storageB);
    const allocs = await w.db.select().from(schema.inventoryAllocations);
    const moved = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, allocs[0].inventoryId)).limit(1))[0];
    expect(moved?.locationId).toBe(w.loc.storageB);
    await w.db.update(schema.licensePlates).set({ locationId: w.loc.storageB }).where(eq(schema.licensePlates.id, parent));
    const lpMoves = await ledger.moveLp(w.db, w.ctx, { lpId: parent, toLocationId: w.loc.returns });
    expect(lpMoves).toHaveLength(1);
    await expect(async () => await ledger.moveLp(w.db, w.ctx, { lpId: parent, toLocationId: w.loc.returns })).rejects.toThrow(/already/);
    await expect(async () => await ledger.moveLocation(w.db, w.ctx, { fromLocationId: w.loc.returns, toLocationId: w.loc.returns })).rejects.toThrow(/same/);
    await clean();
  });

  it("consumes allocated stock and releases allocations", async () => {
    const a = (await addStock(5)).bucket;
    const al = (await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 3, orderId: "o" })).allocation;
    await expect(async () => await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 3 })).rejects.toThrow(/Only 2 units/);
    await expect(async () => await ledger.allocate(w.db, w.ctx, { inventoryId: a.id, qty: 0 })).rejects.toThrow(/positive/);
    await ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 1, allocationId: al.id, type: "Kitting" });
    await expect(async () => await ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 5, allocationId: al.id, type: "Kitting" })).rejects.toThrow(/enough/);
    expect((await ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id, qty: 1 })).released).toBe(1);
    await expect(async () => await ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id, qty: 5 })).rejects.toThrow(/between/);
    await ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id });
    await expect(async () => await ledger.releaseAllocation(w.db, w.ctx, { allocationId: al.id })).rejects.toThrow(/cancelled/);
    expect((await ledger.consume(w.db, w.ctx, { inventoryId: a.id, qty: 4, type: "Inventory Adjustment" })).bucket.onHand).toBe(0);
    await clean();
  });
});

describe("receipts and serials", () => {
  let poSeq = 0;
  const mkPo = async (status: "Pending" | "Completed" = "Pending") => {
    poSeq += 1;
    const po = (await w.db.insert(schema.purchaseOrders).values({ code: `PO-T${poSeq}`, warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status, totalQuantity: 4, purchasePrice: 1 }).returning())[0];
    const line = (await w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId: w.productId, orderedQuantity: 4, unitCost: 1 }).returning())[0];
    return { po, line };
  };

  it("cancels a receipt and reverses PO quantities", async () => {
    const { po, line } = await mkPo();
    const { receipt } = await ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 4, locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id });
    const r = await ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id });
    expect(r.txn?.type).toBe("Cancel Receiving");
    expect(r.receipt.cancelledAt).not.toBeNull();
    expect((await w.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, line.id)).limit(1))[0]?.receivedQuantity).toBe(0);
    await expect(async () => await ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).rejects.toThrow(/already cancelled/);
    await expect(async () => await ledger.cancelReceipt(w.db, w.ctx, { receiptId: "x" })).rejects.toThrow(/not found/);
    await clean();
  });

  it("blocks cancelling a receipt of a completed PO and receiving into closed POs", async () => {
    const { po, line } = await mkPo();
    const { receipt } = await ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 4, locationId: w.loc.receiving, purchaseOrderId: po.id, purchaseOrderLineId: line.id });
    await w.db.update(schema.purchaseOrders).set({ status: "Completed" }).where(eq(schema.purchaseOrders.id, po.id));
    await expect(async () => await ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).rejects.toThrow(CANCEL_COMPLETED_PO_MESSAGE);
    await expect(async () => await ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 1, locationId: w.loc.receiving, purchaseOrderId: po.id })).rejects.toThrow(/completed status/);
    await expect(async () => await ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 0, locationId: w.loc.receiving })).rejects.toThrow(/positive/);
    const { po: p2, line: l2 } = await mkPo();
    await expect(async () => await ledger.recordReceipt(w.db, w.ctx, { type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, quantity: 1, locationId: w.loc.receiving, purchaseOrderId: p2.id, purchaseOrderLineId: l2.id })).rejects.toThrow(/does not match/);
  });

  it("converts pack quantities and registers, picks and ships serials", async () => {
    await w.db.update(schema.products).set({ trackSerial: true }).where(eq(schema.products.id, w.productId));
    await w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Pair", kind: "Hierarchical", uomQty: 2 });
    await expect(async () => await ledger.recordReceipt(w.db, w.ctx, { type: "Add Inventory", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, packType: "Pair", quantity: 1, locationId: w.loc.storageA, serials: [{ primary: "S1" }] })).rejects.toThrow(/2 serial numbers/);
    const { receipt, txn } = await ledger.recordReceipt(w.db, w.ctx, { type: "Add Inventory", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, packType: "Pair", quantity: 1, locationId: w.loc.storageA, serials: [{ primary: "S1" }, { primary: "S2" }] });
    expect(receipt.uomQuantity).toBe(2);
    expect(txn.packQty).toBe(1);
    await expect(async () => await ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "S1" }], inventoryId: "i", txnId: "t" })).rejects.toThrow(/already in stock/);
    await expect(async () => await ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "X" }, { primary: "X" }], inventoryId: "i", txnId: "t" })).rejects.toThrow(/more than once/);
    await expect(async () => await ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: " " }], inventoryId: "i", txnId: "t" })).rejects.toThrow(/empty/);
    const bucket = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageA)).limit(1))[0];
    await expect(async () => await ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: "other", toInventoryId: "t", txnId: "x" })).rejects.toThrow(/not in the picked/);
    await ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: bucket?.id as string, toInventoryId: "t", txnId: "x" });
    await expect(async () => await ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S1", orderLineId: "l", fromInventoryId: "t", toInventoryId: "t", txnId: "x" })).rejects.toThrow(/picked/);
    await expect(async () => await ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "NOPE", orderLineId: "l", fromInventoryId: "t", toInventoryId: "t", txnId: "x" })).rejects.toThrow(/not found/);
    await expect(async () => await ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id })).rejects.toThrow(/already picked/);
    expect(await ledger.shipSerials(w.db, w.ctx, { orderLineId: "l", shipmentId: null, txnId: "x" })).toBe(1);
    const reused = await ledger.registerSerials(w.db, w.ctx, { productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, serials: [{ primary: "S1" }], inventoryId: "i", txnId: "t" });
    expect(reused[0].status).toBe("Received");
  });

  it("receives returns and moves the return to Started", async () => {
    const ro = (await w.db.insert(schema.returnOrders).values({ rmaCode: "RMA1", warehouseId: w.warehouseId, clientId: w.clientId, status: "Pending" }).returning())[0];
    const line = (await w.db.insert(schema.returnOrderLines).values({ returnOrderId: ro.id, productId: w.productId, packType: "Each", requestedQty: 2 }).returning())[0];
    const { receipt } = await ledger.recordReceipt(w.db, w.ctx, { type: "Return", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, quantity: 2, locationId: w.loc.returns, returnOrderId: ro.id, returnOrderLineId: line.id });
    expect((await w.db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).limit(1))[0]?.status).toBe("Started");
    expect((await w.db.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, line.id)).limit(1))[0]?.returnedQty).toBe(2);
    await ledger.cancelReceipt(w.db, w.ctx, { receiptId: receipt.id });
    expect((await w.db.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, line.id)).limit(1))[0]?.returnedQty).toBe(0);
  });
});

describe("reconciliation", () => {
  it("detects broken invariants", async () => {
    const a = (await addStock(3)).bucket;
    await w.db.update(schema.inventory).set({ onHand: 9, allocated: 1 }).where(eq(schema.inventory.id, a.id));
    const checks = (await ledger.reconcileLedger(w.db)).map((i) => i.check);
    expect(checks).toEqual(expect.arrayContaining(["bucket_balance", "bucket_allocated"]));
  });
});
