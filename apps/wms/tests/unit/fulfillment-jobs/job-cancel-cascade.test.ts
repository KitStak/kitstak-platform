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

const stock = async (qty: number, productId = w.productId) =>
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId: w.loc.storageA, qty });
const tasksOf = async (jobId: string) => await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId));
const jobRow = async (id: string) => (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1))[0];
const orderRow = async (id: string) => (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
const allocated = async () => await w.db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.status, "Allocated"));

async function wave(): Promise<string[]> {
  const rule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name: "KS-CASCADE", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType, multiType],
    filters: [{ field: "orderQuantity", op: "rng", value: "1..10", label: "Order Quantity between 1 and 10" }],
  }));
  return (await runWave(w.db, w.ctx, rule.id, { runBy: "Admin" })).wave ? (await w.db.select().from(schema.jobs)).map((j) => j.id) : [];
}

/** A non-order job (Count / Replenishment) with pending tasks, the way waves create them. */
async function bareJob(operationType: "Count" | "Replenishment", tasks: number): Promise<string> {
  const jobType = (await w.db.insert(schema.jobTypes).values({
    code: `${operationType}-JT`, description: operationType, warehouseId: w.warehouseId, operationType, settings: jobTypeSettingsSchema.parse({}),
  }).returning())[0];
  const job = (await w.db.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: `Job${operationType}`, warehouseId: w.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType, status: "Pending", priority: "None",
  }).returning())[0];
  for (let i = 0; i < tasks; i += 1) {
    await w.db.insert(schema.tasks).values({
      taskNo: 9000 + i + (operationType === "Count" ? 100 : 0), jobId: job.id, warehouseId: w.warehouseId, taskType: operationType, status: "Pending",
      productId: w.productId, plannedQty: 2, sourceLocationId: w.loc.storageA, targetLocationId: w.loc.storageB,
      replenishmentPhase: operationType === "Replenishment" ? "Replenishment Pick Phase" : null,
    });
  }
  return job.id;
}

describe("job cancel cascade", () => {
  it("leaves no Pending task under a Cancelled picking job and releases every allocation", async () => {
    await stock(20);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    const jobIds = await wave();
    expect(jobIds.length).toBeGreaterThan(0);
    const res = await cancelJobs(w.db, w.ctx, jobIds);
    expect(res.failed).toEqual([]);
    for (const id of jobIds) {
      expect((await jobRow(id))?.status).toBe("Cancelled");
      expect((await tasksOf(id)).filter((t) => t.status === "Pending" || t.status === "Started")).toEqual([]);
    }
    expect(await allocated()).toHaveLength(0);
    expect((await w.db.select().from(schema.shipmentOrders)).every((o) => o.status === "Open" && o.jobId === null)).toBe(true);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("keeps a cancelled job's order and task history with agreeing counts (critic R5)", async () => {
    await stock(20);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = await wave();
    if (!jobId) throw new Error("no job");
    const before = (await tasksOf(jobId)).length;
    await cancelJobs(w.db, w.ctx, [jobId]);
    const d = await getJobDetail(w.db, auth, jobId);
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]?.released).toBe(true);
    expect(d.job.orderCount).toBe(1);
    expect(d.job.taskCount).toBe(before);
    expect(d.history).toMatchObject({ taskCount: before, cancelledTaskCount: before, liveTaskCount: 0 });
  });

  it.each(["Replenishment", "Count"] as const)("cancels every pending task of a %s job", async (op) => {
    const jobId = await bareJob(op, 3);
    const res = await cancelJobs(w.db, w.ctx, [jobId]);
    expect(res.failed).toEqual([]);
    expect((await jobRow(jobId))?.status).toBe("Cancelled");
    expect((await tasksOf(jobId)).every((t) => t.status === "Cancelled")).toBe(true);
    expect(res.message).toMatch(/1 job cancelled · 3 pending tasks cancelled/);
  });

  it("cancels the remaining work of a part-way executed job and keeps completed work", async () => {
    await stock(20);
    const a = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = await wave();
    if (!jobId) throw new Error("no job");
    const pickA = (await tasksOf(jobId)).find((t) => t.orderId === a.id && t.taskType === "Picking");
    if (!pickA) throw new Error("no pick task");
    await execute(w.db, w.ctx, { taskIds: [pickA.id], targetLocationId: w.loc.pick });

    const res = await cancelJobs(w.db, w.ctx, [jobId]);
    expect(res.failed).toEqual([]);
    const tasks = await tasksOf(jobId);
    // No pending picking work remains; order A keeps its pack task for the picked unit.
    expect(tasks.filter((t) => t.taskType === "Picking" && t.status === "Pending")).toEqual([]);
    expect(tasks.find((t) => t.orderId === a.id && t.taskType === "Packing")?.status).toBe("Pending");
    expect(tasks.filter((t) => t.orderId === b.id).every((t) => t.status === "Cancelled")).toBe(true);
    expect((await orderRow(b.id))?.status).toBe("Open");
    expect((await orderRow(b.id))?.jobId).toBeNull();
    expect((await orderRow(a.id))?.status).toBe("Ready to Pack");
    expect(await allocated()).toHaveLength(0);
    expect(res.message).toMatch(/completed work kept/);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("refuses Completed jobs and stale versions", async () => {
    const jobId = await bareJob("Replenishment", 1);
    const stale = await cancelJobs(w.db, w.ctx, [jobId], { [jobId]: 99 });
    expect(stale.failed[0]?.code).toBe("CONFLICT");
    await cancelJobs(w.db, w.ctx, [jobId]);
    expect((await cancelJobs(w.db, w.ctx, [jobId])).failed[0]?.code).toBe("INVALID_STATE");
  });
});

describe("pick task cancel cascade", () => {
  it("cancels the matching pack task, releases the allocation and keeps the order consistent", async () => {
    await stock(10);
    await stock(10, w.product2Id);
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }, { productId: w.product2Id, quantity: 3 }]));
    const [jobId] = await wave();
    if (!jobId) throw new Error("no job");
    const pick2 = (await tasksOf(jobId)).find((t) => t.taskType === "Picking" && t.productId === w.product2Id);
    if (!pick2) throw new Error("no pick");
    const res = await cancelTasks(w.db, w.ctx, [pick2.id]);
    expect(res.failed).toEqual([]);
    expect(res.message).toMatch(/1 task cancelled · 1 dependent task adjusted · 1 order flagged pick short/);
    const pack2 = (await tasksOf(jobId)).find((t) => t.taskType === "Packing" && t.productId === w.product2Id);
    expect(pack2?.status).toBe("Cancelled");
    expect((await tasksOf(jobId)).find((t) => t.taskType === "Packing" && t.productId === w.productId)?.status).toBe("Pending");
    expect((await allocated()).filter((x) => x.orderLineId === pick2.orderLineId)).toHaveLength(0);
    expect((await orderRow(o.id))?.pickShortStatus).toBe("Open");
    const pick1 = (await tasksOf(jobId)).find((t) => t.taskType === "Picking" && t.productId === w.productId);
    if (!pick1) throw new Error("no pick");
    await execute(w.db, w.ctx, { taskIds: [pick1.id], targetLocationId: w.loc.pick });
    expect((await orderRow(o.id))?.status).toBe("Ready to Pack");
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("returns an order to Open and out of the job when its only pick is cancelled", async () => {
    await stock(10);
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = await wave();
    if (!jobId) throw new Error("no job");
    const pick = (await tasksOf(jobId)).find((t) => t.taskType === "Picking");
    if (!pick) throw new Error("no pick");
    await cancelTasks(w.db, w.ctx, [pick.id]);
    expect((await orderRow(o.id))?.status).toBe("Open");
    expect((await tasksOf(jobId)).filter((t) => t.status !== "Cancelled")).toEqual([]);
    expect(await w.db.select().from(schema.jobOrders).where(and(eq(schema.jobOrders.jobId, jobId), ne(schema.jobOrders.orderId, "")))).toHaveLength(0);
  });
});

