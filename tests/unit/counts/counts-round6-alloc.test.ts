/**
 * Round 6 (critic r5 blocker): a count that finds less than is allocated must never dead-end.
 * Unpicked allocations are shorted (exception on the order); committed stock blocks the line,
 * which the confirm lists and Update Inv. closes without posting; Cancel works on counted plans.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { allocationShortfall, lineCancelReason, planCancelReason, unitsLabel } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders/create-update";
import { countLockFor } from "@/server/repositories/counts-lock";
import { createCountJobs } from "@/server/repositories/counts-jobs";
import { cancelCountLines, cancelCountPlans, updateInventoryForLines, updateInventoryForPlans, varianceSummary } from "@/server/repositories/counts-ops";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { countSheet, submitSheetLine } from "@/server/repositories/counts-sheet";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cycleType: string;
let rid: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(["inventory.count_plans.delete"]), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  rid = w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Count variance" }).returning().get().id;
  cycleType = w.db.insert(schema.jobTypes).values({ code: "Cycle Count", description: "Cycle", warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count: {} }) }).returning().get().id;
});
afterEach(() => w.close());

const bucketAt = (locationId: string) => w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, locationId)).all()[0];
const planRow = (id: string) => w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
const lineOf = (planId: string) => w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, planId)).all()[0];

/** 9 on hand at storage A, 7 of them allocated to one order (status as given). */
function allocatedStock(status: "Allocated" | "Picked" = "Allocated") {
  const bucket = ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 9 }).bucket;
  const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 7 }]));
  const orderLine = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).get();
  const { allocation } = ledger.allocate(w.db, w.ctx, { inventoryId: bucket.id, qty: 7, orderId: order.id, orderLineId: orderLine?.id ?? null });
  w.db.update(schema.orderLines).set({ allocatedQuantity: 7 }).where(eq(schema.orderLines.id, orderLine?.id ?? "")).run();
  if (status !== "Allocated") w.db.update(schema.inventoryAllocations).set({ status }).where(eq(schema.inventoryAllocations.id, allocation.id)).run();
  return { bucket, order, orderLineId: orderLine?.id ?? "", allocationId: allocation.id };
}

/** Lock Locations plan on storage A, counted at `qty`. */
function countedPlan(qty: number, code = "KS-R6-ALLOC") {
  const p = createCountPlan(w.db, w.ctx, auth, { code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", locationIds: [w.loc.storageA], productIds: [] });
  expect(createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null }).failed).toEqual([]);
  const line = lineOf(p.id);
  const sheet = countSheet(w.db, auth.scope, p.id).find((l) => l.lineId === line?.id);
  submitSheetLine(w.db, w.ctx, auth, p.id, { lineId: line?.id ?? "", entries: (sheet?.buckets ?? []).map((b) => ({ inventoryId: b.inventoryId, countedQty: qty })), note: null });
  expect(lineOf(p.id)?.status).toBe("Count Completed");
  return p;
}

