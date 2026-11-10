/**
 * Round 3 (parity loop): one open count per location / SKU, Lock Locations against other plans,
 * orphaned lines after a job cancel, and the four-eyes rule on count variances.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { orphanedLinesMessage, planCreateJobReason, planUpdateInvReason, selfApprovalReason } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import * as jobs from "@/server/domain/jobs";
import * as tasks from "@/server/domain/tasks";
import { ledger } from "@/server/domain/ledger";
import { createCountPlanFromWave } from "@/server/repositories/counts-commands";
import { foreignCountLock, openCountConflicts } from "@/server/repositories/counts-conflicts";
import { createCountJobs, orphanedLines, previewCountJobs } from "@/server/repositories/counts-jobs";
import { updateInventoryForLines, updateInventoryForPlans, varianceSummary } from "@/server/repositories/counts-ops";
import { countPlansById, createCountPlan, updateCountPlan } from "@/server/repositories/counts-plans";
import { countSheet, createInstantCount, instantLocation, submitSheetLine } from "@/server/repositories/counts-sheet";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let supervisor: AuthContext;
let operator: AuthContext;
let cycleType: string;
let rid: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  const base = { scope, viewScope: scope, restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } };
  supervisor = { ...base, permissions: new Set<string>(["inventory.count_plans.delete"]) } as unknown as AuthContext;
  operator = { ...base, permissions: new Set<string>(["inventory.count_plans.update_inv"]) } as unknown as AuthContext;
  const jt = (code: string, count: Record<string, boolean>) => w.db.insert(schema.jobTypes).values({
    code, description: code, warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count }),
  }).returning().get().id;
  rid = w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Count variance" }).returning().get().id;
  cycleType = jt("Cycle Count", {});
  jt("Instant Count", { instantCount: true });
});
afterEach(() => w.close());

const stock = (qty: number, locationId: string, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty }).bucket;
const planRow = (id: string) => w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
const linesOf = (id: string) => w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id)).all();

function locPlan(code: string, locationIds: string[], lockLocations = false) {
  return createCountPlan(w.db, w.ctx, supervisor, { code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations, countType: "Location", locationIds, productIds: [] });
}
function skuPlan(code: string, lockLocations = false) {
  return createCountPlan(w.db, w.ctx, supervisor, { code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations, countType: "SKU", locationIds: [], productIds: [w.productId] });
}
function countAll(planId: string, qty: number) {
  for (const l of countSheet(w.db, supervisor.scope, planId)) {
    submitSheetLine(w.db, w.ctx, supervisor, planId, { lineId: l.lineId, entries: l.buckets.map((b) => ({ inventoryId: b.inventoryId, countedQty: qty })), note: null });
  }
}

describe("one open count per location / SKU", () => {
  it("rejects a second open plan on the same location, naming the plan", () => {
    stock(5, w.loc.storageA);
    locPlan("R3-A", [w.loc.storageA], true);
    expect(() => locPlan("R3-B", [w.loc.storageA, w.loc.storageB])).toThrow(/already in an open count plan: A-01-01 \(R3-A\)/);
    expect(openCountConflicts(w.db, { warehouseId: w.warehouseId, locationIds: [w.loc.storageA, w.loc.storageB] }).map((c) => c.planCode)).toEqual(["R3-A"]);
  });

  it("rejects a second open SKU plan for the same SKU, but frees it once the first is cancelled", () => {
    stock(5, w.loc.storageA);
    const a = skuPlan("R3-S1");
    expect(() => skuPlan("R3-S2")).toThrow(/R3-S1/);
    w.db.update(schema.countPlans).set({ status: "Cancelled" }).where(eq(schema.countPlans.id, a.id)).run();
    expect(skuPlan("R3-S2").code).toBe("R3-S2");
  });

  it("an edit keeps its own lines but cannot add another plan's location", () => {
    const a = locPlan("R3-E1", [w.loc.storageA]);
    locPlan("R3-E2", [w.loc.storageB]);
    const v = planRow(a.id)?.version ?? 1;
    const input = { code: "R3-E1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location" as const, productIds: [] };
    expect(updateCountPlan(w.db, w.ctx, supervisor, a.id, { ...input, version: v, locationIds: [w.loc.storageA] }).code).toBe("R3-E1");
    expect(() => updateCountPlan(w.db, w.ctx, supervisor, a.id, { ...input, version: planRow(a.id)?.version ?? v, locationIds: [w.loc.storageA, w.loc.storageB] })).toThrow(/R3-E2/);
  });

  it("a cycle-count wave skips locations that are already in an open count", () => {
    stock(5, w.loc.storageA);
    stock(5, w.loc.storageB);
    locPlan("R3-W1", [w.loc.storageA]);
    const wave = w.db.insert(schema.waveRules).values({ ruleSeq: 1, name: "CC", warehouseId: w.warehouseId, operationType: "Cycle Count" } as never).returning().get();
    const res = createCountPlanFromWave(w.db, w.ctx, { warehouseId: w.warehouseId, waveId: "none", waveRuleId: wave.id, countType: "Location", locationIds: [w.loc.storageA, w.loc.storageB], jobTypeId: cycleType });
    expect(res.lineCount).toBe(1);
    expect(linesOf(res.countPlanId).map((l) => l.locationId)).toEqual([w.loc.storageB]);
  });
});

describe("Lock Locations holds against other plans", () => {
  it("another plan cannot post into a location a locking plan holds; the holder can", () => {
    stock(9, w.loc.storageA);
    const holder = locPlan("R3-L1", [w.loc.storageA], true);
    // Legacy overlap (created before the guard existed): insert a second plan on the same location directly.
    const other = w.db.insert(schema.countPlans).values({ code: "R3-L2", warehouseId: w.warehouseId, scheduledAt: new Date().toISOString(), countType: "Location", operationType: "Cycle Count", status: "Pending", lockLocations: false }).returning().get();
    w.db.insert(schema.countPlanLines).values({ planId: other.id, locationId: w.loc.storageA, status: "Pending", initialStockQty: 9 }).run();
    expect(foreignCountLock(w.db, other, w.loc.storageA)).toBe("R3-L1");
    expect(foreignCountLock(w.db, planRow(holder.id)!, w.loc.storageA)).toBeNull();
    createCountJobs(w.db, w.ctx, supervisor, { ids: [other.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    countAll(other.id, 13);
    const res = updateInventoryForPlans(w.db, w.ctx, supervisor, [other.id], rid);
    expect(res.failed[0]?.message).toMatch(/A-01-01 is locked by count plan R3-L1/);
    expect(w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageA)).all().reduce((s, b) => s + b.onHand, 0)).toBe(9);
  });

  it("Quick Count refuses a location held by a Lock Locations plan and reports the lock on lookup", () => {
    const b = stock(4, w.loc.storageA);
    locPlan("R3-Q1", [w.loc.storageA], true);
    expect(instantLocation(w.db, supervisor.scope, w.warehouseId, "A-01-01").lockedBy).toBe("R3-Q1");
    expect(() => createInstantCount(w.db, w.ctx, supervisor, { warehouseId: w.warehouseId, locationId: w.loc.storageA, entries: [{ inventoryId: b.id, countedQty: 5 }], note: null, updateInventory: true, reasonId: rid }, true))
      .toThrow(/locked by count plan R3-Q1/);
  });
});

describe("orphaned lines after a count job is cancelled", () => {
  it("offers Create Job again and re-issues tasks for exactly the orphaned lines", () => {
    stock(5, w.loc.storageA);
    stock(5, w.loc.storageB);
    const p = locPlan("R3-O1", [w.loc.storageA, w.loc.storageB], true);
    const { jobIds } = createCountJobs(w.db, w.ctx, supervisor, { ids: [p.id], jobTypeId: cycleType, batchSize: 1, assigneeUserId: null });
    expect(jobIds).toHaveLength(2);
    const first = jobIds[0]!;
    const pendingTasks = w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, first)).all().map((t) => t.id);
    tasks.cancel(w.db, w.ctx, { taskIds: pendingTasks });
    jobs.cancelJob(w.db, w.ctx, { jobId: first });
    expect(orphanedLines(w.db, p.id)).toHaveLength(1);
    const row = countPlansById(w.db, supervisor.scope, [p.id])[0]!;
    expect(row.status).toBe("Ready To Count");
    expect(row.orphanedLineCount).toBe(1);
    expect(planCreateJobReason(row.status, row.orphanedLineCount)).toBeNull();
    expect(previewCountJobs(w.db, supervisor, [p.id])[0]?.units).toBe(1);
    const again = createCountJobs(w.db, w.ctx, supervisor, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    expect(again.failed).toEqual([]);
    expect(again.jobIds).toHaveLength(1);
    expect(orphanedLines(w.db, p.id)).toHaveLength(0);
    expect(countSheet(w.db, supervisor.scope, p.id).every((l) => l.taskId)).toBe(true);
    // Nothing orphaned now: Create Job is refused again.
    expect(createCountJobs(w.db, w.ctx, supervisor, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null }).failed[0]?.code).toBe("INVALID_STATE");
  });

  it("guards and copy", () => {
    expect(planCreateJobReason("Ready To Count", 0)).not.toBeNull();
    expect(planCreateJobReason("Count Started", 3)).toBeNull();
    expect(planCreateJobReason("Count Completed", 3)).not.toBeNull();
    expect(orphanedLinesMessage(0)).toBeNull();
    expect(orphanedLinesMessage(50)).toMatch(/50 lines have no count task/);
  });
});

describe("four-eyes rule on count variances", () => {
  it("a counter without supervisor rights cannot post their own variance; a supervisor can", () => {
    stock(10, w.loc.storageA);
    const p = locPlan("R3-F1", [w.loc.storageA]);
    createCountJobs(w.db, w.ctx, supervisor, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    countAll(p.id, 7);
    const line = linesOf(p.id)[0]!;
    expect(varianceSummary(w.db, operator, { level: "line", ids: [line.id] }).blocked[0]?.reason).toMatch(/four-eyes/);
    expect(updateInventoryForLines(w.db, w.ctx, operator, [line.id], rid).failed[0]?.code).toBe("FORBIDDEN");
    expect(updateInventoryForPlans(w.db, w.ctx, operator, [p.id], rid).failed[0]?.message).toMatch(/four-eyes/);
    expect(updateInventoryForLines(w.db, w.ctx, supervisor, [line.id], rid).failed).toEqual([]);
  });

  it("an operator's quick count with a variance waits for approval", () => {
    const b = stock(4, w.loc.storageA);
    const res = createInstantCount(w.db, w.ctx, operator, { warehouseId: w.warehouseId, locationId: w.loc.storageA, entries: [{ inventoryId: b.id, countedQty: 6 }], note: null, updateInventory: true, reasonId: rid }, true, false);
    expect(res.awaitingApproval).toBe(true);
    expect(res.status).toBe("Count Completed");
    expect(w.db.select().from(schema.inventory).where(eq(schema.inventory.id, b.id)).get()?.onHand).toBe(4);
  });

  it("pure rules", () => {
    expect(selfApprovalReason({ countUserId: "u1", hasVariance: true }, "u1", false)).toMatch(/four-eyes/);
    expect(selfApprovalReason({ countUserId: "u1", hasVariance: true }, "u1", true)).toBeNull();
    expect(selfApprovalReason({ countUserId: "u1", hasVariance: false }, "u1", false)).toBeNull();
    expect(selfApprovalReason({ countUserId: "u2", hasVariance: true }, "u1", false)).toBeNull();
    expect(planUpdateInvReason("Pending", 0)).toMatch(/Cancel/);
  });
});
