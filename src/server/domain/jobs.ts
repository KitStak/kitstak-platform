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

export type JobRow = typeof schema.jobs.$inferSelect;
export type JobTypeRow = typeof schema.jobTypes.$inferSelect;
type TaskInsert = typeof schema.tasks.$inferInsert;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export function getJob(tx: Tx, ctx: DomainCtx, jobId: string): JobRow {
  const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) throw new DomainError("NOT_FOUND", "Job not found");
  checkScope(ctx, { warehouseId: job.warehouseId, clientId: job.clientId }, "Job");
  return job;
}

function nextTaskNo(tx: Tx): number {
  return (tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0) + 1;
}

export function orderUnits(lines: readonly OrderLineRow[]): number {
  return lines.reduce((s, l) => s + Math.max(0, l.quantity - l.cancelledQuantity), 0);
}

const signature = (lines: readonly OrderLineRow[]): string =>
  lines.filter((l) => l.quantity - l.cancelledQuantity > 0).map((l) => `${l.productId}:${l.quantity - l.cancelledQuantity}`).sort().join("|");

interface Candidate { readonly order: OrderRow; readonly lines: readonly OrderLineRow[]; readonly units: number }

function eligibility(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, settings: JobTypeSettings, orderId: string): Candidate {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  const needsAllocation = order.status === "Open" || order.status === "Shortage";
  if (order.status !== "Ready to Pick" && !needsAllocation) {
    throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Open, Shortage or Ready to Pick orders can be added to a job.`);
  }
  if (order.jobId) throw new DomainError("INVALID_STATE", `Order ${order.code} is already in a job.`);
  if (order.warehouseId !== jobType.warehouseId) throw new DomainError("VALIDATION", `Order ${order.code} is in another warehouse than job type ${jobType.code}.`);
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
  const units = orderUnits(lines);
  const scope = settings.orderScope;
  if (scope === "Single Item Orders" && units !== 1) throw new DomainError("RULE_VIOLATION", `Order ${order.code} is not a single item order.`);
  if (scope === "Multi-Item Orders" && units < 2) throw new DomainError("RULE_VIOLATION", `Order ${order.code} is not a multi-item order.`);
  if (!evaluateFilters(jobType.conditions, orderFacts(tx, order, lines))) {
    throw new DomainError("RULE_VIOLATION", `Order ${order.code} does not meet the conditions of job type ${jobType.code}.`);
  }
  if (!needsAllocation) return { order, lines, units };
  // Picking/Job Operations allocates Open / Shortage orders first (warehouse algorithm, full mode),
  // like Logiwa; a short order stays Shortage with its allocation exception and is not added.
  const res = allocateOrders(tx, ctx, { orderIds: [order.id], warehouseId: order.warehouseId, mode: "full" });
  if (res.failed.length > 0) throw new DomainError("INVALID_STATE", res.failed[0].message);
  if (!res.allocated.includes(order.id)) throw new DomainError("INSUFFICIENT_STOCK", `Order ${order.code} could not be fully allocated; it is in Shortage.`);
  const fresh = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, order.id)).get() ?? order;
  const freshLines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
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

export function loadJobType(tx: Tx, jobTypeId: string): { jobType: JobTypeRow; settings: JobTypeSettings } {
  const jobType = tx.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, jobTypeId)).get();
  if (!jobType) throw new DomainError("NOT_FOUND", "Job type not found");
  if (!jobType.isActive) throw new DomainError("INVALID_STATE", `Job type ${jobType.code} is inactive.`);
  return { jobType, settings: parseSettings(jobTypeSettingsSchema, jobType.settings) };
}

interface TaskPlanOptions { readonly minutesPerTask: number; readonly start: Date; readonly priority: Priority; readonly assigneeUserId: string | null }

/** Builds picking (+ sorting/packing/loading) tasks for orders added to a job. */
function buildTasks(tx: Tx, ctx: DomainCtx, job: JobRow, jobType: JobTypeRow, settings: JobTypeSettings, cands: readonly Candidate[], opts: TaskPlanOptions, allocationFilter?: readonly string[]): number {
  const orderIds = cands.map((c) => c.order.id);
  const allocWhere = [inArray(schema.inventoryAllocations.orderId, orderIds), eq(schema.inventoryAllocations.status, "Allocated")];
  if (allocationFilter) allocWhere.push(inArray(schema.inventoryAllocations.id, [...allocationFilter]));
  else allocWhere.push(isNull(schema.inventoryAllocations.taskId));
  const allocs = tx.select({ a: schema.inventoryAllocations, inv: schema.inventory, loc: schema.locations })
    .from(schema.inventoryAllocations)
    .innerJoin(schema.inventory, eq(schema.inventory.id, schema.inventoryAllocations.inventoryId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventory.locationId))
    .where(and(...allocWhere)).all();
  const ordered = sortByClauses(allocs, jobType.orderBy, (r) => bucketFacts(r.inv, r.loc, null));
  let taskNo = nextTaskNo(tx);
  let seq = tx.get<{ n: number | null }>(sql`SELECT MAX(sequence) AS n FROM tasks WHERE job_id = ${job.id}`)?.n ?? 0;
  const startMs = opts.start.getTime();
  const base = (type: TaskInsert["taskType"], extra: Partial<TaskInsert>): TaskInsert => {
    seq += 1;
    const t: TaskInsert = {
      taskNo: taskNo++, jobId: job.id, warehouseId: job.warehouseId, clientId: job.clientId, taskType: type, status: "Pending",
      priority: opts.priority, sequence: seq, assigneeUserId: opts.assigneeUserId,
      plannedStartAt: new Date(startMs).toISOString(), plannedFinishAt: new Date(startMs + seq * opts.minutesPerTask * MINUTE_MS).toISOString(),
      createdBy: ctx.userId, updatedBy: ctx.userId, ...extra,
    };
    return t;
  };
  let count = 0;
  for (const { a, inv } of ordered) {
    const row = tx.insert(schema.tasks).values(base("Picking", {
      orderId: a.orderId, orderLineId: a.orderLineId, allocationId: a.id, productId: inv.productId, packType: inv.packType,
      plannedQty: a.qty, sourceLocationId: inv.locationId, sourceLpId: inv.lpId, lotNumber: inv.lotNumber,
      expiryDate: inv.expiryDate, productionDate: inv.productionDate,
    })).returning({ id: schema.tasks.id }).get();
    tx.update(schema.inventoryAllocations).set({ jobId: job.id, taskId: row.id, updatedBy: ctx.userId }).where(eq(schema.inventoryAllocations.id, a.id)).run();
    count += 1;
  }
  if (allocationFilter) return count;
  for (const c of cands) {
    for (const line of c.lines.filter((l) => l.allocatedQuantity > 0)) {
      const lineExtra = { orderId: c.order.id, orderLineId: line.id, productId: line.productId, packType: line.packType, plannedQty: line.allocatedQuantity };
      if (settings.picking.createSortingTask) { tx.insert(schema.tasks).values(base("Sorting", lineExtra)).run(); count += 1; }
      if (!settings.picking.onlyPick) { tx.insert(schema.tasks).values(base("Packing", lineExtra)).run(); count += 1; }
    }
    if (settings.picking.createLoadingTask) {
      tx.insert(schema.tasks).values(base("Loading", { orderId: c.order.id, plannedQty: orderUnits(c.lines) })).run();
      count += 1;
    }
  }
  return count;
}

function insertJob(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, clientId: string | null, opts: TaskPlanOptions & { waveId?: string | null; waveNo?: string | null; isResolutionJob?: boolean }): JobRow {
  const startMs = opts.start.getTime();
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: next(tx, "job"), warehouseId: jobType.warehouseId, clientId, jobType: jobType.code,
    jobTypeId: jobType.id, operationType: jobType.operationType, status: "Pending", priority: opts.priority,
    assignedToUserId: opts.assigneeUserId, waveId: opts.waveId ?? null, waveNumber: opts.waveNo ?? null,
    plannedStartAt: new Date(startMs).toISOString(), plannedEndAt: new Date(startMs + HOUR_MS).toISOString(),
    isResolutionJob: opts.isResolutionJob ?? false, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  return job;
}

function attachOrders(tx: Tx, ctx: DomainCtx, job: JobRow, cands: readonly Candidate[]): void {
  for (const c of cands) {
    tx.insert(schema.jobOrders).values({ jobId: job.id, orderId: c.order.id }).onConflictDoNothing().run();
    tx.update(schema.shipmentOrders).set({ jobId: job.id, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, c.order.id)).run();
    recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: c.order.id, entityCode: c.order.code, before: { jobId: null }, after: { jobId: job.code } });
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

export function createJobsFromOrders(tx: Tx, ctx: DomainCtx, input: CreateJobsInput): CreateJobsResult {
  const { jobType, settings } = loadJobType(tx, input.jobTypeId);
  if (jobType.operationType !== "Picking") throw new DomainError("VALIDATION", `Job type ${jobType.code} is not a picking job type.`);
  if (input.assigneeUserId) assertUserInWarehouse(tx, input.assigneeUserId, jobType.warehouseId);
  const failed: { id: string; code: string; message: string }[] = [];
  const cands: Candidate[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try { cands.push(eligibility(tx, ctx, jobType, settings, id)); } catch (e) { failed.push({ id, ...describeError(e) }); }
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
    const job = insertJob(tx, ctx, jobType, clients.size === 1 ? batch[0].order.clientId : null, { ...opts, waveId: input.waveId, waveNo: input.waveNo });
    attachOrders(tx, ctx, job, batch);
    buildTasks(tx, ctx, job, jobType, settings, batch, opts);
    rollupJob(tx, ctx, job.id);
    jobIds.push(job.id);
    succeeded.push(...batch.map((c) => c.order.id));
  }
  return { succeeded, failed, jobIds };
}

/** Adds orders to an existing Pending/Started job of the same job type. */
export function mergeIntoJob(tx: Tx, ctx: DomainCtx, input: { jobId: string; orderIds: readonly string[] }): BulkResult {
  const job = getJob(tx, ctx, input.jobId);
  if (job.status !== "Pending" && job.status !== "Started" && job.status !== "In Progress") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
  if (!job.jobTypeId) throw new DomainError("INVALID_STATE", `Job ${job.code} has no job type.`);
  const { jobType, settings } = loadJobType(tx, job.jobTypeId);
  const failed: { id: string; code: string; message: string }[] = [];
  const cands: Candidate[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try { cands.push(eligibility(tx, ctx, jobType, settings, id)); } catch (e) { failed.push({ id, ...describeError(e) }); }
  }
  if (cands.length > 0) {
    attachOrders(tx, ctx, job, cands);
    buildTasks(tx, ctx, job, jobType, settings, cands, { minutesPerTask: 1, start: new Date(job.plannedStartAt ?? Date.now()), priority: job.priority, assigneeUserId: job.assignedToUserId });
    if (job.clientId && cands.some((c) => c.order.clientId !== job.clientId)) tx.update(schema.jobs).set({ clientId: null }).where(eq(schema.jobs.id, job.id)).run();
    rollupJob(tx, ctx, job.id);
  }
  return { succeeded: cands.map((c) => c.order.id), failed };
}

/** Resolution job for a pick-short: picking tasks for the given (re)allocations. */
export function createResolutionJob(tx: Tx, ctx: DomainCtx, input: { sourceJobId: string; orderId: string; allocationIds: readonly string[] }): JobRow | null {
  if (input.allocationIds.length === 0) return null;
  const source = getJob(tx, ctx, input.sourceJobId);
  if (!source.jobTypeId) return null;
  const { jobType, settings } = loadJobType(tx, source.jobTypeId);
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, input.orderId)).get();
  if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
  const opts: TaskPlanOptions = { minutesPerTask: 1, start: new Date(Date.now() + HOUR_MS), priority: "High", assigneeUserId: null };
  const job = insertJob(tx, ctx, jobType, order.clientId, { ...opts, waveNo: source.waveNumber, isResolutionJob: true });
  tx.insert(schema.jobOrders).values({ jobId: job.id, orderId: order.id }).onConflictDoNothing().run();
  buildTasks(tx, ctx, job, jobType, settings, [{ order, lines: [], units: 0 }], opts, input.allocationIds);
  rollupJob(tx, ctx, job.id);
  return job;
}

function pickedTaskCount(tx: Tx, jobId: string): number {
  return tx.select({ n: sql<number>`COUNT(*)` }).from(schema.tasks)
    .where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.status, "Completed"))).get()?.n ?? 0;
}

function detachOrder(tx: Tx, ctx: DomainCtx, job: JobRow, orderId: string, release: boolean): void {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order) return;
  tx.update(schema.tasks).set({ status: "Cancelled", updatedBy: ctx.userId })
    .where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.orderId, orderId), ne(schema.tasks.status, "Cancelled"))).run();
  tx.update(schema.inventoryAllocations).set({ jobId: null, taskId: null, updatedBy: ctx.userId })
    .where(and(eq(schema.inventoryAllocations.orderId, orderId), eq(schema.inventoryAllocations.jobId, job.id))).run();
  tx.delete(schema.jobOrders).where(and(eq(schema.jobOrders.jobId, job.id), eq(schema.jobOrders.orderId, orderId))).run();
  if (order.jobId === job.id) {
    tx.update(schema.shipmentOrders).set({ jobId: null, updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, orderId)).run();
    recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { jobId: job.code }, after: { jobId: null } });
  }
  if (release) deallocateOrder(tx, ctx, { ...order, jobId: null });
}

/** Cancels a job that has no completed tasks; its orders' allocations are released (orders back to Open). */
export function cancelJob(tx: Tx, ctx: DomainCtx, input: { jobId: string }): JobRow {
  const job = getJob(tx, ctx, input.jobId);
  const status = stateMachines.job.transition(job.status, "Cancelled");
  if (pickedTaskCount(tx, job.id) > 0) throw new DomainError("INVALID_STATE", `Job ${job.code} has completed tasks and can't be cancelled.`);
  const orders = tx.select({ orderId: schema.jobOrders.orderId }).from(schema.jobOrders).where(eq(schema.jobOrders.jobId, job.id)).all();
  for (const o of orders) detachOrder(tx, ctx, job, o.orderId, true);
  const updated = tx.update(schema.jobs).set({ status, updatedBy: ctx.userId }).where(eq(schema.jobs.id, job.id)).returning().get();
  recordUpdate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code, before: { status: job.status }, after: { status } });
  return updated;
}

