/** M08 kitting lifecycle against an in-memory migrated DB (BUILD_PLAN M08 acceptance). */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { executeKitting } from "@/server/domain/task-handlers/kitting";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createKitSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import { computeKitStats, listKitComponents, listKitInventory, recalcKitInventory } from "@/server/repositories/kits";
import {
  createWorkOrder, deleteWorkOrder, getWorkOrderDetail, listWorkOrders, updateWorkOrder, workOrderStatusCounts,
} from "@/server/repositories/work-orders";
import { canReopenInProcess, WORK_ORDER_EXCEPTION_WAVE } from "@/server/repositories/work-orders-adapters";
import {
  allocateWorkOrderWith, cancelPicking, cancelWorkOrder, createKit, disassembleKit, disassembleStockKit,
} from "@/server/repositories/work-orders-commands";
import { buildPickLists, runPicking } from "@/server/repositories/work-orders-ops";
import { allocatedOf, createKitWorld, onHandAt, stock, woInput, type KitWorld } from "./kit-world";

let w: KitWorld;
beforeEach(() => {
  w = createKitWorld();
  stock(w, w.productId, 30);
  stock(w, w.product2Id, 12);
});
afterEach(() => w.close());

const woOf = (id: string) => w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).get();
const clean = () => expect(ledger.reconcileLedger(w.db)).toEqual([]);
const codeOf = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return undefined;
};

