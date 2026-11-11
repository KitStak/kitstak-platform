/**
 * Picking jobs (BUILD_PLAN F5 `jobs.ts`): create jobs from allocated orders, merge,
 * cancel, assign, prioritise, remove orders, progress.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { jobTypeSettingsSchema, parseSettings, type JobTypeSettings } from "@/lib/domain-types";
import type { Priority } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { allocateOrders, deallocateOrder } from "./allocation";
import { recordCreate, recordUpdate } from "./change-log";
import { evaluateFilters } from "./conditions";
import { DomainError, describeError } from "./errors";
import { bucketFacts, orderFacts, sortByClauses, type OrderLineRow, type OrderRow } from "./facts";
import { releaseAllocation } from "./ledger/allocations";
import type { AllocationRow } from "./ledger/bucket";
import { jobProgress, rollupJob, type JobProgress } from "./progress";
import { next } from "./sequences";
import { stateMachines } from "./state-machines";
import { checkScope, type BulkResult, type DomainCtx, type Tx } from "./types";
import { dbGet, forEachSeq } from "@/server/db/sql";

export type JobRow = typeof schema.jobs.$inferSelect;
export type JobTypeRow = typeof schema.jobTypes.$inferSelect;
type TaskInsert = typeof schema.tasks.$inferInsert;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export async function getJob(tx: Tx, ctx: DomainCtx, jobId: string): Promise<JobRow> {
  const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job) throw new DomainError("NOT_FOUND", "Job not found");
  checkScope(ctx, { warehouseId: job.warehouseId, clientId: job.clientId }, "Job");
  return job;
}

async function nextTaskNo(tx: Tx): Promise<number> {
  return ((await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(task_no) AS n FROM tasks`))?.n ?? 0) + 1;
}

export function orderUnits(lines: readonly OrderLineRow[]): number {
  return lines.reduce((s, l) => s + Math.max(0, l.quantity - l.cancelledQuantity), 0);
}

const signature = (lines: readonly OrderLineRow[]): string =>
  lines.filter((l) => l.quantity - l.cancelledQuantity > 0).map((l) => `${l.productId}:${l.quantity - l.cancelledQuantity}`).sort().join("|");

interface Candidate { readonly order: OrderRow; readonly lines: readonly OrderLineRow[]; readonly units: number }

async function eligibility(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, settings: JobTypeSettings, orderId: string): Promise<Candidate> {
  const order = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1))[0];
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  const needsAllocation = order.status === "Open" || order.status === "Shortage";
  if (order.status !== "Ready to Pick" && !needsAllocation) {
    throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Open, Shortage or Ready to Pick orders can be added to a job.`);
  }
  if (order.jobId) throw new DomainError("INVALID_STATE", `Order ${order.code} is already in a job.`);
  if (order.warehouseId !== jobType.warehouseId) throw new DomainError("VALIDATION", `Order ${order.code} is in another warehouse than job type ${jobType.code}.`);
  const lines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  const units = orderUnits(lines);
  const scope = settings.orderScope;
  if (scope === "Single Item Orders" && units !== 1) throw new DomainError("RULE_VIOLATION", `Order ${order.code} is not a single item order.`);
  if (scope === "Multi-Item Orders" && units < 2) throw new DomainError("RULE_VIOLATION", `Order ${order.code} is not a multi-item order.`);
  if (!evaluateFilters(jobType.conditions, await orderFacts(tx, order, lines))) {
    throw new DomainError("RULE_VIOLATION", `Order ${order.code} does not meet the conditions of job type ${jobType.code}.`);
  }
  if (!needsAllocation) return { order, lines, units };
  // Picking/Job Operations allocates Open / Shortage orders first (warehouse algorithm, full mode),
  // like Logiwa; a short order stays Shortage with its allocation exception and is not added.
  const res = await allocateOrders(tx, ctx, { orderIds: [order.id], warehouseId: order.warehouseId, mode: "full" });
  if (res.failed.length > 0) throw new DomainError("INVALID_STATE", res.failed[0].message);
  if (!res.allocated.includes(order.id)) throw new DomainError("INSUFFICIENT_STOCK", `Order ${order.code} could not be fully allocated; it is in Shortage.`);
  const fresh = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, order.id)).limit(1))[0] ?? order;
  const freshLines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  return { order: fresh, lines: freshLines, units: orderUnits(freshLines) };
}

function batches(cands: readonly Candidate[], settings: JobTypeSettings, batchSize?: number): Candidate[][] {
  const max = Math.max(1, batchSize ?? settings.batch.max);
  const groups = new Map<string, Candidate[]>();
  const grouped = settings.orderScope === "Identical Item Orders" || settings.orderScope === "Identical Kit to Order";
  for (const c of cands) {
    const key = grouped ? signature(c.lines) : "*";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: Candidate[][] = [];
  for (const group of groups.values()) {
    let current: Candidate[] = [];
    let units = 0;
    for (const c of group) {
      const over = settings.batch.method === "Nof Item" ? units + c.units > max && current.length > 0 : current.length >= max;
      if (over) { out.push(current); current = []; units = 0; }
      current.push(c);
      units += c.units;
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

export async function loadJobType(tx: Tx, jobTypeId: string): Promise<{ jobType: JobTypeRow; settings: JobTypeSettings }> {
  const jobType = (await tx.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, jobTypeId)).limit(1))[0];
  if (!jobType) throw new DomainError("NOT_FOUND", "Job type not found");
  if (!jobType.isActive) throw new DomainError("INVALID_STATE", `Job type ${jobType.code} is inactive.`);
  return { jobType, settings: parseSettings(jobTypeSettingsSchema, jobType.settings) };
}

interface TaskPlanOptions { readonly minutesPerTask: number; readonly start: Date; readonly priority: Priority; readonly assigneeUserId: string | null }

/** Builds picking (+ sorting/packing/loading) tasks for orders added to a job. */
async function buildTasks(tx: Tx, ctx: DomainCtx, job: JobRow, jobType: JobTypeRow, settings: JobTypeSettings, cands: readonly Candidate[], opts: TaskPlanOptions, allocationFilter?: readonly string[]): Promise<number> {
  const orderIds = cands.map((c) => c.order.id);
  const allocWhere = [inArray(schema.inventoryAllocations.orderId, orderIds), eq(schema.inventoryAllocations.status, "Allocated")];
  if (allocationFilter) allocWhere.push(inArray(schema.inventoryAllocations.id, [...allocationFilter]));
  else allocWhere.push(isNull(schema.inventoryAllocations.taskId));
  const allocs = await tx.select({ a: schema.inventoryAllocations, inv: schema.inventory, loc: schema.locations })
    .from(schema.inventoryAllocations)
    .innerJoin(schema.inventory, eq(schema.inventory.id, schema.inventoryAllocations.inventoryId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventory.locationId))
    .where(and(...allocWhere));
  const ordered = sortByClauses(allocs, jobType.orderBy, (r) => bucketFacts(r.inv, r.loc, null));
  let taskNo = await nextTaskNo(tx);
  let seq = (await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(sequence) AS n FROM tasks WHERE job_id = ${job.id}`))?.n ?? 0;
  const startMs = opts.start.getTime();
  const clientOfOrder = new Map(cands.map((c) => [c.order.id, c.order.clientId]));
  const base = (type: TaskInsert["taskType"], extra: Partial<TaskInsert>): TaskInsert => {
    seq += 1;
    const t: TaskInsert = {
      // A multi-client job has no client; each task still carries its own order's client.
      taskNo: taskNo++, jobId: job.id, warehouseId: job.warehouseId, clientId: job.clientId ?? (extra.orderId ? clientOfOrder.get(extra.orderId) ?? null : null), taskType: type, status: "Pending",
      priority: opts.priority, sequence: seq, assigneeUserId: opts.assigneeUserId,
      plannedStartAt: new Date(startMs).toISOString(), plannedFinishAt: new Date(startMs + seq * opts.minutesPerTask * MINUTE_MS).toISOString(),
      createdBy: ctx.userId, updatedBy: ctx.userId, ...extra,
    };
    return t;
  };
  let count = 0;
  for (const { a, inv } of ordered) {
    const row = (await tx.insert(schema.tasks).values(base("Picking", {
      orderId: a.orderId, orderLineId: a.orderLineId, allocationId: a.id, productId: inv.productId, packType: inv.packType,
      plannedQty: a.qty, sourceLocationId: inv.locationId, sourceLpId: inv.lpId, lotNumber: inv.lotNumber,
      expiryDate: inv.expiryDate, productionDate: inv.productionDate,
    })).returning({ id: schema.tasks.id }))[0];
    await tx.update(schema.inventoryAllocations).set({ jobId: job.id, taskId: row.id, updatedBy: ctx.userId }).where(eq(schema.inventoryAllocations.id, a.id));
    count += 1;
  }
  if (allocationFilter) return count;
  for (const c of cands) {
    for (const line of c.lines.filter((l) => l.allocatedQuantity > 0)) {
      const lineExtra = { orderId: c.order.id, orderLineId: line.id, productId: line.productId, packType: line.packType, plannedQty: line.allocatedQuantity };
      if (settings.picking.createSortingTask) { await tx.insert(schema.tasks).values(base("Sorting", lineExtra)); count += 1; }
      if (!settings.picking.onlyPick) { await tx.insert(schema.tasks).values(base("Packing", lineExtra)); count += 1; }
    }
    if (settings.picking.createLoadingTask) {
      await tx.insert(schema.tasks).values(base("Loading", { orderId: c.order.id, plannedQty: orderUnits(c.lines) }));
      count += 1;
    }
  }
  return count;
}

async function insertJob(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, clientId: string | null, opts: TaskPlanOptions & { waveId?: string | null; waveNo?: string | null; isResolutionJob?: boolean }): Promise<JobRow> {
  const startMs = opts.start.getTime();
  const job = (await tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: await next(tx, "job"), warehouseId: jobType.warehouseId, clientId, jobType: jobType.code,
    jobTypeId: jobType.id, operationType: jobType.operationType, status: "Pending", priority: opts.priority,
    assignedToUserId: opts.assigneeUserId, waveId: opts.waveId ?? null, waveNumber: opts.waveNo ?? null,
    plannedStartAt: new Date(startMs).toISOString(), plannedEndAt: new Date(startMs + HOUR_MS).toISOString(),
    isResolutionJob: opts.isResolutionJob ?? false, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  await recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  return job;
}

async function attachOrders(tx: Tx, ctx: DomainCtx, job: JobRow, cands: readonly Candidate[]): Promise<void> {
  for (const c of cands) {
    await tx.insert(schema.jobOrders).values({ jobId: job.id, orderId: c.order.id }).onConflictDoNothing();
    await tx.update(schema.shipmentOrders).set({ jobId: job.id, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, c.order.id));
    await recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: c.order.id, entityCode: c.order.code, before: { jobId: null }, after: { jobId: job.code } });
  }
}

export interface CreateJobsInput {
  readonly orderIds: readonly string[];
  readonly jobTypeId: string;
  readonly batchSize?: number;
  readonly assigneeUserId?: string | null;
  readonly waveId?: string | null;
  readonly waveNo?: string | null;
  readonly priority?: Priority;
  /** Planned minutes per task (default 1). */
  readonly minutesPerTask?: number;
  readonly now?: Date;
}

export interface CreateJobsResult extends BulkResult {
  readonly jobIds: readonly string[];
}

export async function createJobsFromOrders(tx: Tx, ctx: DomainCtx, input: CreateJobsInput): Promise<CreateJobsResult> {
  const { jobType, settings } = await loadJobType(tx, input.jobTypeId);
  if (jobType.operationType !== "Picking") throw new DomainError("VALIDATION", `Job type ${jobType.code} is not a picking job type.`);
  if (input.assigneeUserId) await assertUserInWarehouse(tx, input.assigneeUserId, jobType.warehouseId);
  const failed: { id: string; code: string; message: string }[] = [];
  const cands: Candidate[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try { cands.push(await eligibility(tx, ctx, jobType, settings, id)); } catch (e) { failed.push({ id, ...describeError(e) }); }
  }
  const opts: TaskPlanOptions = {
    minutesPerTask: input.minutesPerTask ?? 1, start: new Date((input.now ?? new Date()).getTime() + HOUR_MS),
    priority: input.priority ?? "None", assigneeUserId: input.assigneeUserId ?? null,
  };
  const jobIds: string[] = [];
  const succeeded: string[] = [];
  for (const batch of batches(cands, settings, input.batchSize)) {
    if (batch.length < settings.batch.min && settings.batch.method === "Nof Order") {
      for (const c of batch) failed.push({ id: c.order.id, code: "RULE_VIOLATION", message: `Fewer than ${settings.batch.min} orders for job type ${jobType.code}.` });
      continue;
    }
    const clients = new Set(batch.map((c) => c.order.clientId));
    const job = await insertJob(tx, ctx, jobType, clients.size === 1 ? batch[0].order.clientId : null, { ...opts, waveId: input.waveId, waveNo: input.waveNo });
    await attachOrders(tx, ctx, job, batch);
    await buildTasks(tx, ctx, job, jobType, settings, batch, opts);
    await rollupJob(tx, ctx, job.id);
    jobIds.push(job.id);
    succeeded.push(...batch.map((c) => c.order.id));
  }
  return { succeeded, failed, jobIds };
}

/** Adds orders to an existing Pending/Started job of the same job type. */
export async function mergeIntoJob(tx: Tx, ctx: DomainCtx, input: { jobId: string; orderIds: readonly string[] }): Promise<BulkResult> {
  const job = await getJob(tx, ctx, input.jobId);
  if (job.status !== "Pending" && job.status !== "Started" && job.status !== "In Progress") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
  if (!job.jobTypeId) throw new DomainError("INVALID_STATE", `Job ${job.code} has no job type.`);
  const { jobType, settings } = await loadJobType(tx, job.jobTypeId);
  const failed: { id: string; code: string; message: string }[] = [];
  const cands: Candidate[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try { cands.push(await eligibility(tx, ctx, jobType, settings, id)); } catch (e) { failed.push({ id, ...describeError(e) }); }
  }
  if (cands.length > 0) {
    await attachOrders(tx, ctx, job, cands);
    await buildTasks(tx, ctx, job, jobType, settings, cands, { minutesPerTask: 1, start: new Date(job.plannedStartAt ?? Date.now()), priority: job.priority, assigneeUserId: job.assignedToUserId });
    if (job.clientId && cands.some((c) => c.order.clientId !== job.clientId)) await tx.update(schema.jobs).set({ clientId: null }).where(eq(schema.jobs.id, job.id));
    await rollupJob(tx, ctx, job.id);
  }
  return { succeeded: cands.map((c) => c.order.id), failed };
}

/** Resolution job for a pick-short: picking tasks for the given (re)allocations. */
export async function createResolutionJob(tx: Tx, ctx: DomainCtx, input: { sourceJobId: string; orderId: string; allocationIds: readonly string[] }): Promise<JobRow | null> {
  if (input.allocationIds.length === 0) return null;
  const source = await getJob(tx, ctx, input.sourceJobId);
  if (!source.jobTypeId) return null;
  const { jobType, settings } = await loadJobType(tx, source.jobTypeId);
  const order = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, input.orderId)).limit(1))[0];
  if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
  const opts: TaskPlanOptions = { minutesPerTask: 1, start: new Date(Date.now() + HOUR_MS), priority: "High", assigneeUserId: null };
  const job = await insertJob(tx, ctx, jobType, order.clientId, { ...opts, waveNo: source.waveNumber, isResolutionJob: true });
  await tx.insert(schema.jobOrders).values({ jobId: job.id, orderId: order.id }).onConflictDoNothing();
  await buildTasks(tx, ctx, job, jobType, settings, [{ order, lines: [], units: 0 }], opts, input.allocationIds);
  await rollupJob(tx, ctx, job.id);
  return job;
}

async function pickedTaskCount(tx: Tx, jobId: string): Promise<number> {
  return (await tx.select({ n: sql<number>`COUNT(*)` }).from(schema.tasks)
    .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.status, "Completed"))).limit(1))[0]?.n ?? 0;
}

async function detachOrder(tx: Tx, ctx: DomainCtx, job: JobRow, orderId: string, release: boolean): Promise<void> {
  const order = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1))[0];
  if (!order) return;
  await tx.update(schema.tasks).set({ status: "Cancelled", updatedBy: ctx.userId })
    .where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.orderId, orderId), ne(schema.tasks.status, "Cancelled")));
  await tx.update(schema.inventoryAllocations).set({ jobId: null, taskId: null, updatedBy: ctx.userId })
    .where(and(eq(schema.inventoryAllocations.orderId, orderId), eq(schema.inventoryAllocations.jobId, job.id)));
  await tx.delete(schema.jobOrders).where(and(eq(schema.jobOrders.jobId, job.id), eq(schema.jobOrders.orderId, orderId)));
  if (order.jobId === job.id) {
    await tx.update(schema.shipmentOrders).set({ jobId: null, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, orderId));
    await recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { jobId: job.code }, after: { jobId: null } });
  }
  if (release) await deallocateOrder(tx, ctx, { ...order, jobId: null });
}

/** Cancels a job that has no completed tasks; its orders' allocations are released (orders back to Open). */
export async function cancelJob(tx: Tx, ctx: DomainCtx, input: { jobId: string }): Promise<JobRow> {
  const job = await getJob(tx, ctx, input.jobId);
  const status = stateMachines.job.transition(job.status, "Cancelled");
  if ((await pickedTaskCount(tx, job.id)) > 0) throw new DomainError("INVALID_STATE", `Job ${job.code} has completed tasks and can't be cancelled.`);
  const orders = await tx.select({ orderId: schema.jobOrders.orderId }).from(schema.jobOrders).where(eq(schema.jobOrders.jobId, job.id));
  for (const o of orders) await detachOrder(tx, ctx, job, o.orderId, true);
  const updated = (await tx.update(schema.jobs).set({ status, updatedBy: ctx.userId }).where(eq(schema.jobs.id, job.id)).returning())[0];
  await recordUpdate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code, before: { status: job.status }, after: { status } });
  return updated;
}

