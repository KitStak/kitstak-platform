/** M07 count lifecycle against an in-memory migrated DB: plan → job → count → recount → Update Inv., cancel, instant count. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createCountJobs, createRecounts } from "@/server/repositories/counts-jobs";
import { cancelCountLines, cancelCountPlans, deleteCountLine, updateInventoryForLines, updateInventoryForPlans, varianceSummary } from "@/server/repositories/counts-ops";
import { createCountPlan, deleteCountPlan, getCountPlanDetail, listCountPlans, updateCountPlan } from "@/server/repositories/counts-plans";
import { listCountLines } from "@/server/repositories/counts-lines";
import { countSheet, createInstantCount, submitSheetLine } from "@/server/repositories/counts-sheet";
import { createCountPlanFromWave } from "@/server/repositories/counts-commands";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cycleType: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  const jt = (code: string, count: Record<string, boolean>) => w.db.insert(schema.jobTypes).values({
    code, description: code, warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count }),
  }).returning().get().id;
  cycleType = jt("Cycle Count", { autoUpdateNoDifferenceLines: true });
  jt("Instant Count", { instantCount: true });
});
afterEach(() => w.close());

const stock = (qty: number, locationId: string, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty }).bucket;
const plan = (id: string) => w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
const linesOf = (id: string) => w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id)).all();
const onHandAt = (locationId: string) => w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, locationId)).all().reduce((s, b) => s + b.onHand, 0);
const clean = () => expect(ledger.reconcileLedger(w.db)).toEqual([]);

function skuPlan(name = "KS-E2E-COUNT-1") {
  return createCountPlan(w.db, w.ctx, auth, {
    code: name, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: true,
    countType: "SKU", locationIds: [], productIds: [w.productId],
  });
}

function countLine(planId: string, lineId: string, qty: number) {
  const sheet = countSheet(w.db, auth.scope, planId).find((l) => l.lineId === lineId);
  expect(sheet).toBeDefined();
  const entries = (sheet?.buckets ?? []).map((b) => ({ inventoryId: b.inventoryId, countedQty: qty }));
  return submitSheetLine(w.db, w.ctx, auth, planId, { lineId, entries, note: null });
}

describe("count plan lifecycle (acceptance KS-E2E-COUNT-1)", () => {
  it("runs Pending → job → count → recount → Update Inv.", () => {
    stock(20, w.loc.storageA);
    stock(5, w.loc.storageB);
    const p = skuPlan();
    expect(p.status).toBe("Pending");
    expect(p.lockLocations).toBe(true);

    const jobs = createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 1, assigneeUserId: null });
    expect(jobs.failed).toEqual([]);
    expect(jobs.jobIds).toHaveLength(2);
    expect(plan(p.id)?.status).toBe("Ready To Count");
    const lines = linesOf(p.id);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.status === "Ready To Count" && l.jobId)).toBe(true);

    const lineA = lines.find((l) => l.locationId === w.loc.storageA);
    const lineB = lines.find((l) => l.locationId === w.loc.storageB);
    if (!lineA || !lineB) throw new Error("lines");
    expect(countLine(p.id, lineA.id, 18).status).toBe("Count Completed");
    expect(plan(p.id)?.status).toBe("Count Started");
    // no difference + auto-update job type → Inventory Updated without posting
    expect(countLine(p.id, lineB.id, 5).status).toBe("Inventory Updated");
    expect(plan(p.id)?.status).toBe("Count Completed");

    const grid = listCountLines(w.db, auth.scope, "skus", EMPTY_GRID_QUERY).rows.find((r) => r.id === lineA.id);
    expect(grid?.difference).toBe(-10);

    const rc = createRecounts(w.db, w.ctx, auth, [lineA.id]);
    expect(rc.failed).toEqual([]);
    expect(rc.jobIds).toHaveLength(1);
    const after = linesOf(p.id);
    expect(after.find((l) => l.id === lineA.id)?.status).toBe("Recount Created");
    const recount = after.find((l) => l.isRecountLine);
    expect(recount?.status).toBe("Ready To Count");
    expect(recount?.recountOfLineId).toBe(lineA.id);
    expect(plan(p.id)?.status).toBe("Count Started");

    if (!recount) throw new Error("recount");
    countLine(p.id, recount.id, 18);
    expect(plan(p.id)?.status).toBe("Count Completed");
    const v = varianceSummary(w.db, auth, { level: "plan", ids: [p.id] });
    expect(v.rows).toHaveLength(1);
    expect(v.unitsDown).toBe(2);

    const res = updateInventoryForPlans(w.db, w.ctx, auth, [p.id]);
    expect(res.failed).toEqual([]);
    expect(onHandAt(w.loc.storageA)).toBe(18);
    const txn = w.db.select().from(schema.inventoryTransactions).where(and(eq(schema.inventoryTransactions.type, "Count"), eq(schema.inventoryTransactions.countPlanId, p.id))).all();
    expect(txn).toHaveLength(1);
    expect(txn[0]?.uomQty).toBe(-2);
    expect(txn[0]?.note).toContain("KS-E2E-COUNT-1");
    const final = plan(p.id);
    expect(final?.status).toBe("Inventory Updated");
    expect(final?.inventoryUpdatedBy).toBe(w.userId);
    clean();
  });

  it("blocks a second Create Job and guards Update Inv. on uncounted plans", () => {
    stock(3, w.loc.storageA);
    const p = skuPlan();
    expect(updateInventoryForPlans(w.db, w.ctx, auth, [p.id]).failed[0]?.code).toBe("INVALID_STATE");
    createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    const again = createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    expect(again.failed[0]?.code).toBe("INVALID_STATE");
  });
});

describe("cancel, edit, delete", () => {
  it("cancelling a pending plan cancels its lines (locations unlock)", () => {
    stock(4, w.loc.storageA);
    const p = skuPlan();
    expect(cancelCountPlans(w.db, w.ctx, auth, [p.id]).failed).toEqual([]);
    expect(plan(p.id)?.status).toBe("Cancelled");
    expect(linesOf(p.id).every((l) => l.status === "Cancelled")).toBe(true);
  });

  it("cancelling a ready plan cancels its pending tasks and jobs", () => {
    stock(4, w.loc.storageA);
    const p = skuPlan();
    const { jobIds } = createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    cancelCountPlans(w.db, w.ctx, auth, [p.id]);
    const job = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobIds[0] ?? "")).get();
    expect(job?.status).toBe("Cancelled");
    expect(w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobIds[0] ?? "")).all().every((t) => t.status === "Cancelled")).toBe(true);
  });

  it("cancelling the only open line cancels the plan", () => {
    stock(4, w.loc.storageA);
    const p = skuPlan();
    createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    const [line] = linesOf(p.id);
    expect(cancelCountLines(w.db, w.ctx, auth, [line?.id ?? ""]).failed).toEqual([]);
    expect(plan(p.id)?.status).toBe("Cancelled");
  });

  it("edits a pending plan with a version check and rejects stale versions", () => {
    const p = createCountPlan(w.db, w.ctx, auth, { code: "LOC-1", warehouseId: w.warehouseId, description: "x", scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageA], productIds: [] });
    const u = updateCountPlan(w.db, w.ctx, auth, p.id, { version: p.version, code: "LOC-1", warehouseId: w.warehouseId, description: "y", scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", locationIds: [w.loc.storageA, w.loc.storageB], productIds: [] });
    expect(u.locationCount).toBe(2);
    expect(() => updateCountPlan(w.db, w.ctx, auth, p.id, { version: p.version, code: "LOC-1", warehouseId: w.warehouseId, description: "z", scheduledAt: new Date().toISOString(), lockLocations: true, countType: "Location", locationIds: [w.loc.storageA], productIds: [] })).toThrow(/changed/);
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, p.id)).all();
    expect(logs.some((l) => l.field === "lockLocations")).toBe(true);
  });

  it("rejects duplicate names and deletes only pending plans / lines", () => {
    createCountPlan(w.db, w.ctx, auth, { code: "DUP", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageA], productIds: [] });
    expect(() => createCountPlan(w.db, w.ctx, auth, { code: "dup", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageA], productIds: [] })).toThrow(/already exists/);
    const p = createCountPlan(w.db, w.ctx, auth, { code: "TWO", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "SKU", locationIds: [], productIds: [w.productId, w.product2Id] });
    const [first, second] = linesOf(p.id);
    deleteCountLine(w.db, w.ctx, auth, first?.id ?? "");
    expect(() => deleteCountLine(w.db, w.ctx, auth, second?.id ?? "")).toThrow(/at least one line/);
    deleteCountPlan(w.db, w.ctx, auth, p.id);
    expect(plan(p.id)).toBeUndefined();
  });

  it("lists plans with counts and detail", () => {
    stock(2, w.loc.storageA);
    const p = skuPlan();
    const row = listCountPlans(w.db, auth.viewScope, EMPTY_GRID_QUERY).rows.find((r) => r.id === p.id);
    expect(row).toMatchObject({ skuCount: 1, countType: "SKU", status: "Pending" });
    const detail = getCountPlanDetail(w.db, auth.scope, p.code);
    expect(detail.plan.id).toBe(p.id);
    expect(detail.productIds).toEqual([w.productId]);
  });
});

describe("update inventory per line + found stock", () => {
  it("posts found stock into a new bucket", () => {
    const p = createCountPlan(w.db, w.ctx, auth, { code: "FOUND", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageB], productIds: [] });
    createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: null });
    const [line] = linesOf(p.id);
    submitSheetLine(w.db, w.ctx, auth, p.id, { lineId: line?.id ?? "", entries: [{ productId: w.product2Id, countedQty: 7 }], note: "found on floor" });
    expect(updateInventoryForLines(w.db, w.ctx, auth, [line?.id ?? ""]).failed).toEqual([]);
    expect(onHandAt(w.loc.storageB)).toBe(7);
    expect(plan(p.id)?.status).toBe("Inventory Updated");
    clean();
  });
});

describe("instant count", () => {
  it("auto-updates a no-variance instant count and leaves no open line", () => {
    const b = stock(9, w.loc.storageA);
    const r = createInstantCount(w.db, w.ctx, auth, { warehouseId: w.warehouseId, locationId: w.loc.storageA, entries: [{ inventoryId: b.id, countedQty: 9 }], note: null, updateInventory: false, reasonId: null }, false);
    expect(r.code).toMatch(/^IC\d{17}$/);
    expect(r.status).toBe("Inventory Updated");
    expect(linesOf(r.planId).every((l) => l.status === "Inventory Updated")).toBe(true);
    expect(plan(r.planId)?.operationType).toBe("Instant Count");
  });

  it("posts an instant count variance when asked", () => {
    const b = stock(9, w.loc.storageA);
    const r = createInstantCount(w.db, w.ctx, auth, { warehouseId: w.warehouseId, locationId: w.loc.storageA, entries: [{ inventoryId: b.id, countedQty: 6 }], note: null, updateInventory: true, reasonId: null }, true);
    expect(r.status).toBe("Inventory Updated");
    expect(onHandAt(w.loc.storageA)).toBe(6);
    clean();
  });

  it("keeps the variance for review without update permission", () => {
    const b = stock(9, w.loc.storageA);
    const r = createInstantCount(w.db, w.ctx, auth, { warehouseId: w.warehouseId, locationId: w.loc.storageA, entries: [{ inventoryId: b.id, countedQty: 6 }], note: null, updateInventory: false, reasonId: null }, false);
    expect(r.status).toBe("Count Completed");
    expect(onHandAt(w.loc.storageA)).toBe(9);
  });
});

describe("wave command", () => {
  it("creates a cycle count plan with jobs from a wave rule", () => {
    stock(3, w.loc.storageA);
    const rule = w.db.insert(schema.waveRules).values({ ruleSeq: 1, name: "Cycle", warehouseId: w.warehouseId, operationType: "Cycle Count", countType: "Location" }).returning().get();
    const wave = w.db.insert(schema.waves).values({ waveNo: "1-1", waveRuleId: rule.id, warehouseId: w.warehouseId, runBy: "admin" }).returning().get();
    const res = createCountPlanFromWave(w.db, w.ctx, { warehouseId: w.warehouseId, waveId: wave.id, waveRuleId: rule.id, countType: "Location" });
    expect(res.code).toMatch(/^CNT/);
    expect(res.lineCount).toBe(1);
    expect(res.jobIds).toHaveLength(1);
    expect(plan(res.countPlanId)?.status).toBe("Ready To Count");
  });
});

describe("mandatory reason for cycle count", () => {
  function countedPlan() {
    stock(20, w.loc.storageA);
    const p = skuPlan("KS-REASON-1");
    createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 1, assigneeUserId: null });
    const line = linesOf(p.id)[0];
    if (!line) throw new Error("line");
    countLine(p.id, line.id, 17);
    return { p, line };
  }
  const requireReason = () => w.db.update(schema.warehouses).set({ mandatoryCountReason: true }).where(eq(schema.warehouses.id, w.warehouseId)).run();

  it("rejects Update Inv. without a reason when the warehouse requires one", () => {
    requireReason();
    const { p } = countedPlan();
    const res = updateInventoryForPlans(w.db, w.ctx, auth, [p.id]);
    expect(res.succeeded).toEqual([]);
    expect(res.failed[0]?.message).toMatch(/requires a reason/);
    expect(onHandAt(w.loc.storageA)).toBe(20);
    expect(varianceSummary(w.db, auth, { level: "plan", ids: [p.id] }).reasonRequired).toBe(true);
  });

  it("posts with a valid reason and stores it on the Count transaction", () => {
    requireReason();
    const reason = w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Cycle count variance" }).returning().get();
    const { p, line } = countedPlan();
    const res = updateInventoryForLines(w.db, w.ctx, auth, [line.id], reason.id);
    expect(res.failed).toEqual([]);
    expect(onHandAt(w.loc.storageA)).toBe(17);
    const txn = w.db.select().from(schema.inventoryTransactions).where(and(eq(schema.inventoryTransactions.type, "Count"), eq(schema.inventoryTransactions.countPlanId, p.id))).get();
    expect(txn?.adjustmentReasonId).toBe(reason.id);
    expect(plan(p.id)?.status).toBe("Inventory Updated");
    clean();
  });

  it("rejects an unknown reason id", () => {
    const { line } = countedPlan();
    const res = updateInventoryForLines(w.db, w.ctx, auth, [line.id], "not-a-reason");
    expect(res.failed[0]?.message).toMatch(/valid adjustment reason/);
  });
});