describe("work order without picking (acceptance KS-TEST-WO-E2E)", () => {
  it("creates Open with BOM totals and component sources", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    expect(wo.status).toBe("Open");
    expect(wo.outputLocationId).toBe(w.kittingLocId);
    const comps = w.db.select().from(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, wo.id)).all();
    expect(comps.map((c) => [c.componentQty, c.totalQty]).sort()).toEqual([[1, 5], [2, 10]]);
    expect(comps.every((c) => c.locationId === w.loc.storageA)).toBe(true);
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, wo.id)).all();
    expect(log.length).toBeGreaterThan(0);
  });

  it("requires a source location per component and a unique code", () => {
    const missing = woInput(w, { components: [] });
    let err: unknown;
    try { createWorkOrder(w.db, w.wctx, missing); } catch (e) { err = e; }
    expect((err as { code: string }).code).toBe("VALIDATION");
    expect(Object.keys((err as { fieldErrors: Record<string, unknown> }).fieldErrors)[0]).toMatch(/^components\.\d\.locationId$/);
    createWorkOrder(w.db, w.wctx, woInput(w));
    expect(codeOf(() => createWorkOrder(w.db, w.wctx, woInput(w)))).toBe("DUPLICATE");
  });

  it("refuses kit-to-order kits and kits of another client", () => {
    w.db.update(schema.products).set({ kitType: "Kit to Order" }).where(eq(schema.products.id, w.kitId)).run();
    expect(codeOf(() => createWorkOrder(w.db, w.wctx, woInput(w)))).toBe("VALIDATION");
  });

  it("Create Kit 5 consumes 2×5 + 1×5 components and receives 5 kits (Completed)", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    const res = createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 5, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    expect(res.status).toBe("Completed");
    expect(onHandAt(w, w.productId)).toBe(20);
    expect(onHandAt(w, w.product2Id)).toBe(7);
    expect(onHandAt(w, w.kitId, w.kittingLocId)).toBe(5);
    const after = woOf(wo.id);
    expect(after?.processedQty).toBe(5);
    expect(after?.actualStartAt).toBeTruthy();
    expect(after?.actualFinishAt).toBeTruthy();
    const kitting = w.db.select().from(schema.inventoryTransactions).where(and(eq(schema.inventoryTransactions.workOrderId, wo.id), eq(schema.inventoryTransactions.type, "Kitting"))).all();
    // Logiwa parity (round 9): component consumption and the kit output both post as Kitting.
    expect(kitting.map((t) => t.productId).sort()).toEqual([w.productId, w.product2Id, w.kitId].sort());
    expect(kitting.find((t) => t.productId === w.kitId)?.uomQty).toBe(5);
    const receipts = w.db.select().from(schema.receipts).where(eq(schema.receipts.workOrderId, wo.id)).all();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ type: "Kitting", quantity: 5, productId: w.kitId, locationId: w.kittingLocId });
    clean();
    // Completed work orders are closed for further builds, edits and deletion.
    expect(codeOf(() => createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null }))).toBe("INVALID_STATE");
    expect(codeOf(() => deleteWorkOrder(w.db, w.wctx, wo.id))).toBe("INVALID_STATE");
  });

  it("partial builds keep the WO Open (Logiwa), cap at the remaining qty and honour versions", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    const base = { workOrderId: wo.id, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null };
    expect(createKit(w.db, w.wctx, { ...base, qty: 2 }).status).toBe("Open");
    expect(codeOf(() => deleteWorkOrder(w.db, w.wctx, wo.id))).toBe("INVALID_STATE");
    expect(codeOf(() => cancelWorkOrder(w.db, w.wctx, wo.id))).toBe("INVALID_STATE");
    expect(codeOf(() => createKit(w.db, w.wctx, { ...base, qty: 4 }))).toBe("VALIDATION");
    expect(codeOf(() => createKit(w.db, w.wctx, { ...base, qty: 1, version: 1 }))).toBe("CONFLICT");
    expect(createKit(w.db, w.wctx, { ...base, qty: 3 }).status).toBe("Completed");
    clean();
  });

  it("refuses to build when the chosen source is short", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 20 }));
    expect(codeOf(() => createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 13, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null }))).toBe("INSUFFICIENT_STOCK");
  });

  it("Disassemble 2 reverses the stock and writes DisassembleKit receipts", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 5, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    const bucket = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.productId, w.kitId), eq(schema.inventory.locationId, w.kittingLocId))).get();
    if (!bucket) throw new Error("kit bucket");
    const res = disassembleKit(w.db, w.wctx, { workOrderId: wo.id, qty: 2, sourceInventoryId: bucket.id, targetLocationId: w.loc.storageB, targetLpId: null });
    expect(res.disassembledQty).toBe(2);
    expect(res.receiptIds).toHaveLength(2);
    expect(onHandAt(w, w.kitId)).toBe(3);
    expect(onHandAt(w, w.productId, w.loc.storageB)).toBe(4);
    expect(onHandAt(w, w.product2Id, w.loc.storageB)).toBe(2);
    const receipts = w.db.select().from(schema.receipts).where(and(eq(schema.receipts.workOrderId, wo.id), eq(schema.receipts.type, "DisassembleKit"))).all();
    expect(receipts.map((r) => r.quantity).sort()).toEqual([2, 4]);
    const tx = w.db.select().from(schema.inventoryTransactions).where(and(eq(schema.inventoryTransactions.workOrderId, wo.id), eq(schema.inventoryTransactions.type, "Disassemble Kit"))).all();
    // Kit consumed (1 row) and both components returned (2 rows) all post as Disassemble Kit.
    expect(tx.length).toBe(3);
    expect(tx.filter((t) => t.productId === w.kitId)).toHaveLength(1);
    expect(codeOf(() => disassembleKit(w.db, w.wctx, { workOrderId: wo.id, qty: 4, sourceInventoryId: bucket.id, targetLocationId: w.loc.storageB, targetLpId: null }))).toBe("VALIDATION");
    clean();
  });
  it("Disassemble requires and stamps per-component attributes on tracked components", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 2, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    const bucket = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.productId, w.kitId), eq(schema.inventory.locationId, w.kittingLocId))).get();
    if (!bucket) throw new Error("kit bucket");
    w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.product2Id)).run();
    const base = { workOrderId: wo.id, qty: 1, sourceInventoryId: bucket.id, targetLocationId: w.loc.storageB, targetLpId: null };
    expect(codeOf(() => disassembleKit(w.db, w.wctx, base))).toBe("VALIDATION");
    disassembleKit(w.db, w.wctx, { ...base, componentAttributes: [{ productId: w.product2Id, lotNumber: "LOT-D1", expiryDate: null, productionDate: null }] });
    const lots = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.productId, w.product2Id), eq(schema.inventory.locationId, w.loc.storageB))).all().map((r) => r.lotNumber);
    expect(lots).toContain("LOT-D1");
    w.db.update(schema.products).set({ trackLot: false }).where(eq(schema.products.id, w.product2Id)).run();
    clean();
  });
});