/** Removes an order whose tasks are all pending; it keeps its allocation (Ready to Pick). */
export async function removeOrderFromJob(tx: Tx, ctx: DomainCtx, input: { jobId: string; orderId: string }): Promise<void> {
  const job = await getJob(tx, ctx, input.jobId);
  if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
  const tasks = await tx.select().from(schema.tasks)
    .where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.orderId, input.orderId), ne(schema.tasks.status, "Cancelled")));
  if (tasks.length === 0) throw new DomainError("NOT_FOUND", "The order is not in this job");
  if (tasks.some((t) => t.status === "Completed" || t.status === "Started")) throw new DomainError("INVALID_STATE", "Work has started for this order; it can't be removed from the job.");
  await detachOrder(tx, ctx, job, input.orderId, false);
  await rollupJob(tx, ctx, job.id);
}

export async function assertUserInWarehouse(tx: Tx, userId: string, warehouseId: string): Promise<void> {
  const user = (await tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  if (!user || !user.isActive) throw new DomainError("NOT_FOUND", "User not found");
  if (user.role === "admin") return;
  const links = await tx.select({ wh: schema.userWarehouses.warehouseId }).from(schema.userWarehouses).where(eq(schema.userWarehouses.userId, userId));
  if (links.length > 0 && !links.some((l) => l.wh === warehouseId)) {
    throw new DomainError("VALIDATION", `${user.name} is not assigned to this job's warehouse.`);
  }
}

export async function assign(tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[]; userId: string | null }): Promise<BulkResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.jobIds)]) {
    try {
      const job = await getJob(tx, ctx, id);
      if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
      if (input.userId) await assertUserInWarehouse(tx, input.userId, job.warehouseId);
      await tx.update(schema.jobs).set({ assignedToUserId: input.userId, version: sql`version + 1`, updatedBy: ctx.userId }).where(eq(schema.jobs.id, id));
      await tx.update(schema.tasks).set({ assigneeUserId: input.userId }).where(and(eq(schema.tasks.jobId, id), eq(schema.tasks.status, "Pending")));
      await recordUpdate(tx, ctx, { entityType: "job", entityId: id, entityCode: job.code, before: { assignee: await userDisplayName(tx, job.assignedToUserId) }, after: { assignee: await userDisplayName(tx, input.userId) } });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed };
}