describe("job versions", () => {
  it("bumps the version on priority / assign changes and rejects stale writes", async () => {
    const jobId = await bareJob("Replenishment", 1);
    const v0 = (await jobRow(jobId))?.version ?? 0;
    expect((await updateJobsPriority(w.db, w.ctx, [jobId], "Medium")).failed).toEqual([]);
    expect((await updateJobsPriority(w.db, w.ctx, [jobId], "None")).failed).toEqual([]);
    expect((await jobRow(jobId))?.version).toBe(v0 + 2);
    expect((await updateJobsPriority(w.db, w.ctx, [jobId], "High", { [jobId]: v0 })).failed[0]?.code).toBe("CONFLICT");
    expect((await assignJobs(w.db, w.ctx, [jobId], w.userId, { [jobId]: v0 + 2 })).failed).toEqual([]);
    expect((await jobRow(jobId))?.version).toBe(v0 + 3);
    expect((await assignJobs(w.db, w.ctx, [jobId], null)).failed).toEqual([]);
    expect((await assignJobs(w.db, w.ctx, [jobId], null)).failed[0]?.message).toMatch(/no assignee/);
  });
});

describe("scheduled rules", () => {
  it("computes a next run for active scheduled rules inserted without one", async () => {
    const rule = await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
      name: "KS-SCHED", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType], scheduleDays: ["Mon", "Wed", "Fri"], scheduleTimes: ["11:00"],
    }));
    await w.db.update(schema.waveRules).set({ nextRunAt: null }).where(eq(schema.waveRules.id, rule.id));
    expect(await ensureNextRuns(w.db, new Date("2026-11-09T12:00:00Z"))).toBe(1);
    const next = (await w.db.select().from(schema.waveRules).where(eq(schema.waveRules.id, rule.id)).limit(1))[0]?.nextRunAt;
    expect(next).toBe("2026-11-09T17:00:00.000Z"); // Mon 11:00 America/Chicago (it is 06:00 local)
    expect(await ensureNextRuns(w.db, new Date("2026-11-09T12:00:00Z"))).toBe(0);
  });
});

describe("shortage actions", () => {
  it("reports unknown shortage ids as missing", async () => {
    expect(await resolveShortageIds(w.db, auth, ["nope-1", "nope-2"])).toEqual({ orderIds: [], missing: ["nope-1", "nope-2"] });
  });
});