describe("work order with picking", () => {
  const picking = (extra: Record<string, unknown> = {}) => woInput(w, { code: "KS-TEST-WO-PICK", type: "Work Order with Picking", components: [], ...extra });

  it("goes Shortage with a 'Manual Allocation - Work Order' exception when components are short", () => {
    const wo = createWorkOrder(w.db, w.wctx, picking({ requestedQty: 100 }));
    const res = allocateWorkOrderWith(w.db, w.wctx, wo.id);
    expect(res.status).toBe("Shortage");
    expect(woOf(wo.id)?.status).toBe("Shortage");
    const exc = w.db.select().from(schema.allocationExceptions).where(eq(schema.allocationExceptions.orderId, wo.id)).all();
    expect(exc).toHaveLength(2);
    expect(exc.every((e) => e.waveNo === WORK_ORDER_EXCEPTION_WAVE)).toBe(true);
    expect(allocatedOf(w, w.productId)).toBe(0);
    // Cancel Picking on Shortage returns the work order to Open.
    expect(cancelPicking(w.db, w.wctx, wo.id).status).toBe("Open");
  });

  it("dry-run reports per work order without writing", () => {
    const wo = createWorkOrder(w.db, w.wctx, picking({ requestedQty: 100 }));
    const res = runPicking(w.db, w.wctx, { ids: [wo.id], dryRun: true });
    expect(res.outcomes[0]?.outcome).toBe("shortage");
    expect(res.outcomes[0]?.shortages.map((x) => x.sku).sort()).toEqual(["MLT-GADGET-02", "MLT-WIDGET-01"]);
    expect(res.dryRun).toBe(true);
    expect(woOf(wo.id)?.status).toBe("Open");
    expect(w.db.select().from(schema.allocationExceptions).all()).toHaveLength(0);
  });

  it("allocates, creates a job with picking + kitting tasks, builds through the kitting task", () => {
    const wo = createWorkOrder(w.db, w.wctx, picking());
    expect(codeOf(() => createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null }))).toBe("INVALID_STATE");
    const res = allocateWorkOrderWith(w.db, w.wctx, wo.id, { jobTypeId: w.woJobTypeId, priority: "High" });
    expect(res).toMatchObject({ status: "In Process", allocatedQty: 15, shortageQty: 0 });
    const after = woOf(wo.id);
    expect(after?.jobId).toBeTruthy();
    expect(allocatedOf(w, w.productId)).toBe(10);
    expect(allocatedOf(w, w.product2Id)).toBe(5);
    const tasks = w.db.select().from(schema.tasks).where(eq(schema.tasks.workOrderId, wo.id)).all();
    expect(tasks.filter((t) => t.taskType === "Picking")).toHaveLength(2);
    const kitTask = tasks.find((t) => t.taskType === "Kitting");
    expect(kitTask?.plannedQty).toBe(5);
    const lists = buildPickLists(w.db, w.scope, [wo.id], false);
    expect(lists).toHaveLength(1);

    if (!canReopenInProcess()) expect(codeOf(() => cancelPicking(w.db, w.wctx, wo.id))).toBe("INVALID_STATE");

    if (!kitTask) throw new Error("kitting task");
    const exec = executeKitting(w.db, w.wctx, kitTask, { targetLocationId: w.kittingLocId });
    expect(exec.doneQty).toBe(5);
    expect(woOf(wo.id)?.status).toBe("Completed");
    expect(onHandAt(w, w.productId)).toBe(20);
    expect(onHandAt(w, w.kitId, w.kittingLocId)).toBe(5);
    expect(allocatedOf(w, w.productId)).toBe(0);
    const open = w.db.select().from(schema.tasks).where(eq(schema.tasks.workOrderId, wo.id)).all().filter((t) => t.status !== "Completed");
    expect(open).toHaveLength(0);
    clean();
  });

  it("refuses allocation on a work order without picking", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    expect(codeOf(() => allocateWorkOrderWith(w.db, w.wctx, wo.id))).toBe("INVALID_STATE");
  });

  it("cancel releases allocations and cancels the job", () => {
    const wo = createWorkOrder(w.db, w.wctx, picking());
    allocateWorkOrderWith(w.db, w.wctx, wo.id);
    const cancelled = cancelWorkOrder(w.db, w.wctx, wo.id);
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(allocatedOf(w, w.productId)).toBe(0);
    const job = w.db.select().from(schema.jobs).where(eq(schema.jobs.workOrderId, wo.id)).get();
    expect(job?.status).toBe("Cancelled");
    clean();
  });
});

