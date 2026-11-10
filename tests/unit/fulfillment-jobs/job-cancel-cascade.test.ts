/**
 * M03 round 2: job / task cancel cascade for every operation type, job version bumps
 * (optimistic concurrency), scheduled next-run self-heal and shortage id resolution.
 */
import { and, eq, ne } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { execute } from "@/server/domain/tasks";
import { assignJobs, cancelJobs, cancelTasks, updateJobsPriority } from "@/server/repositories/jobs-commands";
import { createWaveRule, ensureNextRuns } from "@/server/repositories/wave-rules";
import { resolveShortageIds } from "@/server/repositories/waves";
import { getJobDetail } from "@/server/repositories/jobs";
import { runWave } from "@/server/repositories/waves-run";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

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

const stock = (qty: number, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId: w.loc.storageA, qty });
const tasksOf = (jobId: string) => w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all();
const jobRow = (id: string) => w.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
const orderRow = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
const allocated = () => w.db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.status, "Allocated")).all();

function wave(): string[] {
  const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name: "KS-CASCADE", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType, multiType],
    filters: [{ field: "orderQuantity", op: "rng", value: "1..10", label: "Order Quantity between 1 and 10" }],
  }));
  return runWave(w.db, w.ctx, rule.id, { runBy: "Admin" }).wave ? w.db.select().from(schema.jobs).all().map((j) => j.id) : [];
}

/** A non-order job (Count / Replenishment) with pending tasks, the way waves create them. */
function bareJob(operationType: "Count" | "Replenishment", tasks: number): string {
  const jobType = w.db.insert(schema.jobTypes).values({
    code: `${operationType}-JT`, description: operationType, warehouseId: w.warehouseId, operationType, settings: jobTypeSettingsSchema.parse({}),
  }).returning().get();
  const job = w.db.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: `Job${operationType}`, warehouseId: w.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType, status: "Pending", priority: "None",
  }).returning().get();
  for (let i = 0; i < tasks; i += 1) {
    w.db.insert(schema.tasks).values({
      taskNo: 9000 + i + (operationType === "Count" ? 100 : 0), jobId: job.id, warehouseId: w.warehouseId, taskType: operationType, status: "Pending",
      productId: w.productId, plannedQty: 2, sourceLocationId: w.loc.storageA, targetLocationId: w.loc.storageB,
      replenishmentPhase: operationType === "Replenishment" ? "Replenishment Pick Phase" : null,
    }).run();
  }
  return job.id;
}

describe("job cancel cascade", () => {
  it("leaves no Pending task under a Cancelled picking job and releases every allocation", () => {
    stock(20);
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    const jobIds = wave();
    expect(jobIds.length).toBeGreaterThan(0);
    const res = cancelJobs(w.db, w.ctx, jobIds);
    expect(res.failed).toEqual([]);
    for (const id of jobIds) {
      expect(jobRow(id)?.status).toBe("Cancelled");
      expect(tasksOf(id).filter((t) => t.status === "Pending" || t.status === "Started")).toEqual([]);
    }
    expect(allocated()).toHaveLength(0);
    expect(w.db.select().from(schema.shipmentOrders).all().every((o) => o.status === "Open" && o.jobId === null)).toBe(true);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("keeps a cancelled job's order and task history with agreeing counts (critic R5)", () => {
    stock(20);
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = wave();
    if (!jobId) throw new Error("no job");
    const before = tasksOf(jobId).length;
    cancelJobs(w.db, w.ctx, [jobId]);
    const d = getJobDetail(w.db, auth, jobId);
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]?.released).toBe(true);
    expect(d.job.orderCount).toBe(1);
    expect(d.job.taskCount).toBe(before);
    expect(d.history).toMatchObject({ taskCount: before, cancelledTaskCount: before, liveTaskCount: 0 });
  });

  it.each(["Replenishment", "Count"] as const)("cancels every pending task of a %s job", (op) => {
    const jobId = bareJob(op, 3);
    const res = cancelJobs(w.db, w.ctx, [jobId]);
    expect(res.failed).toEqual([]);
    expect(jobRow(jobId)?.status).toBe("Cancelled");
    expect(tasksOf(jobId).every((t) => t.status === "Cancelled")).toBe(true);
    expect(res.message).toMatch(/1 job cancelled · 3 pending tasks cancelled/);
  });

  it("cancels the remaining work of a part-way executed job and keeps completed work", () => {
    stock(20);
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = wave();
    if (!jobId) throw new Error("no job");
    const pickA = tasksOf(jobId).find((t) => t.orderId === a.id && t.taskType === "Picking");
    if (!pickA) throw new Error("no pick task");
    execute(w.db, w.ctx, { taskIds: [pickA.id], targetLocationId: w.loc.pick });

    const res = cancelJobs(w.db, w.ctx, [jobId]);
    expect(res.failed).toEqual([]);
    const tasks = tasksOf(jobId);
    // No pending picking work remains; order A keeps its pack task for the picked unit.
    expect(tasks.filter((t) => t.taskType === "Picking" && t.status === "Pending")).toEqual([]);
    expect(tasks.find((t) => t.orderId === a.id && t.taskType === "Packing")?.status).toBe("Pending");
    expect(tasks.filter((t) => t.orderId === b.id).every((t) => t.status === "Cancelled")).toBe(true);
    expect(orderRow(b.id)?.status).toBe("Open");
    expect(orderRow(b.id)?.jobId).toBeNull();
    expect(orderRow(a.id)?.status).toBe("Ready to Pack");
    expect(allocated()).toHaveLength(0);
    expect(res.message).toMatch(/completed work kept/);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses Completed jobs and stale versions", () => {
    const jobId = bareJob("Replenishment", 1);
    const stale = cancelJobs(w.db, w.ctx, [jobId], { [jobId]: 99 });
    expect(stale.failed[0]?.code).toBe("CONFLICT");
    cancelJobs(w.db, w.ctx, [jobId]);
    expect(cancelJobs(w.db, w.ctx, [jobId]).failed[0]?.code).toBe("INVALID_STATE");
  });
});

