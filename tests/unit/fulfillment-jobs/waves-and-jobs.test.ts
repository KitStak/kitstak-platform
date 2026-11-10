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
import { createOrder } from "@/server/domain/orders";
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

let w: World;
let auth: AuthContext;
let singleType: string;
let multiType: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  const jt = (code: string, orderScope: string) => w.db.insert(schema.jobTypes).values({
    code, description: code, warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope }),
  }).returning().get().id;
  singleType = jt("Single Unit Orders", "Single Item Orders");
  multiType = jt("Multi Item Orders", "Multi-Item Orders");
});
afterEach(() => w.close());

const stock = (qty: number, productId = w.productId, locationId = w.loc.storageA) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty });
const mkOrder = (qty: number, productId = w.productId) => createOrder(w.db, w.ctx, orderInput(w, [{ productId, quantity: qty }]));
const orderRow = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
const qtyFilter = { field: "orderQuantity", op: "rng" as const, value: "1..10", label: "Order Quantity between 1 and 10" };

function pickingRule(name = "KS-E2E Picking", extra: Record<string, unknown> = {}) {
  return createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name, warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType, multiType], filters: [qtyFilter], ...extra,
  }));
}

describe("wave run (acceptance KS-E2E Picking)", () => {
  it("creates jobs per type, keeps met = allocated + shortage and moves orders to Ready to Pick", () => {
    stock(30);
    const singles = Array.from({ length: 6 }, () => mkOrder(1));
    const multis = Array.from({ length: 4 }, () => mkOrder(3));
    const rule = pickingRule();

    const res = runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Completed");
    expect(res.wave.waveNo).toBe(`${rule.ruleSeq}-1`);
    expect(res.wave.ordersMet).toBe(10);
    expect(res.wave.ordersMet).toBe(res.wave.allocatedOrders + res.wave.shortageOrders);
    expect(res.wave.allocatedOrders).toBe(10);
    expect(res.summary).toMatch(/completed: 10 met · 10 allocated · \d+ jobs · 0 shortage/);

    const jobs = w.db.select().from(schema.jobs).all();
    expect(new Set(jobs.map((j) => j.jobTypeId))).toEqual(new Set([singleType, multiType]));
    expect(jobs.every((j) => j.waveRuleId === rule.id && j.ruleName === "KS-E2E Picking")).toBe(true);
    for (const o of [...singles, ...multis]) expect(orderRow(o.id)?.status).toBe("Ready to Pick");
    const singleJobOrders = singles.map((o) => orderRow(o.id)?.jobId);
    expect(jobs.filter((j) => singleJobOrders.includes(j.id)).every((j) => j.jobTypeId === singleType)).toBe(true);

    const after = w.db.select().from(schema.waveRules).where(eq(schema.waveRules.id, rule.id)).get();
    expect(after).toMatchObject({ runCount: 1, lastRunBy: "Admin", lastWaveNo: res.wave.waveNo });
    expect(w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, rule.id)).all().length).toBeGreaterThanOrEqual(2);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("counts shortage orders and eliminates orders no job type accepts", () => {
    stock(2);
    const ok = mkOrder(1);
    const short = mkOrder(5);
    const outOfFilter = mkOrder(20);
    const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Singles only", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType] }));
    const res = runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    // ok → allocated, short and outOfFilter → eliminated by the single-unit scope
    expect(res.wave.ordersMet).toBe(3);
    const ex = w.db.select().from(schema.allocationExceptions).all();
    expect(ex.filter((e) => e.explanation === eliminatedByJobTypes(["Single Unit Orders"])).map((e) => e.orderId).sort()).toEqual([short.id, outOfFilter.id].sort());
    expect(orderRow(ok.id)?.status).toBe("Ready to Pick");

    const multiRule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Multi", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [multiType] }));
    const res2 = runWave(w.db, w.ctx, multiRule.id, { runBy: "Admin" });
    expect(res2.wave.ordersMet).toBe(res2.wave.allocatedOrders + res2.wave.shortageOrders);
    expect(res2.wave.shortageOrders).toBeGreaterThanOrEqual(1);
    expect(orderRow(short.id)?.status).toBe("Shortage");
  });

  it("records a Failed wave instead of throwing", () => {
    const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Repl", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType] }));
    w.db.update(schema.waveRules).set({ operationType: "Replenishment", jobTypeIds: [] }).where(eq(schema.waveRules.id, rule.id)).run();
    const res = runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
    expect(res.wave.status).toBe("Failed");
    expect(res.summary).toMatch(/failed: The rule has no replenishment job type/);
  });

  it("summarizes per operation type", () => {
    const base = { waveNo: "20522-95", ordersMet: 35, allocatedOrders: 15, jobsCreated: 3, shortageOrders: 20, mergedOrders: 4, status: "Completed" as const, message: "x" };
    expect(summarize(base, "Picking")).toBe("Wave 20522-95 completed: 35 met · 15 allocated · 3 jobs · 20 shortage");
    expect(summarize(base, "Order Merge")).toBe("Wave 20522-95 completed: 35 met · 4 merged");
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

  it("rejects job types of another warehouse and blocks delete while a wave runs", () => {
    const other = w.db.insert(schema.warehouses).values({ code: "KS2", name: "KS2", addressLine: "1", city: "c", state: "s", postalCode: "1", timezone: "America/New_York", mandatoryAdjustmentReason: false }).returning().get().id;
    const foreignType = w.db.insert(schema.jobTypes).values({ code: "F", description: "F", warehouseId: other, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).returning().get().id;
    expect(() => pickingRule("Foreign", { jobTypeIds: [foreignType] })).toThrow(/not available/);
    const rule = pickingRule();
    w.db.insert(schema.waves).values({ waveNo: "1-1", waveRuleId: rule.id, warehouseId: w.warehouseId, status: "Started", runBy: "Admin", runAt: new Date().toISOString() }).run();
    expect(() => deleteWaveRule(w.db, auth, w.ctx, rule.id)).toThrow(/in progress/);
  });
});

describe("scheduler", () => {
  it("runs due rules as Integration and computes delete cut-offs", async () => {
    stock(5);
    mkOrder(1);
    const rule = pickingRule("KS-E2E Scheduled");
    const now = new Date();
    w.db.update(schema.waveRules).set({ nextRunAt: new Date(now.getTime() - 1000).toISOString() }).where(eq(schema.waveRules.id, rule.id)).run();
    const out = await runDueWaveRules(w.db, now);
    expect(out.status).toBe("ok");
    const wave = w.db.select().from(schema.waves).where(eq(schema.waves.waveRuleId, rule.id)).get();
    expect(wave?.runBy).toBe(SCHEDULER_RUN_BY);
    expect((await runDueWaveRules(w.db, now)).status).toBe("skipped");

    expect(deleteCutoff({ deleteIfNotStarted: true, deleteMethod: "After Hours", deleteTime: "2" }, "UTC", now)?.getTime()).toBe(now.getTime() - 7_200_000);
    expect(deleteCutoff({ deleteIfNotStarted: false, deleteMethod: "After Hours", deleteTime: "2" }, "UTC", now)).toBeNull();
    expect(deleteCutoff({ deleteIfNotStarted: true, deleteMethod: "At Specific Time", deleteTime: "00:00" }, "UTC", now)).not.toBeNull();
  });
});

describe("job bulk actions", () => {
  function jobsFromWave(n: number) {
    stock(20);
    Array.from({ length: n }, () => mkOrder(1));
    runWave(w.db, w.ctx, pickingRule().id, { runBy: "Admin" });
    return w.db.select().from(schema.jobs).all();
  }

  it("updates priority on every selected job", () => {
    const jobs = jobsFromWave(2);
    const res = updatePriority(w.db, w.ctx, { jobIds: jobs.map((j) => j.id), priority: "High" });
    expect(res.failed).toEqual([]);
    expect(w.db.select().from(schema.jobs).all().every((j) => j.priority === "High")).toBe(true);
  });

  it("cancel releases allocations and sets orders back to Open", () => {
    const jobs = jobsFromWave(3);
    const res = cancelJobs(w.db, w.ctx, jobs.map((j) => j.id));
    expect(res.failed).toEqual([]);
    expect(w.db.select().from(schema.shipmentOrders).all().every((o) => o.status === "Open" && o.jobId === null)).toBe(true);
    expect(w.db.select().from(schema.inventoryAllocations).all().filter((a) => a.status === "Allocated")).toHaveLength(0);
    expect(w.db.select().from(schema.inventory).all().reduce((s, b) => s + b.allocated, 0)).toBe(0);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses assign across warehouses", () => {
    const jobs = jobsFromWave(1);
    const other = w.db.insert(schema.warehouses).values({ code: "KS2", name: "KS2", addressLine: "1", city: "c", state: "s", postalCode: "1", timezone: "UTC", mandatoryAdjustmentReason: false }).returning().get().id;
    const foreign = w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code: "Job999999", warehouseId: other, jobType: "X", operationType: "Picking", status: "Pending", priority: "None" }).returning().get();
    expect(() => assertSameWarehouse(w.db, [jobs[0].id, foreign.id])).toThrow(/only be performed|Different Warehouses/i);
    expect(() => assertSameWarehouse(w.db, [jobs[0].id])).not.toThrow();
  });
});

describe("job types", () => {
  it("Single Item Order template presets the order scope", () => {
    const t = JOB_TEMPLATE_DEFS.find((d) => d.key === "Single Item Order");
    expect(t?.orderScope).toBe("Single Item Orders");
    expect(JOB_TEMPLATE_DEFS).toHaveLength(9);
    const algo = w.db.insert(schema.algorithms).values({ name: "Default", warehouseId: w.warehouseId, kind: "Allocation" }).returning().get();
    const created = createJobType(w.db, auth, w.ctx, jobTypeInputSchema.parse({
      code: "KS-TEST Singles", description: "Singles", warehouseId: w.warehouseId, operationType: "Picking", allocationAlgorithmId: algo.id,
      settings: jobTypeSettingsSchema.parse({ template: "Single Item Order", orderScope: t?.orderScope }),
    }));
    expect(created.settings.orderScope).toBe("Single Item Orders");
    expect(created.template).toBe("Single Item Order");
    expect(() => createJobType(w.db, auth, w.ctx, jobTypeInputSchema.parse({
      code: "ks-test singles", description: "dupe", warehouseId: w.warehouseId, operationType: "Picking", allocationAlgorithmId: algo.id, settings: jobTypeSettingsSchema.parse({}),
    }))).toThrow(/already exists/);
  });

  it("requires an algorithm for picking and blocks delete while in use", () => {
    expect(jobTypeInputSchema.safeParse({ code: "A", description: "A", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).success).toBe(false);
    expect(deleteBlocker(w.db, singleType)).toBeNull();
    pickingRule();
    expect(deleteBlocker(w.db, singleType)).toMatch(/wave rule "KS-E2E Picking"/);
    expect(() => deleteJobType(w.db, auth, w.ctx, singleType)).toThrow(/Remove it from them first/);
    const unused = w.db.insert(schema.jobTypes).values({ code: "Spare", description: "Spare", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}) }).returning().get().id;
    deleteJobType(w.db, auth, w.ctx, unused);
    expect(w.db.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, unused)).get()?.isActive).toBe(false);
  });
});