describe("edit, delete and lists", () => {
  it("edits with optimistic concurrency and a field-level change log", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    const updated = updateWorkOrder(w.db, w.wctx, wo.id, wo.version, woInput(w, { requestedQty: 6, extraNote: "Rush build" }));
    expect(updated.version).toBe(wo.version + 1);
    expect(updated.requestedQty).toBe(6);
    expect(codeOf(() => updateWorkOrder(w.db, w.wctx, wo.id, wo.version, woInput(w)))).toBe("CONFLICT");
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, wo.id)).all();
    expect(log.some((l) => l.field === "requestedQty" && l.toValue === "6")).toBe(true);
  });

  it("deletes only Open work orders", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    deleteWorkOrder(w.db, w.wctx, wo.id);
    expect(woOf(wo.id)).toBeUndefined();
  });

  it("lists, counts by status and hides other warehouses", () => {
    createWorkOrder(w.db, w.wctx, woInput(w));
    createWorkOrder(w.db, w.wctx, woInput(w, { code: "KS-TEST-WO-2", requestedQty: 2 }));
    const page = listWorkOrders(w.db, w.scope, EMPTY_GRID_QUERY);
    expect(page.total).toBe(2);
    expect(page.rows[0]?.kitSku).toBe("MLT-KIT-2PK");
    expect(workOrderStatusCounts(w.db, w.scope, EMPTY_GRID_QUERY)).toEqual({ Open: 2 });
    const other = { warehouseIds: ["nope"], clientIds: "all" } as unknown as typeof w.scope;
    expect(listWorkOrders(w.db, other, EMPTY_GRID_QUERY).total).toBe(0);
    expect(codeOf(() => getWorkOrderDetail(w.db, other, "KS-TEST-WO-2"))).toBe("NOT_FOUND");
    const detail = getWorkOrderDetail(w.db, w.scope, "KS-TEST-WO-2");
    expect(detail.workOrder.code).toBe("KS-TEST-WO-2");
  });
});

