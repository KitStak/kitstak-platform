/**
 * M08 round 7 (parity loop): wizard Next gating (Logiwa keeps Next disabled until the step
 * is valid), the Kit step error state, history repair (Shortage exceptions + Kitting receipts),
 * and reprintable picking lists for completed work orders.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { EMPTY_FORM, stepBlockReason, type WoForm } from "@/components/work-orders/wizard/wo-form";
import { createWorkOrder } from "@/server/repositories/work-orders";
import { allocateWorkOrder, createKit, repairWorkOrderHistory, WORK_ORDER_EXCEPTION_WAVE } from "@/server/repositories/work-orders-commands";
import { buildPickLists } from "@/server/repositories/work-orders-ops";
import { createKitWorld, onHandAt, stock, woInput, type KitWorld } from "./kit-world";

describe("wizard Next gating", () => {
  const comps = [{ productId: "c1", sku: "C-1" }, { productId: "c2", sku: "C-2" }];
  const general: WoForm = { ...EMPTY_FORM, warehouseId: "wh", clientId: "cl", code: "WO1", type: "Work Order with Picking" };

  it("blocks General until every required field is set, naming the missing ones", () => {
    expect(stepBlockReason(EMPTY_FORM, [], "general")).toBe("Complete Warehouse, Client, Work order code, Work order type");
    expect(stepBlockReason({ ...general, type: null }, [], "general")).toMatch(/^Work order type/);
    expect(stepBlockReason(general, [], "general")).toBeNull();
  });

  it("blocks the Kit step with no kit, while loading, and when the kit failed to load", () => {
    expect(stepBlockReason(general, [], "kit")).toBe("Select a kit to continue");
    const withKit = { ...general, kitProductId: "k", kitSku: "K-1" };
    expect(stepBlockReason(withKit, [], "kit", { loading: true, error: null })).toMatch(/Loading/);
    expect(stepBlockReason(withKit, [], "kit", { loading: false, error: "Internal error" })).toMatch(/couldn't be loaded/);
    expect(stepBlockReason(withKit, comps, "kit")).toBeNull();
    expect(stepBlockReason({ ...withKit, requestedQty: 0 }, comps, "kit")).toBe("Kit quantity: At least 1");
  });

  it("asks for component sources on a without-picking work order", () => {
    const f = { ...general, type: "Work Order without Picking" as const, kitProductId: "k", kitSku: "K-1" };
    expect(stepBlockReason(f, comps, "kit")).toBe("Choose a source for 2 components");
    const src = { locationId: "l", locationCode: "A", lpId: null, lpNumber: null, lotNumber: null, expiryDate: null, productionDate: null };
    expect(stepBlockReason({ ...f, sources: { c1: src, c2: src } }, comps, "kit")).toBeNull();
  });

  it("requires a client before the Kit step", () => {
    expect(stepBlockReason({ ...general, clientId: null }, [], "kit")).toMatch(/client/i);
  });
});

let w: KitWorld;
beforeEach(async () => {
  w = await createKitWorld();
  await stock(w, w.productId, 30);
  await stock(w, w.product2Id, 12);
});
afterEach(() => w.close());

const exceptionsOf = async (id: string) => await w.db.select().from(schema.allocationExceptions)
  .where(and(eq(schema.allocationExceptions.orderId, id), eq(schema.allocationExceptions.waveNo, WORK_ORDER_EXCEPTION_WAVE)));
const kittingReceipts = async (id: string) => await w.db.select().from(schema.receipts)
  .where(and(eq(schema.receipts.workOrderId, id), eq(schema.receipts.type, "Kitting")));

describe("work order history repair", () => {
  it("backfills Manual Allocation - Work Order exceptions on a Shortage work order", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { type: "Work Order with Picking", requestedQty: 100, code: "KS-SHORT-1" }));
    expect((await allocateWorkOrder(w.db, w.wctx, wo.id)).status).toBe("Shortage");
    const live = await exceptionsOf(wo.id);
    expect(live.length).toBeGreaterThan(0);
    // Seeded history had none: wipe them, then repair writes the same shape as live allocation.
    await w.db.delete(schema.allocationExceptions).where(eq(schema.allocationExceptions.orderId, wo.id));
    expect((await repairWorkOrderHistory(w.db, w.wctx)).exceptions).toEqual(["KS-SHORT-1"]);
    const repaired = await exceptionsOf(wo.id);
    expect(repaired.map((e) => [e.shortageProductId, e.orderLineQty, e.inventoryUomQty]).sort())
      .toEqual(live.map((e) => [e.shortageProductId, e.orderLineQty, e.inventoryUomQty]).sort());
    expect((await repairWorkOrderHistory(w.db, w.wctx)).exceptions).toEqual([]);
  });

  it("backfills the Kitting receipt of a completed work order without touching stock", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2, code: "KS-DONE-1" }));
    await createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 2, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    const [live] = await kittingReceipts(wo.id);
    expect(live?.quantity).toBe(2);
    const kitsBefore = await onHandAt(w, w.kitId, w.kittingLocId);
    await w.db.delete(schema.receipts).where(eq(schema.receipts.workOrderId, wo.id));
    expect((await repairWorkOrderHistory(w.db, w.wctx)).receipts).toEqual(["KS-DONE-1"]);
    const [rebuilt] = await kittingReceipts(wo.id);
    expect(rebuilt?.quantity).toBe(2);
    expect(rebuilt?.locationId).toBe(w.kittingLocId);
    expect(rebuilt?.inventoryTransactionId).toBe(live?.inventoryTransactionId);
    expect(await onHandAt(w, w.kitId, w.kittingLocId)).toBe(kitsBefore);
    expect((await repairWorkOrderHistory(w.db, w.wctx)).receipts).toEqual([]);
  });
});

describe("picking list reprint", () => {
  it("a completed work order without pick tasks reprints what was consumed (no new picks planned)", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 1, code: "KS-DONE-2" }));
    await createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    const lists = await buildPickLists(w.db, w.scope, [wo.id], false);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.jobType).toMatch(/reprint, consumed/);
    const skus = lists[0]?.lines.map((l) => l.sku).sort();
    expect(skus).not.toContain("MLT-KIT-2PK");
    expect(lists[0]?.lines.every((l) => l.locationCode !== "NO STOCK" && l.quantity > 0)).toBe(true);
  });

  it("a completed with-picking work order reprints the picked lines", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { type: "Work Order with Picking", requestedQty: 2, code: "KS-PICK-1", components: [{ componentProductId: w.productId }, { componentProductId: w.product2Id }] }));
    expect((await allocateWorkOrder(w.db, w.wctx, wo.id)).status).toBe("In Process");
    const fresh = (await w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo.id)).limit(1))[0];
    await createKit(w.db, w.wctx, { workOrderId: wo.id, version: fresh?.version, qty: 2, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null, completePendingPicks: true });
    const after = (await w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo.id)).limit(1))[0];
    expect(after?.status).toBe("Completed");
    const lists = await buildPickLists(w.db, w.scope, [wo.id], false);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.jobType).toMatch(/reprint/);
    expect(lists[0]?.lines.reduce((s, l) => s + l.quantity, 0)).toBeGreaterThan(0);
  });
});