describe("task details", () => {
  function waveJob(qty: number) {
    stock(10);
    const o = mkOrder(qty);
    runWave(w.db, w.ctx, pickingRule().id, { runBy: "Admin" });
    return o.id;
  }

  it("executing every pick task moves the order to Ready to Pack and writes Picking ledger rows", () => {
    const orderId = waveJob(2);
    const rows = listTasks(w.db, auth, "order", EMPTY_GRID_QUERY).rows.filter((r) => r.orderId === orderId && r.taskType === "Picking");
    expect(rows.length).toBeGreaterThan(0);
    execute(w.db, w.ctx, { taskIds: rows.map((r) => r.id), targetLocationId: w.loc.pick });
    expect(orderRow(orderId)?.status).toBe("Ready to Pack");
    expect(w.db.select().from(schema.inventoryTransactions).all().some((t) => t.type === "Picking")).toBe(true);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("partial execute writes a missing log and opens pick short", () => {
    const orderId = waveJob(3);
    const pick = w.db.select().from(schema.tasks).all().find((t) => t.orderId === orderId && t.taskType === "Picking");
    if (!pick) throw new Error("no pick task");
    execute(w.db, w.ctx, { taskIds: [pick.id], targetLocationId: w.loc.pick, qty: 1 });
    expect(w.db.select().from(schema.missingLog).all()).toHaveLength(1);
    expect(orderRow(orderId)?.pickShortStatus).toBe("Open");
  });

  it("assigns and unassigns tasks", () => {
    const orderId = waveJob(1);
    const ids = w.db.select().from(schema.tasks).all().filter((t) => t.orderId === orderId).map((t) => t.id);
    expect(assignTasks(w.db, w.ctx, { ids, userId: w.userId }).failed).toEqual([]);
    expect(w.db.select().from(schema.tasks).all().filter((t) => ids.includes(t.id)).every((t) => t.assigneeUserId === w.userId)).toBe(true);
    assignTasks(w.db, w.ctx, { ids, userId: null });
    expect(w.db.select().from(schema.tasks).all().filter((t) => ids.includes(t.id)).every((t) => t.assigneeUserId === null)).toBe(true);
  });
});

// keep locationRow import used for future pick-path tests
void locationRow;