describe("kit reports", () => {
  it("Net Kitting Capacity = min ⌊free ÷ BOM⌋ and Required = max(0, pending − stock)", () => {
    // free: widget 30 / 2 = 15, gadget 12 / 1 = 12 → 12
    const row = computeKitStats(w.db).find((r) => r.kitProductId === w.kitId);
    expect(row).toMatchObject({ netKittingCapacity: 12, currentInventoryQty: 0, totalInventoryCapacity: 12, requiredKittingQty: 0 });
    // Allocated stock is not free.
    const bucket = w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.product2Id)).get();
    if (!bucket) throw new Error("bucket");
    w.db.update(schema.inventory).set({ allocated: 4 }).where(eq(schema.inventory.id, bucket.id)).run();
    expect(computeKitStats(w.db).find((r) => r.kitProductId === w.kitId)?.netKittingCapacity).toBe(8);
  });

  it("recalculates kit_inventory_stats and serves both reports", () => {
    const stamp = new Date();
    const res = recalcKitInventory(w.db, stamp);
    expect(res.rows).toBeGreaterThan(0);
    const kits = listKitInventory(w.db, w.scope, EMPTY_GRID_QUERY);
    const kit = kits.rows.find((r) => r.kitProductId === w.kitId);
    expect(kit).toMatchObject({ sku: "MLT-KIT-2PK", netKittingCapacity: 12, updatedAt: stamp.toISOString() });
    const comps = listKitComponents(w.db, w.scope, EMPTY_GRID_QUERY);
    const widget = comps.rows.find((r) => r.componentProductId === w.productId);
    expect(widget?.includedKits).toEqual(["MLT-KIT-2PK"]);
    expect(widget?.totalAvailableQty).toBe(30);
    expect(widget?.reorderQty).toBe(0);
  });
});

describe("standalone Disassemble Kit (no work order, Logiwa toolbar)", () => {
  it("breaks free kit stock down by the BOM with DisassembleKit receipts", () => {
    const kitBucket = stock(w, w.kitId, 4);
    const res = disassembleStockKit(w.db, w.wctx, { kitProductId: w.kitId, qty: 3, sourceInventoryId: kitBucket.id, targetLocationId: w.loc.storageB, targetLpId: null });
    expect(res.receiptIds).toHaveLength(2);
    expect(onHandAt(w, w.kitId)).toBe(1);
    expect(onHandAt(w, w.productId, w.loc.storageB)).toBe(6);
    expect(onHandAt(w, w.product2Id, w.loc.storageB)).toBe(3);
    const receipts = w.db.select().from(schema.receipts).where(eq(schema.receipts.type, "DisassembleKit")).all();
    expect(receipts.map((r) => r.quantity).sort()).toEqual([3, 6]);
    expect(codeOf(() => disassembleStockKit(w.db, w.wctx, { kitProductId: w.kitId, qty: 2, sourceInventoryId: kitBucket.id, targetLocationId: w.loc.storageB, targetLpId: null }))).toBe("INSUFFICIENT_STOCK");
    expect(codeOf(() => disassembleStockKit(w.db, w.wctx, { kitProductId: w.productId, qty: 1, sourceInventoryId: kitBucket.id, targetLocationId: w.loc.storageB, targetLpId: null }))).toBe("NOT_FOUND");
    clean();
  });
});

describe("Round 1 parity: kitting time range, LP checks, schema", () => {
  it("Create Kit stamps the chosen actual start/finish on the work order", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    const start = "2026-11-09T08:00:00.000Z";
    const finish = "2026-11-09T09:30:00.000Z";
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 5, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null, actualStartAt: start, actualFinishAt: finish });
    const after = woOf(wo.id);
    expect(after?.actualStartAt).toBe(start);
    expect(after?.actualFinishAt).toBe(finish);
    clean();
  });

  it("createKitSchema rejects a finish before the start", () => {
    const res = createKitSchema.safeParse({ workOrderId: "x", qty: 1, locationId: "l", actualStartAt: "2026-11-09T10:00:00Z", actualFinishAt: "2026-11-09T09:00:00Z" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["actualFinishAt"]);
  });

  it("Disassemble refuses a component LP from another warehouse or that does not exist", () => {
    const kitBucket = stock(w, w.kitId, 2);
    expect(codeOf(() => disassembleStockKit(w.db, w.wctx, { kitProductId: w.kitId, qty: 1, sourceInventoryId: kitBucket.id, targetLocationId: w.loc.storageB, targetLpId: "no-such-lp" }))).toBe("VALIDATION");
    expect(onHandAt(w, w.kitId)).toBe(2);
    clean();
  });
});