/** Removes an order whose tasks are all pending; it keeps its allocation (Ready to Pick). */
export function removeOrderFromJob(tx: Tx, ctx: DomainCtx, input: { jobId: string; orderId: string }): void {
  const job = getJob(tx, ctx, input.jobId);
  if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
  const tasks = tx.select().from(schema.tasks)
    .where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.orderId, input.orderId), ne(schema.tasks.status, "Cancelled"))).all();
  if (tasks.length === 0) throw new DomainError("NOT_FOUND", "The order is not in this job");
  if (tasks.some((t) => t.status === "Completed" || t.status === "Started")) throw new DomainError("INVALID_STATE", "Work has started for this order; it can't be removed from the job.");
  detachOrder(tx, ctx, job, input.orderId, false);
  rollupJob(tx, ctx, job.id);
}

export function assertUserInWarehouse(tx: Tx, userId: string, warehouseId: string): void {
  const user = tx.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || !user.isActive) throw new DomainError("NOT_FOUND", "User not found");
  if (user.role === "admin") return;
  const links = tx.select({ wh: schema.userWarehouses.warehouseId }).from(schema.userWarehouses).where(eq(schema.userWarehouses.userId, userId)).all();
  if (links.length > 0 && !links.some((l) => l.wh === warehouseId)) {
    throw new DomainError("VALIDATION", `${user.name} is not assigned to this job's warehouse.`);
  }
}

