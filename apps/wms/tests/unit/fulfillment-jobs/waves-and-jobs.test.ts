/**
 * M03 fulfillment-jobs: wave execution (acceptance "KS-E2E Picking"), scheduler, job bulk
 * actions, job types (template preset, delete guard) and wave-rule validation, against an
 * in-memory migrated DB.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema, jobTypeInputSchema } from "@/lib/grid-defs/jobs/forms";
import { JOB_TEMPLATE_DEFS } from "@/lib/grid-defs/jobs/conditions";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createOrder, unmergeOrder } from "@/server/domain/orders";
import { updatePriority } from "@/server/domain/jobs";
import { assertSameWarehouse, cancelJobs } from "@/server/repositories/jobs";
import { createWaveRule, deleteWaveRule } from "@/server/repositories/wave-rules";
import { eliminatedByJobTypes, runWave, summarize } from "@/server/repositories/waves-run";
import { createJobType, deleteBlocker, deleteJobType } from "@/server/repositories/job-types";
import { deleteCutoff, runDueWaveRules, SCHEDULER_RUN_BY } from "@/server/scheduler/tasks/wave-rules";
import { execute } from "@/server/domain/tasks";
import { listTasks, assignTasks } from "@/server/repositories/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, locationRow, orderInput, type World } from "../foundation/domain/fixtures";
import { mapSeq } from "@/server/db/sql";

let w: World;
let auth: AuthContext;
let singleType: string;
let multiType: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  const jt = async (code: string, orderScope: string) => (await w.db.insert(schema.jobTypes).values({
    code, description: code, warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope }),
  }).returning())[0].id;
  singleType = await jt("Single Unit Orders", "Single Item Orders");
  multiType = await jt("Multi Item Orders", "Multi-Item Orders");
});
afterEach(() => w.close());

const stock = async (qty: number, productId = w.productId, locationId = w.loc.storageA) =>
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty });
const mkOrder = async (qty: number, productId = w.productId) => await createOrder(w.db, w.ctx, orderInput(w, [{ productId, quantity: qty }]));
const orderRow = async (id: string) => (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
const qtyFilter = { field: "orderQuantity", op: "rng" as const, value: "1..10", label: "Order Quantity between 1 and 10" };

async function pickingRule(name = "KS-E2E Picking", extra: Record<string, unknown> = {}) {
  return await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name, warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType, multiType], filters: [qtyFilter], ...extra,
  }));
}

describe("wave run (acceptance KS-E2E Picking)", () => {
  it("creates jobs per type, keeps met = allocated + shortage and moves orders to Ready to Pick", async () => {
    await stock(30);
    const singles = await mapSeq(Array.from({ length: 6 }), async () => await mkOrder(1));
    const multis = await mapSeq(Array.from({ length: 4 }), async () => await mkOrder(3));
    const rule = await pickingRule();

    const res = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Completed");
    expect(res.wave.waveNo).toBe(`${rule.ruleSeq}-1`);
    expect(res.wave.ordersMet).toBe(10);
    expect(res.wave.ordersMet).toBe(res.wave.allocatedOrders + res.wave.shortageOrders);
    expect(res.wave.allocatedOrders).toBe(10);
    expect(res.summary).toMatch(/completed: 10 met · 10 allocated · \d+ jobs? · 0 shortage/);

    const jobs = await w.db.select().from(schema.jobs);
    expect(new Set(jobs.map((j) => j.jobTypeId))).toEqual(new Set([singleType, multiType]));
    expect(jobs.every((j) => j.waveRuleId === rule.id && j.ruleName === "KS-E2E Picking")).toBe(true);
    for (const o of [...singles, ...multis]) expect((await orderRow(o.id))?.status).toBe("Ready to Pick");
    const singleJobOrders = await mapSeq(singles, async (o) => (await orderRow(o.id))?.jobId);
    expect(jobs.filter((j) => singleJobOrders.includes(j.id)).every((j) => j.jobTypeId === singleType)).toBe(true);

    const after = (await w.db.select().from(schema.waveRules).where(eq(schema.waveRules.id, rule.id)).limit(1))[0];
    expect(after).toMatchObject({ runCount: 1, lastRunBy: "Admin", lastWaveNo: res.wave.waveNo });
    expect((await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, rule.id))).length).toBeGreaterThanOrEqual(2);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("counts shortage orders and eliminates orders no job type accepts", async () => {
    await stock(2);
    const ok = await mkOrder(1);
    const short = await mkOrder(5);
    const outOfFilter = await mkOrder(20);
    const rule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Singles only", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType] }));
    const res = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    // ok → allocated, short and outOfFilter → eliminated by the single-unit scope
    expect(res.wave.ordersMet).toBe(3);
    const ex = await w.db.select().from(schema.allocationExceptions);
    expect(ex.filter((e) => e.explanation === eliminatedByJobTypes(["Single Unit Orders"])).map((e) => e.orderId).sort()).toEqual([short.id, outOfFilter.id].sort());
    expect((await orderRow(ok.id))?.status).toBe("Ready to Pick");
    // eliminated orders are not shortages: met = allocated + shortage + eliminated
    expect(res.wave.allocatedOrders).toBe(1);
    expect(res.wave.shortageOrders).toBe(0);
    expect(res.wave.message).toMatch(/2 orders eliminated/);

    const multiRule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Multi", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [multiType] }));
    const res2 = await runWave(w.db, w.ctx, multiRule.id, { runBy: "Admin" });
    expect(res2.wave.ordersMet).toBe(res2.wave.allocatedOrders + res2.wave.shortageOrders);
    expect(res2.wave.shortageOrders).toBeGreaterThanOrEqual(1);
    expect((await orderRow(short.id))?.status).toBe("Shortage");
  });

  it("records a Failed wave instead of throwing", async () => {
    const rule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Repl", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType] }));
    await w.db.update(schema.waveRules).set({ operationType: "Replenishment", jobTypeIds: [] }).where(eq(schema.waveRules.id, rule.id));
    const res = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Failed");
    expect(res.summary).toMatch(/failed: The rule has no replenishment job type/);
  });

  it("merges same-customer Open orders through orders.mergeOrders and unmerges symmetrically", async () => {
    const a = await mkOrder(1);
    const b = await mkOrder(2);
    const c = await mkOrder(3);
    const mr = (await w.db.insert(schema.lookupValues).values({ type: "order_merge_rule", name: "Same customer + address", meta: { criteria: ["client", "customerName", "shipAddress"] } }).returning())[0];
    const rule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Merge", warehouseId: w.warehouseId, operationType: "Order Merge", mergeRuleIds: [mr.id] }));
    const res = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Completed");
    expect(res.wave.ordersMet).toBe(3);
    expect(res.wave.mergedOrders).toBe(2);
    expect(res.summary).toBe(`Wave ${res.wave.waveNo} completed: 3 met · 2 merged`);
    const rows = await mapSeq([a, b, c], async (o) => await orderRow(o.id));
    const master = rows.find((r) => r?.isMerged);
    expect(master?.status).toBe("Open");
    expect(master?.totalQuantity).toBe(6);
    const children = rows.filter((r) => r && r.id !== master?.id);
    expect(children.every((r) => r?.status === "On Hold" && r.mergedIntoOrderId === master?.id)).toBe(true);
    const copied = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, master?.id ?? ""))).filter((l) => l.originalOrderCode);
    expect(copied.map((l) => l.originalOrderCode).sort()).toEqual(children.map((r) => r?.code).sort());

    // A second run finds nothing left to merge (children are On Hold, the master is merged).
    const again = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(again.wave.mergedOrders).toBe(0);

    await unmergeOrder(w.db, w.ctx, { orderId: master?.id ?? "" });
    for (const r of children) expect((await orderRow(r?.id ?? ""))?.mergedIntoOrderId).toBeNull();
  });

  it("stamps cycle-count wave jobs with the wave no and rule", async () => {
    await stock(5);
    const countType = (await w.db.insert(schema.jobTypes).values({ code: "Cycle Count", description: "Cycle Count", warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({}) }).returning())[0].id;
    const parsed = waveRuleInputSchema.safeParse({ name: "Cycle", warehouseId: w.warehouseId, operationType: "Cycle Count", countType: "Location", jobTypeIds: [countType] });
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."))).toEqual([]);
    if (!parsed.success) return;
    const rule = await createWaveRule(w.db, auth, w.ctx, parsed.data);
    const res = await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Completed");
    expect(res.jobIds.length).toBeGreaterThan(0);
    const jobs = (await w.db.select().from(schema.jobs)).filter((j) => res.jobIds.includes(j.id));
    expect(jobs.every((j) => j.waveNumber === res.wave.waveNo && j.waveId === res.wave.id && j.ruleName === "Cycle")).toBe(true);
    expect(res.summary).toMatch(new RegExp(`^Wave ${res.wave.waveNo} completed: \\d+ jobs? · Count plan CNT\\d+ created with \\d+ lines?$`));
  });

  it("summarizes per operation type", () => {
    const base = { waveNo: "20522-95", ordersMet: 35, allocatedOrders: 15, jobsCreated: 3, shortageOrders: 20, mergedOrders: 4, status: "Completed" as const, message: "x" };
    expect(summarize(base, "Picking")).toBe("Wave 20522-95 completed: 35 met · 15 allocated · 3 jobs · 20 shortage");
    expect(summarize(base, "Order Merge")).toBe("Wave 20522-95 completed: 35 met · 4 merged");
    expect(summarize({ ...base, jobsCreated: 1, message: "Count plan CNT000146 created with 50 lines" }, "Cycle Count")).toBe("Wave 20522-95 completed: 1 job · Count plan CNT000146 created with 50 lines");
    expect(summarize({ ...base, jobsCreated: 0, message: null }, "Replenishment")).toBe("Wave 20522-95 completed: 0 jobs");
  });
});

describe("wave rules", () => {
  it("validates job types, schedule times and assignees", () => {
    const bad = waveRuleInputSchema.safeParse({ name: "X", warehouseId: w.warehouseId, operationType: "Picking", scheduleDays: ["Mon"], assignMode: "Users" });
    expect(bad.success).toBe(false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["jobTypeIds", "scheduleTimes", "assigneeUserIds"]));
    const merge = waveRuleInputSchema.safeParse({ name: "M", warehouseId: w.warehouseId, operationType: "Order Merge" });
    expect(merge.success ? [] : merge.error.issues.map((i) => i.path.join("."))).toEqual(["mergeRuleIds"]);
  });

  it("rejects job types of another warehouse and blocks delete while a wave runs", async () => {
    const other = (await w.db.insert(schema.warehouses).values({ code: "KS2", name: "KS2", addressLine: "1", city: "c", state: "s", postalCode: "1", timezone: "America/New_York", mandatoryAdjustmentReason: false }).returning())[0].id;
    const foreignType = (await w.db.insert(schema.jobTypes).values({ code: "F", description: "F", warehouseId: other, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).returning())[0].id;
    await expect(async () => await pickingRule("Foreign", { jobTypeIds: [foreignType] })).rejects.toThrow(/not available/);
    const rule = await pickingRule();
    await w.db.insert(schema.waves).values({ waveNo: "1-1", waveRuleId: rule.id, warehouseId: w.warehouseId, status: "Started", runBy: "Admin", runAt: new Date().toISOString() });
    await expect(async () => await deleteWaveRule(w.db, auth, w.ctx, rule.id)).rejects.toThrow(/in progress/);
  });
});

describe("scheduler", () => {
  it("runs due rules as Integration and computes delete cut-offs", async () => {
    await stock(5);
    await mkOrder(1);
    const rule = await pickingRule("KS-E2E Scheduled");
    const now = new Date();
    await w.db.update(schema.waveRules).set({ nextRunAt: new Date(now.getTime() - 1000).toISOString() }).where(eq(schema.waveRules.id, rule.id));
    const out = await runDueWaveRules(w.db, now);
    expect(out.status).toBe("ok");
    const wave = (await w.db.select().from(schema.waves).where(eq(schema.waves.waveRuleId, rule.id)).limit(1))[0];
    expect(wave?.runBy).toBe(SCHEDULER_RUN_BY);
    expect((await runDueWaveRules(w.db, now)).status).toBe("skipped");

    expect(deleteCutoff({ deleteIfNotStarted: true, deleteMethod: "After Hours", deleteTime: "2" }, "UTC", now)?.getTime()).toBe(now.getTime() - 7_200_000);
    expect(deleteCutoff({ deleteIfNotStarted: false, deleteMethod: "After Hours", deleteTime: "2" }, "UTC", now)).toBeNull();
    expect(deleteCutoff({ deleteIfNotStarted: true, deleteMethod: "At Specific Time", deleteTime: "00:00" }, "UTC", now)).not.toBeNull();
  });
});

describe("job bulk actions", () => {
  async function jobsFromWave(n: number) {
    await stock(20);
    await mapSeq(Array.from({ length: n }), async () => await mkOrder(1));
    await runWave(w.db, w.ctx, (await pickingRule()).id, { runBy: "Admin" });
    return await w.db.select().from(schema.jobs);
  }

  it("updates priority on every selected job", async () => {
    const jobs = await jobsFromWave(2);
    const res = await updatePriority(w.db, w.ctx, { jobIds: jobs.map((j) => j.id), priority: "High" });
    expect(res.failed).toEqual([]);
    expect((await w.db.select().from(schema.jobs)).every((j) => j.priority === "High")).toBe(true);
  });

  it("cancel releases allocations and sets orders back to Open", async () => {
    const jobs = await jobsFromWave(3);
    const res = await cancelJobs(w.db, w.ctx, jobs.map((j) => j.id));
    expect(res.failed).toEqual([]);
    expect((await w.db.select().from(schema.shipmentOrders)).every((o) => o.status === "Open" && o.jobId === null)).toBe(true);
    expect((await w.db.select().from(schema.inventoryAllocations)).filter((a) => a.status === "Allocated")).toHaveLength(0);
    expect((await w.db.select().from(schema.inventory)).reduce((s, b) => s + b.allocated, 0)).toBe(0);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses assign across warehouses", async () => {
    const jobs = await jobsFromWave(1);
    const other = (await w.db.insert(schema.warehouses).values({ code: "KS2", name: "KS2", addressLine: "1", city: "c", state: "s", postalCode: "1", timezone: "UTC", mandatoryAdjustmentReason: false }).returning())[0].id;
    const foreign = (await w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code: "Job999999", warehouseId: other, jobType: "X", operationType: "Picking", status: "Pending", priority: "None" }).returning())[0];
    await expect(async () => await assertSameWarehouse(w.db, [jobs[0].id, foreign.id])).rejects.toThrow(/only be performed|Different Warehouses/i);
    await assertSameWarehouse(w.db, [jobs[0].id]);
  });
});

describe("job types", () => {
  it("Single Item Order template presets the order scope", async () => {
    const t = JOB_TEMPLATE_DEFS.find((d) => d.key === "Single Item Order");
    expect(t?.orderScope).toBe("Single Item Orders");
    expect(JOB_TEMPLATE_DEFS).toHaveLength(9);
    const algo = (await w.db.insert(schema.algorithms).values({ name: "Default", warehouseId: w.warehouseId, kind: "Allocation" }).returning())[0];
    const created = await createJobType(w.db, auth, w.ctx, jobTypeInputSchema.parse({
      code: "KS-TEST Singles", description: "Singles", warehouseId: w.warehouseId, operationType: "Picking", allocationAlgorithmId: algo.id,
      settings: jobTypeSettingsSchema.parse({ template: "Single Item Order", orderScope: t?.orderScope }),
    }));
    expect(created.settings.orderScope).toBe("Single Item Orders");
    expect(created.template).toBe("Single Item Order");
    await expect(async () => await createJobType(w.db, auth, w.ctx, jobTypeInputSchema.parse({
      code: "ks-test singles", description: "dupe", warehouseId: w.warehouseId, operationType: "Picking", allocationAlgorithmId: algo.id, settings: jobTypeSettingsSchema.parse({}),
    }))).rejects.toThrow(/already exists/);
  });

  it("requires an algorithm for picking and blocks delete while in use", async () => {
    expect(jobTypeInputSchema.safeParse({ code: "A", description: "A", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).success).toBe(false);
    expect(await deleteBlocker(w.db, singleType)).toBeNull();
    await pickingRule();
    expect(await deleteBlocker(w.db, singleType)).toMatch(/wave rule "KS-E2E Picking"/);
    await expect(async () => await deleteJobType(w.db, auth, w.ctx, singleType)).rejects.toThrow(/Remove it from them first/);
    const unused = (await w.db.insert(schema.jobTypes).values({ code: "Spare", description: "Spare", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).returning())[0].id;
    await deleteJobType(w.db, auth, w.ctx, unused);
    expect((await w.db.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, unused)).limit(1))[0]?.isActive).toBe(false);
  });
});

describe("task details", () => {
  async function waveJob(qty: number) {
    await stock(10);
    const o = await mkOrder(qty);
    await runWave(w.db, w.ctx, (await pickingRule()).id, { runBy: "Admin" });
    return o.id;
  }

  it("executing every pick task moves the order to Ready to Pack and writes Picking ledger rows", async () => {
    const orderId = await waveJob(2);
    const rows = (await listTasks(w.db, auth, "order", EMPTY_GRID_QUERY)).rows.filter((r) => r.orderId === orderId && r.taskType === "Picking");
    expect(rows.length).toBeGreaterThan(0);
    await execute(w.db, w.ctx, { taskIds: rows.map((r) => r.id), targetLocationId: w.loc.pick });
    expect((await orderRow(orderId))?.status).toBe("Ready to Pack");
    expect((await w.db.select().from(schema.inventoryTransactions)).some((t) => t.type === "Picking")).toBe(true);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("partial execute writes a missing log and opens pick short", async () => {
    const orderId = await waveJob(3);
    const pick = (await w.db.select().from(schema.tasks)).find((t) => t.orderId === orderId && t.taskType === "Picking");
    if (!pick) throw new Error("no pick task");
    await execute(w.db, w.ctx, { taskIds: [pick.id], targetLocationId: w.loc.pick, qty: 1 });
    expect(await w.db.select().from(schema.missingLog)).toHaveLength(1);
    expect((await orderRow(orderId))?.pickShortStatus).toBe("Open");
  });

  it("assigns and unassigns tasks", async () => {
    const orderId = await waveJob(1);
    const ids = (await w.db.select().from(schema.tasks)).filter((t) => t.orderId === orderId).map((t) => t.id);
    expect((await assignTasks(w.db, w.ctx, { ids, userId: w.userId })).failed).toEqual([]);
    expect((await w.db.select().from(schema.tasks)).filter((t) => ids.includes(t.id)).every((t) => t.assigneeUserId === w.userId)).toBe(true);
    await assignTasks(w.db, w.ctx, { ids, userId: null });
    expect((await w.db.select().from(schema.tasks)).filter((t) => ids.includes(t.id)).every((t) => t.assigneeUserId === null)).toBe(true);
  });
});

// keep locationRow import used for future pick-path tests
void locationRow;
