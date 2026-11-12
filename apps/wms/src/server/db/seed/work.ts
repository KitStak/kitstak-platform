/**
 * Outbound replay, part 3: task execution through `tasks.execute`. Pickers work their job
 * task by task (pick shorts write missing-log rows and resolution jobs), packers pack each
 * order at its pack station, B2B orders are loaded at the dock, then labels are scheduled.
 */
import { and, eq, inArray } from "drizzle-orm";
import { asc } from "@/server/db/order";
import * as schema from "@/server/db/schema";
import { jobs, tasks } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import type { WarehouseCode } from "../seed-orders";
import { MINUTE_MS } from "./runtime";
import { scheduleLabel } from "./shipping";
import { actor, txAt, type Id } from "./types";
import { checkBulk } from "./outbound";
import { facilityOf, noteFailure, operatorFor, orderStatus, type OrderRuntime, type World } from "./world";

type TaskRow = typeof schema.tasks.$inferSelect;

const shorted = new Set<Id>();
const packScheduled = new Set<Id>();

export function resetWorkState(): void {
  shorted.clear();
  packScheduled.clear();
}

function runtimeOf(w: World, orderId: Id | null): OrderRuntime | undefined {
  if (!orderId) return undefined;
  for (const r of w.orders.values()) if (r.id === orderId) return r;
  return undefined;
}

async function jobCtx(w: World, tx: Tx, jobId: Id, code: WarehouseCode): Promise<DomainCtx> {
  const job = (await tx.select({ userId: schema.jobs.assignedToUserId }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  const user = w.access.users.find((u) => u.id === job?.userId) ?? operatorFor(w, code, 0);
  return actor(user);
}

const pendingTasks = async (tx: Tx, where: ReturnType<typeof and>): Promise<TaskRow[]> =>
  await tx.select().from(schema.tasks).where(and(where, eq(schema.tasks.status, "Pending"))).orderBy(asc(schema.tasks.sequence));

async function serialsFor(tx: Tx, task: TaskRow, qty: number): Promise<string[]> {
  if (!task.allocationId || !task.productId) return [];
  const product = (await tx.select({ trackSerial: schema.products.trackSerial }).from(schema.products).where(eq(schema.products.id, task.productId)).limit(1))[0];
  if (!product?.trackSerial) return [];
  const alloc = (await tx.select({ inventoryId: schema.inventoryAllocations.inventoryId }).from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.id, task.allocationId)).limit(1))[0];
  if (!alloc) return [];
  return (await tx.select({ serial: schema.serialNumbers.primarySerial }).from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.inventoryId, alloc.inventoryId), inArray(schema.serialNumbers.status, ["Received", "Updated"])))
    .orderBy(asc(schema.serialNumbers.primarySerial)).limit(qty)).map((r) => r.serial);
}

function stationFor(w: World, code: WarehouseCode, seed: string): Id {
  const stations = facilityOf(w, code).packStations;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return stations[h % stations.length];
}

async function pickOne(w: World, code: WarehouseCode, taskId: Id, atMs: number): Promise<void> {
  const outcome = await txAt(w.env, atMs, async (tx) => {
    const task = (await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1))[0];
    if (!task || task.status !== "Pending") return null;
    const ctx = await jobCtx(w, tx, task.jobId, code);
    const runtime = runtimeOf(w, task.orderId);
    const remaining = task.plannedQty - task.actualQty;
    const short = runtime?.plan.fate === "pickShort" && !shorted.has(runtime.id) && remaining > 0;
    if (short && runtime) shorted.add(runtime.id);
    const qty = short ? remaining - 1 : remaining;
    const [result] = await tasks.execute(tx, ctx, {
      taskIds: [task.id], targetLocationId: stationFor(w, code, task.orderId ?? task.jobId), qty, serials: await serialsFor(tx, task, qty),
      createResolutionJob: short, note: short ? "Bin count lower than expected; one unit missing." : null,
    });
    return { orderId: task.orderId, resolutionJobId: result?.resolutionJobId ?? null, status: task.orderId ? await orderStatus(tx, task.orderId) : null };
  });
  if (!outcome) return;
  if (outcome.resolutionJobId) {
    const resolutionJobId = outcome.resolutionJobId;
    const at = atMs + 45 * MINUTE_MS;
    w.queue.schedule(at, "assign resolution job", async () => {
      await txAt(w.env, at, async (tx) => checkBulk(w, "assign resolution", await jobs.assign(tx, actor(w.access.manager), { jobIds: [resolutionJobId], userId: operatorFor(w, code, 1).id })));
      schedulePickJob(w, code, resolutionJobId, at + 20 * MINUTE_MS);
    });
  }
  if (outcome.orderId && (outcome.status === "Ready to Pack" || outcome.status === "Ready to Ship") && !packScheduled.has(outcome.orderId)) {
    packScheduled.add(outcome.orderId);
    schedulePack(w, code, outcome.orderId, atMs + w.env.rng.int(20, 80) * MINUTE_MS);
  }
}

/** Schedules every pending picking task of a job, about 90 seconds apart. */
export function schedulePickJob(w: World, code: WarehouseCode, jobId: Id, startMs: number): void {
  w.queue.schedule(startMs, `start job ${jobId}`, async () => {
    const list = await txAt(w.env, startMs, async (tx) => await pendingTasks(tx, and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.taskType, "Picking"))));
    list.forEach((t, i) => {
      const at = startMs + i * 90_000 + w.env.rng.int(0, 45_000);
      w.queue.schedule(at, `pick task ${t.taskNo}`, async () => await pickOne(w, code, t.id, at));
    });
  });
}

async function executeStep(w: World, code: WarehouseCode, orderId: Id, taskType: "Packing" | "Loading", atMs: number, target: Id): Promise<string | null> {
  return await txAt(w.env, atMs, async (tx) => {
    const list = await pendingTasks(tx, and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.taskType, taskType)));
    if (list.length === 0) return await orderStatus(tx, orderId);
    const ctx = actor(operatorFor(w, code, taskType === "Packing" ? 1 : 2));
    await tasks.execute(tx, ctx, { taskIds: list.map((t) => t.id), targetLocationId: target });
    return await orderStatus(tx, orderId);
  });
}

function afterStep(w: World, code: WarehouseCode, orderId: Id, status: string | null, atMs: number): void {
  if (status === "Ready to Load") {
    const at = atMs + w.env.rng.int(30, 70) * MINUTE_MS;
    const dock = facilityOf(w, code).load[0];
    w.queue.schedule(at, `load ${orderId}`, async () => afterStep(w, code, orderId, await executeStep(w, code, orderId, "Loading", at, dock), at));
    return;
  }
  if (status === "Ready to Ship") {
    const runtime = runtimeOf(w, orderId);
    if (runtime) scheduleLabel(w, runtime, atMs + w.env.rng.int(2, 8) * MINUTE_MS);
  }
}

function schedulePack(w: World, code: WarehouseCode, orderId: Id, atMs: number): void {
  w.queue.schedule(atMs, `pack ${orderId}`, async () => {
    try {
      const status = await executeStep(w, code, orderId, "Packing", atMs, stationFor(w, code, orderId));
      afterStep(w, code, orderId, status, atMs);
    } catch (error) {
      noteFailure(w, `pack ${orderId}`, error);
    }
  });
}