export function assign(tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[]; userId: string | null }): BulkResult {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.jobIds)]) {
    try {
      const job = getJob(tx, ctx, id);
      if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
      if (input.userId) assertUserInWarehouse(tx, input.userId, job.warehouseId);
      tx.update(schema.jobs).set({ assignedToUserId: input.userId, updatedBy: ctx.userId }).where(eq(schema.jobs.id, id)).run();
      tx.update(schema.tasks).set({ assigneeUserId: input.userId }).where(and(eq(schema.tasks.jobId, id), eq(schema.tasks.status, "Pending"))).run();
      recordUpdate(tx, ctx, { entityType: "job", entityId: id, entityCode: job.code, before: { assignee: userDisplayName(tx, job.assignedToUserId) }, after: { assignee: userDisplayName(tx, input.userId) } });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed };
}

/** Display name of a user for change-log rows (never a raw id). */
export function userDisplayName(tx: Tx, userId: string | null): string | null {
  if (!userId) return null;
  const u = tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return u ? (u.name || u.email) : "Unknown user";
}

export const unassign = (tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[] }): BulkResult => assign(tx, ctx, { jobIds: input.jobIds, userId: null });

export function updatePriority(tx: Tx, ctx: DomainCtx, input: { jobIds: readonly string[]; priority: Priority }): BulkResult {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.jobIds)]) {
    try {
      const job = getJob(tx, ctx, id);
      if (job.status === "Completed" || job.status === "Cancelled") throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}.`);
      tx.update(schema.jobs).set({ priority: input.priority, updatedBy: ctx.userId }).where(eq(schema.jobs.id, id)).run();
      tx.update(schema.tasks).set({ priority: input.priority }).where(and(eq(schema.tasks.jobId, id), ne(schema.tasks.status, "Completed"))).run();
      recordUpdate(tx, ctx, { entityType: "job", entityId: id, entityCode: job.code, before: { priority: job.priority }, after: { priority: input.priority } });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed };
}

export function getJobProgress(tx: Tx, ctx: DomainCtx, jobId: string): JobProgress {
  getJob(tx, ctx, jobId);
  return jobProgress(tx, jobId);
}

/** Releases one allocation's unpicked remainder (used by pick-short and task cancel). */
export function releaseForLine(tx: Tx, ctx: DomainCtx, alloc: AllocationRow, qty: number): void {
  if (qty <= 0) return;
  releaseAllocation(tx, ctx, { allocationId: alloc.id, qty });
  if (alloc.orderLineId) {
    tx.update(schema.orderLines).set({ allocatedQuantity: sql`MAX(${schema.orderLines.allocatedQuantity} - ${qty}, 0)`, updatedBy: ctx.userId })
      .where(eq(schema.orderLines.id, alloc.orderLineId)).run();
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
export function createCountJob(tx: Tx, ctx: DomainCtx, input: CreateCountJobInput): JobRow {
  const { jobType } = loadJobType(tx, input.jobTypeId);
  if (jobType.operationType !== "Count") throw new DomainError("VALIDATION", `Job type ${jobType.code} is not a count job type.`);
  if (input.tasks.length === 0) throw new DomainError("VALIDATION", "A count job needs at least one task.");
  if (input.assigneeUserId) assertUserInWarehouse(tx, input.assigneeUserId, jobType.warehouseId);
  const now = Date.now();
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: next(tx, "job"), warehouseId: jobType.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType: "Count", status: "Pending", assignedToUserId: input.assigneeUserId, countPlanId: input.countPlanId,
    waveRuleId: input.waveRuleId ?? null,
    plannedStartAt: new Date(now).toISOString(), plannedEndAt: new Date(now + HOUR_MS).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = nextTaskNo(tx);
  input.tasks.forEach((t, i) => {
    tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: job.warehouseId, taskType: "Count", status: "Pending", sequence: i + 1,
      countPlanId: input.countPlanId, countLineId: t.countLineId, productId: t.productId, sourceLocationId: t.locationId, sourceLpId: t.lpId,
      plannedQty: t.plannedQty, assigneeUserId: input.assigneeUserId, plannedStartAt: job.plannedStartAt, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).run();
  });
  rollupJob(tx, ctx, job.id);
  return job;
}