describe("pick task cancel cascade", () => {
  it("cancels the matching pack task, releases the allocation and keeps the order consistent", () => {
    stock(10);
    stock(10, w.product2Id);
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }, { productId: w.product2Id, quantity: 3 }]));
    const [jobId] = wave();
    if (!jobId) throw new Error("no job");
    const pick2 = tasksOf(jobId).find((t) => t.taskType === "Picking" && t.productId === w.product2Id);
    if (!pick2) throw new Error("no pick");
    const res = cancelTasks(w.db, w.ctx, [pick2.id]);
    expect(res.failed).toEqual([]);
    expect(res.message).toMatch(/1 task cancelled · 1 dependent task adjusted · 1 order flagged pick short/);
    const pack2 = tasksOf(jobId).find((t) => t.taskType === "Packing" && t.productId === w.product2Id);
    expect(pack2?.status).toBe("Cancelled");
    expect(tasksOf(jobId).find((t) => t.taskType === "Packing" && t.productId === w.productId)?.status).toBe("Pending");
    expect(allocated().filter((x) => x.orderLineId === pick2.orderLineId)).toHaveLength(0);
    expect(orderRow(o.id)?.pickShortStatus).toBe("Open");
    const pick1 = tasksOf(jobId).find((t) => t.taskType === "Picking" && t.productId === w.productId);
    if (!pick1) throw new Error("no pick");
    execute(w.db, w.ctx, { taskIds: [pick1.id], targetLocationId: w.loc.pick });
    expect(orderRow(o.id)?.status).toBe("Ready to Pack");
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("returns an order to Open and out of the job when its only pick is cancelled", () => {
    stock(10);
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = wave();
    if (!jobId) throw new Error("no job");
    const pick = tasksOf(jobId).find((t) => t.taskType === "Picking");
    if (!pick) throw new Error("no pick");
    cancelTasks(w.db, w.ctx, [pick.id]);
    expect(orderRow(o.id)?.status).toBe("Open");
    expect(tasksOf(jobId).filter((t) => t.status !== "Cancelled")).toEqual([]);
    expect(w.db.select().from(schema.jobOrders).where(and(eq(schema.jobOrders.jobId, jobId), ne(schema.jobOrders.orderId, ""))).all()).toHaveLength(0);
  });
});

describe("job versions", () => {
  it("bumps the version on priority / assign changes and rejects stale writes", () => {
    const jobId = bareJob("Replenishment", 1);
    const v0 = jobRow(jobId)?.version ?? 0;
    expect(updateJobsPriority(w.db, w.ctx, [jobId], "Medium").failed).toEqual([]);
    expect(updateJobsPriority(w.db, w.ctx, [jobId], "None").failed).toEqual([]);
    expect(jobRow(jobId)?.version).toBe(v0 + 2);
    expect(updateJobsPriority(w.db, w.ctx, [jobId], "High", { [jobId]: v0 }).failed[0]?.code).toBe("CONFLICT");
    expect(assignJobs(w.db, w.ctx, [jobId], w.userId, { [jobId]: v0 + 2 }).failed).toEqual([]);
    expect(jobRow(jobId)?.version).toBe(v0 + 3);
    expect(assignJobs(w.db, w.ctx, [jobId], null).failed).toEqual([]);
    expect(assignJobs(w.db, w.ctx, [jobId], null).failed[0]?.message).toMatch(/no assignee/);
  });
});

describe("scheduled rules", () => {
  it("computes a next run for active scheduled rules inserted without one", () => {
    const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
      name: "KS-SCHED", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType], scheduleDays: ["Mon", "Wed", "Fri"], scheduleTimes: ["11:00"],
    }));
    w.db.update(schema.waveRules).set({ nextRunAt: null }).where(eq(schema.waveRules.id, rule.id)).run();
    expect(ensureNextRuns(w.db, new Date("2026-11-09T12:00:00Z"))).toBe(1);
    const next = w.db.select().from(schema.waveRules).where(eq(schema.waveRules.id, rule.id)).get()?.nextRunAt;
    expect(next).toBe("2026-11-09T17:00:00.000Z"); // Mon 11:00 America/Chicago (it is 06:00 local)
    expect(ensureNextRuns(w.db, new Date("2026-11-09T12:00:00Z"))).toBe(0);
  });
});

describe("shortage actions", () => {
  it("reports unknown shortage ids as missing", () => {
    expect(resolveShortageIds(w.db, auth, ["nope-1", "nope-2"])).toEqual({ orderIds: [], missing: ["nope-1", "nope-2"] });
  });
});