/** Display name of a user for change-log rows (never a raw id). */
export async function userDisplayName(tx: Tx, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = (await tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  return u ? (u.name || u.email) : "Unknown user";
}

export const unassign = async (tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[] }): Promise<BulkResult> => await assign(tx, ctx, { jobIds: input.jobIds, userId: null });

export async function updatePriority(tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[]; priority: Priority }): Promise<BulkResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.jobIds)]) {
    try {
      const job = await getJob(tx, ctx, id);
      if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
      await tx.update(schema.jobs).set({ priority: input.priority, version: sql`version + 1`, updatedBy: ctx.userId }).where(eq(schema.jobs.id, id));
      await tx.update(schema.tasks).set({ priority: input.priority }).where(and(eq(schema.tasks.jobId, id), ne(schema.tasks.status, "Completed")));
      await recordUpdate(tx, ctx, { entityType: "job", entityId: id, entityCode: job.code, before: { priority: job.priority }, after: { priority: input.priority } });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed };
}

export async function getJobProgress(tx: Tx, ctx: DomainCtx, jobId: string): Promise<JobProgress> {
  await getJob(tx, ctx, jobId);
  return await jobProgress(tx, jobId);
}

/** Releases one allocation's unpicked remainder (used by pick-short and task cancel). */
export async function releaseForLine(tx: Tx, ctx: DomainCtx, alloc: AllocationRow, qty: number): Promise<void> {
  if (qty <= 0) return;
  await releaseAllocation(tx, ctx, { allocationId: alloc.id, qty });
  if (alloc.orderLineId) {
    await tx.update(schema.orderLines).set({ allocatedQuantity: sql`GREATEST(${schema.orderLines.allocatedQuantity} - ${qty}, 0)`, updatedBy: ctx.userId })
      .where(eq(schema.orderLines.id, alloc.orderLineId));
  }
}

