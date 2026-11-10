/**
 * M08 round 9 (parity loop, critic R5 fixes): one availability function behind Kit Inventory
 * stats and the kit card, the stale-snapshot refresh, and the kit output / disassembly ledger
 * type (Kitting / Disassemble Kit, never Receiving) including the backfill of older rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { computeKitStats, getKitDetail, kitStatsStale, KIT_STATS_MAX_AGE_MS, lastKitRecalcAt, listKitInventory, recalcKitInventory } from "@/server/repositories/kits";
import { classifyFree, componentAvailability } from "@/server/repositories/work-orders-availability";
import { createKit, disassembleKit, fefoSourceCodes, repairWorkOrderHistory } from "@/server/repositories/work-orders-commands";
import { codeList, fefoScanCodes, matchSourceScan } from "@/lib/grid-defs/work-orders/kit-steps";
import { createWorkOrder } from "@/server/repositories/work-orders";
import { shortageRecoverable } from "@/lib/grid-defs/work-orders/wo-coverage";
import { createKitWorld, stock, woInput, type KitWorld } from "./kit-world";

let w: KitWorld;
beforeEach(() => { w = createKitWorld(); });
afterEach(() => w.close());

function lockLocation(locationId: string, code: string): void {
  const plan = w.db.insert(schema.countPlans).values({ code, warehouseId: w.warehouseId, scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", status: "Ready To Count" }).returning().get();
  w.db.insert(schema.countPlanLines).values({ planId: plan.id, locationId, status: "Pending" }).run();
}

const gridQuery = { page: 1, pageSize: 50, sort: [], filters: [], search: null } as never;

describe("one availability definition", () => {
  it("classifies count locks before location flags", () => {
    expect(classifyFree({ countLocked: true, locationLocked: true, preventAllocation: false })).toBe("locked");
    expect(classifyFree({ countLocked: false, locationLocked: false, preventAllocation: true })).toBe("blocked");
    expect(classifyFree({ countLocked: false, locationLocked: false, preventAllocation: false })).toBe("usable");
  });

  it("Kit Inventory stats equal the kit card capacity under a count lock", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.productId, 8, w.loc.storageB);
    stock(w, w.product2Id, 20, w.loc.storageB);
    lockLocation(w.loc.storageA, "CNT-R9-1");
    const card = getKitDetail(w.db, w.scope, w.kitId, w.warehouseId);
    const stats = computeKitStats(w.db).find((s) => s.kitProductId === w.kitId && s.warehouseId === w.warehouseId);
    expect(stats?.netKittingCapacity).toBe(card.netKittingCapacity);
    const av = componentAvailability(w.db as never, { warehouseId: w.warehouseId, clientId: w.clientId, productIds: [w.productId] }).get(w.productId);
    expect(av).toMatchObject({ usableQty: 8, lockedQty: 40, lockedBy: ["CNT-R9-1"] });
    // Recalculate Now writes the same number the card shows.
    recalcKitInventory(w.db);
    const row = listKitInventory(w.db, w.scope, gridQuery).rows.find((r) => r.kitProductId === w.kitId && r.warehouseId === w.warehouseId);
    expect(row?.netKittingCapacity).toBe(card.netKittingCapacity);
  });

  it("refreshes a stale snapshot on read so a later count lock shows up", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    recalcKitInventory(w.db, new Date(Date.now() - KIT_STATS_MAX_AGE_MS - 1_000));
    lockLocation(w.loc.storageA, "CNT-R9-2");
    expect(kitStatsStale(lastKitRecalcAt(w.db))).toBe(true);
    const row = listKitInventory(w.db, w.scope, gridQuery).rows.find((r) => r.kitProductId === w.kitId && r.warehouseId === w.warehouseId);
    expect(row?.netKittingCapacity).toBe(0);
    expect(kitStatsStale(lastKitRecalcAt(w.db))).toBe(false);
    expect(kitStatsStale(null)).toBe(true);
  });
});

describe("kit ledger types", () => {
  const txnTypesFor = (workOrderId: string, productId: string) =>
    w.db.select({ type: schema.inventoryTransactions.type, qty: schema.inventoryTransactions.uomQty }).from(schema.inventoryTransactions)
      .where(and(eq(schema.inventoryTransactions.workOrderId, workOrderId), eq(schema.inventoryTransactions.productId, productId))).all();

  it("posts the kit output under Kitting and disassembly returns under Disassemble Kit", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    const wo = createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2, code: "KS-R9-1" }));
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 2, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    const kitRows = txnTypesFor(wo.id, w.kitId);
    expect(kitRows.map((r) => r.type)).toEqual(["Kitting"]);
    const receipt = w.db.select().from(schema.receipts).where(and(eq(schema.receipts.workOrderId, wo.id), eq(schema.receipts.type, "Kitting"))).get();
    const linked = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.id, receipt!.inventoryTransactionId!)).get();
    expect(linked?.type).toBe("Kitting");

    const kitBucket = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.productId, w.kitId), eq(schema.inventory.locationId, w.kittingLocId))).get()!;
    disassembleKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, sourceInventoryId: kitBucket.id, targetLocationId: w.loc.storageB, targetLpId: null } as never);
    const compIn = txnTypesFor(wo.id, w.productId).filter((r) => r.qty > 0 && r.type !== "Allocation" && r.type !== "Allocation Cancel");
    expect(compIn.map((r) => r.type)).toContain("Disassemble Kit");
    expect(compIn.map((r) => r.type)).not.toContain("Receiving");
  });

  it("backfills older Receiving rows of kitting receipts (idempotent, stock untouched)", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    const wo = createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 1, code: "KS-R9-2" }));
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    // Simulate a pre-round-6 build.
    w.db.update(schema.inventoryTransactions).set({ type: "Receiving" }).where(and(eq(schema.inventoryTransactions.workOrderId, wo.id), eq(schema.inventoryTransactions.productId, w.kitId))).run();
    const before = w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.kitId)).all().map((b) => b.onHand);
    expect(repairWorkOrderHistory(w.db, w.wctx).retyped).toBe(1);
    expect(txnTypesFor(wo.id, w.kitId).map((r) => r.type)).toEqual(["Kitting"]);
    expect(w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.kitId)).all().map((b) => b.onHand)).toEqual(before);
    expect(repairWorkOrderHistory(w.db, w.wctx).retyped).toBe(0);
  });
});

describe("mandatory source scan for FEFO (Logiwa step 1)", () => {
  it("lists usable bins/LPs only (free, not count-locked)", () => {
    expect(fefoScanCodes({
      a: [{ locationCode: "a-01", lpNumber: "LP9", freeQty: 3, lockedBy: null }, { locationCode: "B-02", lpNumber: null, freeQty: 0, lockedBy: null }],
      b: [{ locationCode: "C-03", lpNumber: null, freeQty: 5, lockedBy: "CNT1" }],
    })).toEqual(["A-01", "LP9"]);
    expect(codeList(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D or 2 more");
    expect(matchSourceScan([], "").ok).toBe(false);
  });

  it("server rejects a scan that names no usable source of an all-FEFO work order", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    const wo = createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2, code: "KS-R9-3" }));
    const code = w.db.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, w.loc.storageA)).get()!.code;
    expect(fefoSourceCodes(w.db, wo)).toContain(code);
    const base = { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null };
    expect(() => createKit(w.db, w.wctx, { ...base, sourceScan: "NOT-A-BIN" })).toThrow(/not a source/);
    expect(createKit(w.db, w.wctx, { ...base, sourceScan: code.toLowerCase() }).processedQty).toBe(1);
  });
});

describe("shortage recovery flag (pure)", () => {
  it("flags a Shortage row whose usable stock now covers every component", () => {
    expect(shortageRecoverable({ status: "Shortage", buildableQty: 408, remainingQty: 400 })).toBe(true);
    expect(shortageRecoverable({ status: "Shortage", buildableQty: 0, remainingQty: 400 })).toBe(false);
    expect(shortageRecoverable({ status: "Open", buildableQty: 999, remainingQty: 1 })).toBe(false);
    expect(shortageRecoverable({ status: "Shortage", buildableQty: null, remainingQty: 4 })).toBe(false);
  });
});
