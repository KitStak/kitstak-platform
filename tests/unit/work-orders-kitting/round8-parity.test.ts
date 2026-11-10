/**
 * M08 round 8 (parity loop, critic R4 fixes): lock-aware availability everywhere (detail KPIs,
 * component status, retry gate, wizard kit card/chips, Kit Inventory capacity), the Create Kit
 * stock gate, terminal-state copy, source labels, barcodes on print records, the code check.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { buildableKits, componentCoverage, coverageSummary, createKitStockReason, retryAllocationReason, sourceLabel, terminalBuildCopy, type CoverageComponent } from "@/lib/grid-defs/work-orders/wo-coverage";
import { kitQtyError } from "@/lib/grid-defs/work-orders/work-order-model";
import { computeKitStats, getKitDetail } from "@/server/repositories/kits";
import { componentAvailability } from "@/server/repositories/work-orders-availability";
import { createWorkOrder, getWorkOrderDetail, isWorkOrderCodeAvailable } from "@/server/repositories/work-orders";
import { createKitWorld, stock, woInput, type KitWorld } from "./kit-world";

const base: CoverageComponent = { sku: "C-1", componentQty: 2, totalQty: 10, allocatedQty: 0, consumedQty: 0, freeQty: 0, availableQty: 0, shortQty: 10, lockedQty: 0, lockedBy: [], locationId: null, sourceLockedBy: null };

describe("coverage (pure)", () => {
  it("separates count-locked shortages from plain shortages", () => {
    expect(componentCoverage({ ...base, lockedQty: 773, lockedBy: ["CNT000147"] })).toEqual({ state: "locked", shortQty: 10, lockedBy: ["CNT000147"] });
    expect(componentCoverage(base).state).toBe("short");
    expect(componentCoverage({ ...base, shortQty: 0, availableQty: 20, freeQty: 20 }).state).toBe("covered");
    expect(componentCoverage({ ...base, consumedQty: 10 }).state).toBe("consumed");
    // A chosen source that a count locks: the source's plan is the reason.
    expect(componentCoverage({ ...base, locationId: "l1", sourceLockedBy: "CNT000148" }).lockedBy).toEqual(["CNT000148"]);
  });

  it("counts only usable stock toward buildable kits", () => {
    expect(buildableKits([{ ...base, freeQty: 773, availableQty: 0, lockedQty: 773 }], false)).toBe(0);
    expect(buildableKits([{ ...base, availableQty: 9 }, { ...base, componentQty: 1, availableQty: 3 }], false)).toBe(3);
    expect(buildableKits([{ ...base, availableQty: 1, allocatedQty: 4 }], true)).toBe(2);
  });

  it("disables Retry allocation when the shortfall is locked or still short", () => {
    const locked = coverageSummary([{ ...base, lockedQty: 5, lockedBy: ["CNT000147"] }], true);
    expect(retryAllocationReason(locked)).toMatch(/locked by count plan CNT000147/);
    expect(retryAllocationReason(coverageSummary([base], true))).toMatch(/doesn't cover C-1/);
    expect(retryAllocationReason(coverageSummary([{ ...base, shortQty: 0, availableQty: 10 }], true))).toBeNull();
  });

  it("gates Create Kit (without picking) when not one kit can be built, naming the plan", () => {
    const wo = { type: "Work Order without Picking", requestedQty: 5, processedQty: 0, status: "Open" };
    expect(createKitStockReason(wo, [{ ...base, locationId: "l", locationCode: "D-02-01-2", sourceLockedBy: "CNT000148" }])).toMatch(/locked by count plan CNT000148/);
    expect(createKitStockReason(wo, [{ ...base, availableQty: 1 }])).toMatch(/needs 2, 1 usable/);
    expect(createKitStockReason(wo, [{ ...base, availableQty: 2 }])).toBeNull();
    expect(createKitStockReason({ ...wo, type: "Work Order with Picking" }, [base])).toBeNull();
  });

  it("uses terminal copy and honest source labels", () => {
    expect(terminalBuildCopy({ status: "Cancelled", processedQty: 0, requestedQty: 3 }, "11/10/2026 05:06 AM CST")).toBe("Cancelled 11/10/2026 05:06 AM CST · 0 of 3 built");
    expect(terminalBuildCopy({ status: "Open", processedQty: 0, requestedQty: 3 }, null)).toBeNull();
    const c = { locationCode: null, lpNumber: null, lotNumber: null, allocatedQty: 0, consumedQty: 0 };
    expect(sourceLabel(c, true)).toBe("FEFO at allocation");
    expect(sourceLabel({ ...c, allocatedQty: 2 }, true)).toBe("Allocated FEFO");
    expect(sourceLabel({ ...c, locationCode: "A-01-01", lotNumber: "L1" }, false)).toBe("A-01-01 · lot L1");
  });

  it("rejects decimal kit quantities instead of rounding", () => {
    expect(kitQtyError(2.5)).toBe("Whole kits only");
    expect(kitQtyError(-5)).toBe("At least 1");
  });
});

let w: KitWorld;
beforeEach(() => { w = createKitWorld(); });
afterEach(() => w.close());

function lockLocation(locationId: string, code: string): void {
  const plan = w.db.insert(schema.countPlans).values({ code, warehouseId: w.warehouseId, scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", status: "Ready To Count" }).returning().get();
  w.db.insert(schema.countPlanLines).values({ planId: plan.id, locationId, status: "Pending" }).run();
}

describe("lock-aware availability (DB)", () => {
  it("reports usable vs count-locked free stock per product", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.productId, 6, w.loc.storageB);
    lockLocation(w.loc.storageA, "CNT-R8-1");
    const av = componentAvailability(w.db as never, { warehouseId: w.warehouseId, clientId: w.clientId, productIds: [w.productId, w.product2Id] });
    expect(av.get(w.productId)).toEqual({ usableQty: 6, lockedQty: 40, blockedQty: 0, lockedBy: ["CNT-R8-1"] });
    expect(av.get(w.product2Id)?.usableQty).toBe(0);
  });

  it("kit card and Kit Inventory capacity use usable stock only", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    expect(getKitDetail(w.db, w.scope, w.kitId, w.warehouseId).netKittingCapacity).toBe(20);
    lockLocation(w.loc.storageA, "CNT-R8-2");
    const kit = getKitDetail(w.db, w.scope, w.kitId, w.warehouseId);
    expect(kit.netKittingCapacity).toBe(0);
    expect(kit.components.find((c) => c.productId === w.productId)).toMatchObject({ freeQty: 0, lockedQty: 40, lockedBy: ["CNT-R8-2"] });
    const stats = computeKitStats(w.db).find((s) => s.kitProductId === w.kitId && s.warehouseId === w.warehouseId);
    expect(stats?.netKittingCapacity).toBe(0);
  });

  it("detail components show the lock, short qty and the kit/component barcodes", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    const row = createWorkOrder(w.db, w.wctx, woInput(w));
    lockLocation(w.loc.storageA, "CNT-R8-3");
    const d = getWorkOrderDetail(w.db, w.scope, row.id);
    const widget = d.components.find((c) => c.componentProductId === w.productId);
    expect(widget).toMatchObject({ sourceLockedBy: "CNT-R8-3", availableQty: 0, shortQty: 10, lockedQty: 40 });
    expect(componentCoverage(widget!).state).toBe("locked");
    expect(createKitStockReason(d.workOrder, d.components)).toMatch(/CNT-R8-3/);
    expect(d.kit.barcode).toBe("MLT-KIT-2PK");
    expect("barcode" in widget!).toBe(true);
  });

  it("checks code availability (excluding the record itself)", () => {
    stock(w, w.productId, 40, w.loc.storageA);
    stock(w, w.product2Id, 20, w.loc.storageA);
    const row = createWorkOrder(w.db, w.wctx, woInput(w));
    expect(isWorkOrderCodeAvailable(w.db, row.code)).toBe(false);
    expect(isWorkOrderCodeAvailable(w.db, row.code, row.id)).toBe(true);
    expect(isWorkOrderCodeAvailable(w.db, "KS-NEW-CODE")).toBe(true);
  });
});
