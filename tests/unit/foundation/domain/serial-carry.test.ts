/** Serial numbers follow ledger moves and come back to stock on return restock (db:verify serial_stock). */
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createWorld, type World } from "./fixtures";

let w: World;

async function receive(serials: string[]): Promise<string> {
  const { txn } = await ledger.recordReceipt(w.db, w.ctx, {
    type: "Add Inventory", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId,
    quantity: serials.length, locationId: w.loc.storageA, serials: serials.map((primary) => ({ primary })),
  });
  if (!txn.toInventoryId) throw new Error("receipt posted no target bucket");
  return txn.toInventoryId;
}

async function serialsIn(inventoryId: string): Promise<{ primarySerial: string; status: string; orderLineId: string | null }[]> {
  return await w.db.select({ primarySerial: schema.serialNumbers.primarySerial, status: schema.serialNumbers.status, orderLineId: schema.serialNumbers.orderLineId })
    .from(schema.serialNumbers).where(eq(schema.serialNumbers.inventoryId, inventoryId));
}

beforeEach(async () => {
  w = await createWorld();
  await w.db.update(schema.products).set({ trackSerial: true }).where(eq(schema.products.id, w.productId));
});

describe("serials follow ledger moves", () => {
  it("carries serials with a plain move so each bucket holds one serial per unit", async () => {
    const source = await receive(["S1", "S2", "S3"]);
    const moved = await ledger.move(w.db, w.ctx, { inventoryId: source, qty: 1, toLocationId: w.loc.storageB });
    expect(await serialsIn(source)).toHaveLength(2);
    expect(await serialsIn(moved.target.id)).toHaveLength(1);
    // oldest serial moves first
    expect((await serialsIn(moved.target.id))[0]?.primarySerial).toBe("S1");
  });

  it("marks carried serials picked for the order line, so shipping ships them", async () => {
    const source = await receive(["S1", "S2"]);
    const moved = await ledger.move(w.db, w.ctx, { inventoryId: source, qty: 1, toLocationId: w.loc.pick, toStatus: "Picked", type: "Picking", refs: { orderLineId: "line-1" } });
    expect(await serialsIn(moved.target.id)).toEqual([{ primarySerial: "S1", status: "Picked", orderLineId: "line-1" }]);
    expect(await ledger.shipSerials(w.db, w.ctx, { orderLineId: "line-1", shipmentId: null, txnId: moved.txn.id })).toBe(1);
  });

  it("prefers serials already assigned to the order line", async () => {
    const source = await receive(["S1", "S2"]);
    await w.db.update(schema.serialNumbers).set({ orderLineId: "line-9" }).where(eq(schema.serialNumbers.primarySerial, "S2"));
    const moved = await ledger.move(w.db, w.ctx, { inventoryId: source, qty: 1, toLocationId: w.loc.pick, toStatus: "Picked", refs: { orderLineId: "line-9" } });
    expect((await serialsIn(moved.target.id)).map((s) => s.primarySerial)).toEqual(["S2"]);
  });

  it("returns picked serials to Received when stock goes back to a Stock bucket", async () => {
    const source = await receive(["S1", "S2"]);
    const picked = await ledger.move(w.db, w.ctx, { inventoryId: source, qty: 1, toLocationId: w.loc.pick, toStatus: "Picked", refs: { orderLineId: "line-1" } });
    const back = await ledger.move(w.db, w.ctx, { inventoryId: picked.target.id, qty: 1, toLocationId: w.loc.storageA, toStatus: "Stock" });
    expect(back.target.id).toBe(source);
    expect((await serialsIn(source)).map((s) => s.status).sort()).toEqual(["Received", "Received"]);
  });

  it("leaves serials alone when the caller moves scanned serials itself", async () => {
    const source = await receive(["S1", "S2"]);
    const moved = await ledger.move(w.db, w.ctx, { inventoryId: source, qty: 1, toLocationId: w.loc.pick, toStatus: "Picked", carrySerials: false });
    await ledger.pickSerial(w.db, w.ctx, { productId: w.productId, serial: "S2", orderLineId: "line-1", fromInventoryId: source, toInventoryId: moved.target.id, txnId: moved.txn.id });
    expect((await serialsIn(source)).map((s) => s.primarySerial)).toEqual(["S1"]);
    expect((await serialsIn(moved.target.id)).map((s) => s.primarySerial)).toEqual(["S2"]);
  });

  it("does nothing for products that are not serial-tracked", async () => {
    await w.db.update(schema.products).set({ trackSerial: false }).where(eq(schema.products.id, w.productId));
    const { bucket } = await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 2 });
    const moved = await ledger.move(w.db, w.ctx, { inventoryId: bucket.id, qty: 1, toLocationId: w.loc.storageB });
    expect(await serialsIn(moved.target.id)).toHaveLength(0);
  });
});

describe("return restock", () => {
  it("brings the order line's shipped serials back into the restocked bucket", async () => {
    await receive(["S1", "S2"]);
    await w.db.update(schema.serialNumbers).set({ status: "Shipped", inventoryId: null, orderLineId: "line-7" })
      .where(inArray(schema.serialNumbers.primarySerial, ["S1", "S2"]));
    const { bucket, txn } = await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.returns, qty: 1, type: "Return Receiving" });
    if (!txn) throw new Error("no txn");
    const restocked = await ledger.restockReturnedSerials(w.db, w.ctx, { orderLineId: "line-7", productId: w.productId, inventoryId: bucket.id, qty: 1, txnId: txn.id });
    expect(restocked).toBe(1);
    expect(await serialsIn(bucket.id)).toEqual([{ primarySerial: "S1", status: "Received", orderLineId: null }]);
    const stillShipped = await w.db.select().from(schema.serialNumbers)
      .where(and(eq(schema.serialNumbers.primarySerial, "S2"), eq(schema.serialNumbers.status, "Shipped")));
    expect(stillShipped).toHaveLength(1);
  });

  it("restocks only as many serials as were shipped on the line", async () => {
    const { bucket, txn } = await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.returns, qty: 1, type: "Return Receiving" });
    if (!txn) throw new Error("no txn");
    expect(await ledger.restockReturnedSerials(w.db, w.ctx, { orderLineId: "missing", productId: w.productId, inventoryId: bucket.id, qty: 1, txnId: txn.id })).toBe(0);
  });
});