describe("allocationShortfall (pure)", () => {
  it("shorts releasable allocations first and reports what stays committed", () => {
    expect(allocationShortfall({ allocated: 7, releasable: 7, target: 6 })).toEqual({ release: 1, unpostable: 0 });
    expect(allocationShortfall({ allocated: 2, releasable: 0, target: 1 })).toEqual({ release: 0, unpostable: 1 });
    expect(allocationShortfall({ allocated: 7, releasable: 3, target: 2 })).toEqual({ release: 3, unpostable: 2 });
    expect(allocationShortfall({ allocated: 2, releasable: 2, target: 5 })).toEqual({ release: 0, unpostable: 0 });
  });
  it("labels units with plurals", () => {
    expect(unitsLabel(1)).toBe("1 unit");
    expect(unitsLabel(0)).toBe("0 units");
    expect(unitsLabel(2, ["line", "lines"])).toBe("2 lines");
  });
  it("allows Cancel on Count Completed plans and lines (Logiwa parity)", () => {
    expect(planCancelReason("Count Completed")).toBeNull();
    expect(lineCancelReason("Count Completed")).toBeNull();
    expect(lineCancelReason("Inventory Updated")).toMatch(/can't be cancelled/);
  });
});

describe("Update Inv. against allocated stock", () => {
  it("shorts an unpicked allocation, posts the shortage and writes an allocation exception", () => {
    const { bucket, order, orderLineId, allocationId } = allocatedStock("Allocated");
    const p = countedPlan(6);
    const v = varianceSummary(w.db, auth, { level: "plan", ids: [p.id] });
    expect(v.allocationBlocked).toEqual([]);
    expect(v.unitsUnallocated).toBe(1);
    expect(v.rows[0]).toMatchObject({ allocated: 7, unallocates: 1, blocked: false, delta: -3 });
    expect(updateInventoryForPlans(w.db, w.ctx, auth, [p.id], rid).failed).toEqual([]);
    expect(planRow(p.id)?.status).toBe("Inventory Updated");
    const after = w.db.select().from(schema.inventory).where(eq(schema.inventory.id, bucket.id)).get();
    expect(after?.onHand).toBe(6);
    expect(after?.allocated).toBe(6);
    expect(w.db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.id, allocationId)).get()?.qty).toBe(6);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.id, orderLineId)).get()?.allocatedQuantity).toBe(6);
    const exc = w.db.select().from(schema.allocationExceptions).where(eq(schema.allocationExceptions.orderId, order.id)).all();
    expect(exc.some((e) => e.waveNo === "Cycle Count" && /Count shortage: count plan KS-R6-ALLOC/.test(e.explanation))).toBe(true);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
    expect(countLockFor(w.db, w.loc.storageA)).toBeNull();
    const events = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.field, "count_event")).all().map((e) => e.toValue ?? "");
    expect(events.some((t) => /Count shortage shorted allocations · .* −1/.test(t))).toBe(true);
  });

  it("lists committed (picked) stock as blocked, refuses a silent post, then closes the line without posting", () => {
    allocatedStock("Picked");
    const p = countedPlan(6);
    const v = varianceSummary(w.db, auth, { level: "plan", ids: [p.id] });
    expect(v.allocationBlocked).toHaveLength(1);
    expect(v.allocationBlocked[0]?.units).toBe(1);
    expect(v.allocationBlocked[0]?.holders).toMatch(/\(Picked, 7\)/);
    expect(v.unitsDown).toBe(0);
    const refused = updateInventoryForPlans(w.db, w.ctx, auth, [p.id], rid);
    expect(refused.failed[0]?.message).toMatch(/committed to/);
    expect(planRow(p.id)?.status).toBe("Count Completed");
    expect(updateInventoryForPlans(w.db, w.ctx, auth, [p.id], rid, "Picked stock still on the tote", true).failed).toEqual([]);
    expect(lineOf(p.id)?.status).toBe("Cancelled");
    expect(planRow(p.id)?.status).toBe("Cancelled");
    expect(bucketAt(w.loc.storageA)?.onHand).toBe(9);
    expect(countLockFor(w.db, w.loc.storageA)).toBeNull();
    const events = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.field, "count_event")).all().map((e) => e.toValue ?? "");
    expect(events.some((t) => t.startsWith("Closed without posting") && /reason Count variance/.test(t))).toBe(true);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("line-level Update Inv. closes a blocked line on request", () => {
    allocatedStock("Picked");
    const p = countedPlan(6);
    const line = lineOf(p.id);
    expect(updateInventoryForLines(w.db, w.ctx, auth, [line?.id ?? ""], rid).failed[0]?.code).toBe("INSUFFICIENT_STOCK");
    expect(updateInventoryForLines(w.db, w.ctx, auth, [line?.id ?? ""], rid, null, true).failed).toEqual([]);
    expect(lineOf(p.id)?.status).toBe("Cancelled");
  });
});