/* ------------------------------------------------------------- count jobs */
export interface CountTaskSpec {
  readonly countLineId: string;
  readonly productId: string | null;
  readonly locationId: string | null;
  readonly lpId: string | null;
  readonly plannedQty: number;
}

export interface CreateCountJobInput {
  readonly jobTypeId: string;
  readonly countPlanId: string;
  readonly waveRuleId?: string | null;
  readonly assigneeUserId: string | null;
  readonly tasks: readonly CountTaskSpec[];
}

/**
 * Inserts one Count job with one Count task per spec (docs/requests/counts.md REQ-3), so count
 * modules do not write `jobs` / `tasks` rows themselves. Sequence code, change_log and rollup
 * follow the picking path; status changes afterwards go through the state machines / tasks.*.
 */
export async function createCountJob(tx: Tx, ctx: DomainCtx, input: CreateCountJobInput): Promise<JobRow> {
  const { jobType } = await loadJobType(tx, input.jobTypeId);
  if (jobType.operationType !== "Count") throw new DomainError("VALIDATION", `Job type ${jobType.code} is not a count job type.`);
  if (input.tasks.length === 0) throw new DomainError("VALIDATION", "A count job needs at least one task.");
  if (input.assigneeUserId) await assertUserInWarehouse(tx, input.assigneeUserId, jobType.warehouseId);
  const now = Date.now();
  const job = (await tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: await next(tx, "job"), warehouseId: jobType.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType: "Count", status: "Pending", assignedToUserId: input.assigneeUserId, countPlanId: input.countPlanId,
    waveRuleId: input.waveRuleId ?? null,
    plannedStartAt: new Date(now).toISOString(), plannedEndAt: new Date(now + HOUR_MS).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  await recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = await nextTaskNo(tx);
  await forEachSeq(input.tasks, async (t, i) => {
    await tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: job.warehouseId, taskType: "Count", status: "Pending", sequence: i + 1,
      countPlanId: input.countPlanId, countLineId: t.countLineId, productId: t.productId, sourceLocationId: t.locationId, sourceLpId: t.lpId,
      plannedQty: t.plannedQty, assigneeUserId: input.assigneeUserId, plannedStartAt: job.plannedStartAt, createdBy: ctx.userId, updatedBy: ctx.userId,
    });
  });
  await rollupJob(tx, ctx, job.id);
  return job;
}