describe("Cancel on counted plans and lines", () => {
  it("needs a reason to discard counted results and releases the lock", () => {
    allocatedStock("Picked");
    const p = countedPlan(6);
    expect(cancelCountPlans(w.db, w.ctx, auth, [p.id]).failed[0]?.code).toBe("VALIDATION");
    expect(planRow(p.id)?.status).toBe("Count Completed");
    expect(cancelCountPlans(w.db, w.ctx, auth, [p.id], "Recount next shift").failed).toEqual([]);
    expect(planRow(p.id)?.status).toBe("Cancelled");
    expect(countLockFor(w.db, w.loc.storageA)).toBeNull();
    const events = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.field, "count_event")).all().map((e) => e.toValue ?? "");
    expect(events.some((t) => /1 counted line discarded without posting · reason: Recount next shift/.test(t))).toBe(true);
  });

  it("cancels a counted line with a reason", () => {
    allocatedStock("Picked");
    const p = countedPlan(6, "KS-R6-LINE");
    const line = lineOf(p.id);
    expect(cancelCountLines(w.db, w.ctx, auth, [line?.id ?? ""]).failed[0]?.code).toBe("VALIDATION");
    expect(cancelCountLines(w.db, w.ctx, auth, [line?.id ?? ""], "Miscount").failed).toEqual([]);
    expect(lineOf(p.id)?.status).toBe("Cancelled");
    expect(planRow(p.id)?.status).toBe("Cancelled");
  });
});

describe("handheld Your jobs / Job pool (Logiwa mobile Cycle Count)", () => {
  it("lists unassigned jobs in the pool, Take job moves it to Your jobs, a second taker gets a conflict", async () => {
    const { listScanJobs, takeScanJob } = await import("@/server/repositories/counts-scan-jobs");
    const { COUNT_PERMISSIONS: P } = await import("@/lib/grid-defs/counts/count-grids");
    const counter = { ...auth, permissions: new Set<string>([P.mobileYourJobs, P.mobileJobPool, P.mobileCount]) } as unknown as AuthContext;
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 3 });
    const p = createCountPlan(w.db, w.ctx, auth, { code: "KS-R6-POOL", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageA], productIds: [] });
    expect(createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null }).failed).toEqual([]);
    const pool = listScanJobs(w.db, counter, "pool");
    expect(pool.map((j) => j.planCode)).toContain("KS-R6-POOL");
    expect(listScanJobs(w.db, counter, "mine")).toEqual([]);
    const job = pool.find((j) => j.planCode === "KS-R6-POOL");
    const taken = takeScanJob(w.db, w.ctx, counter, job?.id ?? "");
    expect(taken.assigneeUserId).toBe(w.userId);
    expect(listScanJobs(w.db, counter, "mine").map((j) => j.id)).toEqual([job?.id]);
    expect(listScanJobs(w.db, counter, "pool").some((j) => j.id === job?.id)).toBe(false);
    const other = w.db.insert(schema.users).values({ email: "other@example.com", name: "Other Counter", passwordHash: "x", role: "operator" }).returning().get();
    const otherAuth = { ...counter, user: { id: other.id } } as unknown as AuthContext;
    expect(() => takeScanJob(w.db, w.ctx, otherAuth, job?.id ?? "")).toThrow(/just taken by/);
    const noPerm = { ...auth, permissions: new Set<string>() } as unknown as AuthContext;
    expect(() => listScanJobs(w.db, noPerm, "pool")).toThrow();
  });
});

describe("db:verify count checks", () => {
  it("reports every count invariant in the VerifyIssue shape (clean world = none)", async () => {
    const { countIntegrityIssues } = await import("@/server/repositories/counts-integrity");
    expect(countIntegrityIssues(w.db)).toEqual([]);
  });
});
