/**
 * Work-order commands (M08; replaces the 0.6 stub). `allocateWorkOrder(tx, ctx, woId)` is
 * the contract consumed by `/api/ops/jobs` (`mode: "work-order"`).
 *
 *   allocate      reserve components FEFO → Work Order Picking job (picking + kitting tasks)
 *                 or Shortage + "Manual Allocation - Work Order" allocation exceptions
 *   createKit     consume components (ledger Kitting) → Kitting receipt for the kit
 *   disassembleKit consume kits (ledger Disassemble Kit) → DisassembleKit receipts per component
 *   cancelPicking release unpicked allocations, cancel the tasks and the job → Open
 *
 * Stock only changes through `ledger.*`; statuses only through `stateMachines.*`.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import type { Priority, WorkOrderStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, sequences, stateMachines } from "@/server/domain";
import { conflictError } from "@/server/api/errors";
import { DomainError } from "@/server/domain/errors";
import { assertUserInWarehouse, cancelJob } from "@/server/domain/jobs";
import { notCountLocked } from "@/server/domain/ledger/count-locks";
import { rollupJob } from "@/server/domain/progress";
import { cancel as cancelTasks, execute as executeTasks } from "@/server/domain/tasks";
import { checkScope, nowIso, type DomainCtx, type Tx } from "@/server/domain/types";
import { NO_PICK_TASKS_REASON, pickBlockReason, pickProgress } from "@/lib/grid-defs/work-orders/kit-steps";
import { remainingQty, type CreateKitInput, type DisassembleInput, type DisassembleStockInput } from "@/lib/grid-defs/work-orders/work-order-model";
import { recordWorkOrderException, transitionWorkOrder } from "./work-orders-adapters";
import { classifyFree, freeStockRows } from "./work-orders-availability";
import { defaultKittingLocation, patchWorkOrder, recordWorkOrderChanges, WO_ENTITY, type WorkOrderRecord } from "./work-orders";
import { dbGet, mapSeq } from "@/server/db/sql";

export interface AllocateWorkOrderResult {
  readonly workOrderId: string;
  readonly status: "In Process" | "Shortage";
  readonly allocatedQty: number;
  readonly shortageQty: number;
}

export type AllocateWorkOrder = (tx: Tx, ctx: DomainCtx, workOrderId: string) => Promise<AllocateWorkOrderResult>;

export interface AllocateOptions {
  readonly jobTypeId?: string | null;
  readonly assigneeUserId?: string | null;
  readonly priority?: Priority;
}

type ComponentRecord = typeof schema.workOrderComponents.$inferSelect;
type Bucket = typeof schema.inventory.$inferSelect;

export const WORK_ORDER_EXCEPTION_WAVE = "Manual Allocation - Work Order";

export async function getWorkOrderForUpdate(tx: Tx, ctx: DomainCtx, workOrderId: string): Promise<WorkOrderRecord> {
  const wo = (await tx.select().from(schema.workOrders).where(eq(schema.workOrders.id, workOrderId)).limit(1))[0];
  if (!wo) throw new DomainError("NOT_FOUND", "Work order not found");
  checkScope(ctx, wo, "Work order");
  return wo;
}

async function componentsOf(tx: Tx, workOrderId: string): Promise<ComponentRecord[]> {
  return await tx.select().from(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, workOrderId));
}

const skuOf = async (tx: Tx, productId: string): Promise<string> =>
  (await tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).limit(1))[0]?.sku ?? productId;

/** Free, allocatable component buckets (FEFO), restricted to the component's chosen source. */
export async function candidateBuckets(tx: Tx, wo: WorkOrderRecord, c: ComponentRecord): Promise<Bucket[]> {
  const i = schema.inventory;
  const rows = await tx.select({ i, locked: schema.locations.isLocked, prevent: schema.locations.preventAllocation })
    .from(i).innerJoin(schema.locations, eq(schema.locations.id, i.locationId))
    .where(and(
      eq(i.warehouseId, wo.warehouseId), eq(i.clientId, wo.clientId), eq(i.productId, c.componentProductId), eq(i.status, "Stock"),
      sql`${i.damageReason} IS NULL`, sql`${i.onHand} - ${i.allocated} > 0`,
      // FEFO skips count-locked locations; a chosen source that is locked fails in the ledger with the plan code.
      c.locationId ? eq(i.locationId, c.locationId) : notCountLocked(i.locationId),
      c.lpId ? eq(i.lpId, c.lpId) : undefined,
      c.lotNumber ? eq(i.lotNumber, c.lotNumber) : undefined,
      c.expiryDate ? eq(i.expiryDate, c.expiryDate) : undefined,
    ))
    .orderBy(asc(i.expiryDate), asc(i.receivedAt), asc(schema.locations.walkingPathPriority));
  // A chosen source location is honoured even when it is flagged "prevent allocation".
  return rows.filter((r) => !r.locked && (c.locationId ? true : !r.prevent)).map((r) => r.i);
}

const freeOf = (b: Bucket): number => b.onHand - b.allocated;

interface Slice { readonly bucket: Bucket; readonly qty: number }

async function planComponent(tx: Tx, wo: WorkOrderRecord, c: ComponentRecord, need: number): Promise<{ slices: Slice[]; free: number }> {
  const buckets = await candidateBuckets(tx, wo, c);
  const free = buckets.reduce((s, b) => s + freeOf(b), 0);
  const slices: Slice[] = [];
  let left = need;
  for (const b of buckets) {
    if (left <= 0) break;
    const take = Math.min(left, freeOf(b));
    slices.push({ bucket: b, qty: take });
    left -= take;
  }
  return { slices, free };
}

/** Units of a component still needed for the kits that are not built yet. */
export function componentNeed(wo: WorkOrderRecord, c: ComponentRecord): number {
  return Math.max(0, remainingQty(wo) * c.componentQty - c.allocatedQty);
}

async function workOrderJobType(tx: Tx, warehouseId: string, jobTypeId?: string | null): Promise<typeof schema.jobTypes.$inferSelect> {
  const jt = schema.jobTypes;
  const row = jobTypeId
    ? (await tx.select().from(jt).where(eq(jt.id, jobTypeId)).limit(1))[0]
    : (await tx.select().from(jt).where(and(eq(jt.warehouseId, warehouseId), eq(jt.operationType, "Work Order"), eq(jt.isActive, true))).orderBy(asc(jt.code)).limit(1))[0];
  if (!row) throw new DomainError("VALIDATION", "No active Work Order job type is configured for this warehouse.");
  if (row.warehouseId !== warehouseId) throw new DomainError("VALIDATION", `Job type ${row.code} belongs to another warehouse.`);
  if (row.operationType !== "Work Order") throw new DomainError("VALIDATION", `Job type ${row.code} is not a Work Order job type.`);
  if (!row.isActive) throw new DomainError("INVALID_STATE", `Job type ${row.code} is inactive.`);
  return row;
}

const nextTaskNo = async (tx: Tx): Promise<number> => ((await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(task_no) AS n FROM tasks`))?.n ?? 0) + 1;

async function setStatus(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, to: WorkOrderStatus, extra: Partial<typeof schema.workOrders.$inferInsert> = {}): Promise<WorkOrderRecord> {
  if (wo.status === to) return Object.keys(extra).length ? await patchWorkOrder(tx, ctx, wo, extra) : wo;
  return await patchWorkOrder(tx, ctx, wo, { status: transitionWorkOrder(wo.status, to), ...extra });
}

/** Allocates the components of a "with picking" work order and creates its picking job. */
export async function allocateWorkOrderWith(tx: Tx, ctx: DomainCtx, workOrderId: string, opts: AllocateOptions = {}): Promise<AllocateWorkOrderResult> {
  const wo = await getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.type !== "Work Order with Picking") throw new DomainError("INVALID_STATE", `${wo.code} is a work order without picking; build it with Create Kit.`);
  if (wo.status !== "Open" && wo.status !== "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}; only Open or Shortage work orders can be allocated.`);
  const components = await componentsOf(tx, wo.id);
  if (components.length === 0) throw new DomainError("VALIDATION", `${wo.code} has no components.`);
  const plans = await mapSeq(components, async (c) => {
    const need = componentNeed(wo, c);
    const plan = await planComponent(tx, wo, c, need);
    return { c, need, ...plan, short: Math.max(0, need - plan.slices.reduce((s, x) => s + x.qty, 0)) };
  });
  const shortageQty = plans.reduce((s, p) => s + p.short, 0);
  if (shortageQty > 0) {
    for (const p of plans.filter((x) => x.short > 0)) {
      await recordWorkOrderException(tx, ctx, { workOrder: wo, productId: p.c.componentProductId, inventoryQty: p.free, requiredQty: p.need });
    }
    if (wo.status !== "Shortage") await setStatus(tx, ctx, wo, "Shortage");
    return { workOrderId: wo.id, status: "Shortage", allocatedQty: 0, shortageQty };
  }
  const jobType = await workOrderJobType(tx, wo.warehouseId, opts.jobTypeId);
  if (opts.assigneeUserId) await assertUserInWarehouse(tx, opts.assigneeUserId, wo.warehouseId);
  const target = wo.outputLocationId ?? await defaultKittingLocation(tx, wo.warehouseId);
  const start = new Date(Date.now() + 15 * 60_000);
  const job = (await tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: await sequences.next(tx, "job"), warehouseId: wo.warehouseId, clientId: wo.clientId, jobType: jobType.code,
    jobTypeId: jobType.id, operationType: "Work Order", workOrderId: wo.id, status: "Pending", priority: opts.priority ?? "None",
    assignedToUserId: opts.assigneeUserId ?? null, plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 3_600_000).toISOString(),
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  await changeLog.recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = await nextTaskNo(tx);
  let sequence = 0;
  const base = { jobId: job.id, warehouseId: wo.warehouseId, clientId: wo.clientId, workOrderId: wo.id, priority: job.priority, assigneeUserId: job.assignedToUserId, createdBy: ctx.userId, updatedBy: ctx.userId };
  let allocatedQty = 0;
  for (const p of plans) {
    let componentAllocated = 0;
    for (const s of p.slices) {
      const { allocation } = await ledger.allocate(tx, ctx, {
        inventoryId: s.bucket.id, qty: s.qty, workOrderId: wo.id, workOrderComponentId: p.c.id, jobId: job.id, ruleName: "Work order components",
        refs: { note: `Component of ${wo.code}` },
      });
      sequence += 1;
      const task = (await tx.insert(schema.tasks).values({
        ...base, taskNo: taskNo++, taskType: "Picking", sequence, allocationId: allocation.id, productId: s.bucket.productId, packType: s.bucket.packType,
        plannedQty: s.qty, sourceLocationId: s.bucket.locationId, sourceLpId: s.bucket.lpId, targetLocationId: target,
        lotNumber: s.bucket.lotNumber, expiryDate: s.bucket.expiryDate, productionDate: s.bucket.productionDate,
      }).returning({ id: schema.tasks.id }))[0];
      await tx.update(schema.inventoryAllocations).set({ taskId: task.id, updatedBy: ctx.userId }).where(eq(schema.inventoryAllocations.id, allocation.id));
      componentAllocated += s.qty;
    }
    if (componentAllocated > 0) {
      await tx.update(schema.workOrderComponents).set({ allocatedQty: p.c.allocatedQty + componentAllocated }).where(eq(schema.workOrderComponents.id, p.c.id));
      await changeLog.recordLine(tx, ctx, { entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, lineEntityType: "work_order_component", lineEntityId: p.c.id, lineLabel: await skuOf(tx, p.c.componentProductId), field: "allocatedQty", from: p.c.allocatedQty, to: p.c.allocatedQty + componentAllocated });
    }
    allocatedQty += componentAllocated;
  }
  const kit = (await tx.select().from(schema.products).where(eq(schema.products.id, wo.kitProductId)).limit(1))[0];
  sequence += 1;
  await tx.insert(schema.tasks).values({ ...base, taskNo: taskNo++, taskType: "Kitting", sequence, productId: wo.kitProductId, packType: kit?.uom ?? "Each", plannedQty: remainingQty(wo), targetLocationId: target });
  await rollupJob(tx, ctx, job.id);
  await setStatus(tx, ctx, wo, "In Process", { jobId: job.id, actualStartAt: wo.actualStartAt ?? nowIso(), outputLocationId: target });
  return { workOrderId: wo.id, status: "In Process", allocatedQty, shortageQty: 0 };
}

export const allocateWorkOrder: AllocateWorkOrder = async (tx, ctx, workOrderId) => await allocateWorkOrderWith(tx, ctx, workOrderId);

/* --------------------------------------------------------- create kit */

export interface CreateKitResult {
  readonly workOrderId: string;
  readonly status: WorkOrderStatus;
  readonly processedQty: number;
  readonly receiptId: string;
  /** True when an earlier call with the same idempotency key already built these kits. */
  readonly replayed?: boolean;
}

async function activeAllocations(tx: Tx, componentId: string) {
  const a = schema.inventoryAllocations;
  return await tx.select().from(a).where(and(eq(a.workOrderComponentId, componentId), inArray(a.status, ["Picked", "Allocated"])))
    .orderBy(sql`CASE ${a.status} WHEN 'Picked' THEN 0 ELSE 1 END`, asc(a.createdAt));
}

async function pickTasksOf(tx: Tx, workOrderId: string) {
  return await tx.select({ id: schema.tasks.id, taskNo: schema.tasks.taskNo, taskType: schema.tasks.taskType, status: schema.tasks.status })
    .from(schema.tasks).where(and(eq(schema.tasks.workOrderId, workOrderId), eq(schema.tasks.taskType, "Picking")));
}

/**
 * Logiwa sequence for a "Work Order with Picking": pick the components to the kitting area,
 * then kit. Open picking tasks block Create Kit unless the caller explicitly confirmed
 * "Complete pending picks and build" (permission-gated in the route). The forced picks are
 * real ledger moves (Picking, with job/task refs) and are named in the work order's change log.
 */
async function settlePicking(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, targetLocationId: string, force: boolean): Promise<void> {
  const tasks = await pickTasksOf(tx, wo.id);
  const progress = pickProgress(tasks);
  if (progress.total === 0) {
    // Allocated but no picking tasks: nothing has reached the kitting area, so there is nothing to kit from.
    const a = schema.inventoryAllocations;
    const open = (await tx.select({ id: a.id }).from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated"))).limit(1))[0];
    if (open) throw new DomainError("INVALID_STATE", `${NO_PICK_TASKS_REASON} on ${wo.code}. Run Picking/Job Operations so the components are picked to the kitting area first.`, { field: "completePendingPicks" });
  }
  const reason = pickBlockReason(progress);
  if (!reason) return;
  if (!force) {
    throw new DomainError("INVALID_STATE", `${reason}. Complete the picking tasks first (${progress.pendingTaskNos.map((n) => `Task #${n}`).join(", ")}).`, {
      field: "completePendingPicks", picked: progress.done, total: progress.total, pendingTaskNos: progress.pendingTaskNos,
    });
  }
  const pending = tasks.filter((t) => t.status === "Pending" || t.status === "Started");
  await executeTasks(tx, ctx, { taskIds: pending.map((t) => t.id), targetLocationId });
  const names = pending.map((t) => `Task #${t.taskNo}`).join(", ");
  await tx.insert(schema.changeLog).values({
    entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, type: "Update", field: "pickingTasks", fieldLabel: "Picking tasks",
    fromValue: `${progress.done}/${progress.total} picked`, toValue: `${progress.total}/${progress.total} picked`,
    message: `Pending picks completed on Create Kit (confirmed): ${names}`, userId: ctx.userId, source: ctx.source,
  });
}

async function consumeComponent(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, c: ComponentRecord, qty: number): Promise<void> {
  const refs = { workOrderId: wo.id, note: `Consumed by ${wo.code}` };
  let left = qty;
  let fromAllocations = 0;
  if (wo.type === "Work Order with Picking") {
    for (const alloc of await activeAllocations(tx, c.id)) {
      if (left <= 0) break;
      const take = Math.min(left, alloc.qty);
      await ledger.consume(tx, ctx, { inventoryId: alloc.inventoryId, qty: take, allocationId: alloc.id, type: "Kitting", refs: { ...refs, jobId: alloc.jobId } });
      left -= take;
      fromAllocations += take;
    }
  }
  if (left > 0) {
    for (const b of await candidateBuckets(tx, wo, c)) {
      if (left <= 0) break;
      const take = Math.min(left, freeOf(b));
      await ledger.consume(tx, ctx, { inventoryId: b.id, qty: take, type: "Kitting", refs });
      left -= take;
    }
  }
  if (left > 0) {
    const where = c.locationId ? " at the chosen source" : "";
    throw new DomainError("INSUFFICIENT_STOCK", `Not enough ${await skuOf(tx, c.componentProductId)} free${where}: ${qty - left} of ${qty} unit${qty === 1 ? "" : "s"} available.`, { productId: c.componentProductId });
  }
  await tx.update(schema.workOrderComponents).set({
    consumedQty: c.consumedQty + qty,
    allocatedQty: Math.max(0, c.allocatedQty - fromAllocations),
    pickedQty: wo.type === "Work Order with Picking" ? c.pickedQty + fromAllocations : c.pickedQty,
  }).where(eq(schema.workOrderComponents.id, c.id));
  await changeLog.recordLine(tx, ctx, { entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, lineEntityType: "work_order_component", lineEntityId: c.id, lineLabel: await skuOf(tx, c.componentProductId), field: "consumedQty", from: c.consumedQty, to: c.consumedQty + qty });
}

async function advanceKittingTask(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, qty: number, locationId: string, done: boolean): Promise<void> {
  const task = (await tx.select().from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.taskType, "Kitting"), inArray(schema.tasks.status, ["Pending", "Started"]))).limit(1))[0];
  if (!task) return;
  const now = nowIso();
  const status = done ? stateMachines.task.transition(task.status, "Completed") : task.status === "Pending" ? stateMachines.task.transition(task.status, "Started") : task.status;
  await tx.update(schema.tasks).set({
    status, actualQty: task.actualQty + qty, targetLocationId: locationId, executedByUserId: ctx.userId, startedAt: task.startedAt ?? now,
    finishedAt: done ? now : null, updatedBy: ctx.userId,
  }).where(eq(schema.tasks.id, task.id));
  await rollupJob(tx, ctx, task.jobId);
}

export async function createKit(tx: Tx, ctx: DomainCtx, input: CreateKitInput): Promise<CreateKitResult> {
  let wo = await getWorkOrderForUpdate(tx, ctx, input.workOrderId);
  if (input.idempotencyKey) {
    const prior = await findKitReceiptByKey(tx, wo.id, input.idempotencyKey);
    if (prior) return { workOrderId: wo.id, status: wo.status, processedQty: wo.processedQty, receiptId: prior, replayed: true };
  }
  if (input.version !== undefined && input.version !== wo.version) throw conflictError();
  if (wo.status === "Completed" || wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}.`);
  if (wo.status === "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is short of components; allocate them first.`);
  if (wo.type === "Work Order with Picking" && wo.status === "Open") throw new DomainError("INVALID_STATE", `${wo.code} needs Picking/Job Operations before kits can be built.`);
  const remaining = remainingQty(wo);
  if (input.qty > remaining) throw new DomainError("VALIDATION", `At most ${remaining} kits are left to build on ${wo.code}.`, { field: "qty" });
  const location = (await tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId)).limit(1))[0];
  if (!location || location.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose an output location in the work order's warehouse.", { field: "locationId" });
  if (input.lpId) {
    const lp = (await tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, input.lpId)).limit(1))[0];
    if (!lp || lp.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose an LP in the work order's warehouse.", { field: "lpId" });
  }
  const kit = (await tx.select().from(schema.products).where(eq(schema.products.id, wo.kitProductId)).limit(1))[0];
  if (!kit) throw new DomainError("NOT_FOUND", "Kit product not found");
  if (kit.trackLot && !input.lotNumber) throw new DomainError("VALIDATION", `${kit.sku} is lot tracked; enter a lot number.`, { field: "lotNumber" });
  if (kit.trackExpiry && !input.expiryDate) throw new DomainError("VALIDATION", `${kit.sku} is expiry tracked; enter an expiry date.`, { field: "expiryDate" });
  if (kit.trackProductionDate && !input.productionDate) throw new DomainError("VALIDATION", `${kit.sku} tracks production dates; enter one.`, { field: "productionDate" });
  if (input.sourceScan) await assertSourceScan(tx, wo, input.sourceScan);
  if (wo.type === "Work Order with Picking") await settlePicking(tx, ctx, wo, wo.outputLocationId ?? input.locationId, input.completePendingPicks === true);
  for (const c of await componentsOf(tx, wo.id)) await consumeComponent(tx, ctx, wo, c, c.componentQty * input.qty);
  const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
    type: "Kitting", warehouseId: wo.warehouseId, clientId: wo.clientId, productId: kit.id, packType: kit.uom, quantity: input.qty,
    locationId: input.locationId, lpId: input.lpId, lotNumber: input.lotNumber, expiryDate: input.expiryDate, productionDate: input.productionDate,
    workOrderId: wo.id, shipmentOrderId: wo.shipmentOrderId, note: `Built by ${wo.code}`,
    lineNote: input.idempotencyKey ? kitIdempotencyNote(input.idempotencyKey) : null,
  });
  await retypeReceiptTxn(tx, txn.id, "Kitting");
  const processedQty = wo.processedQty + input.qty;
  const done = processedQty >= wo.requestedQty;
  const stamps = { processedQty, actualStartAt: wo.actualStartAt ?? input.actualStartAt ?? nowIso(), outputLocationId: input.locationId, outputLot: input.lotNumber ?? wo.outputLot, outputExpiry: input.expiryDate ?? wo.outputExpiry };
  // Logiwa parity: a partial build on a without-picking WO keeps it Open (Processed n of m);
  // only the final build moves it (through In Process) to Completed.
  if (wo.status === "Open" && done) wo = await setStatus(tx, ctx, wo, "In Process");
  wo = done ? await setStatus(tx, ctx, wo, "Completed", { ...stamps, actualFinishAt: input.actualFinishAt ?? nowIso() }) : wo.processedQty === processedQty ? wo : await patchWorkOrder(tx, ctx, wo, stamps);
  await advanceKittingTask(tx, ctx, wo, input.qty, input.locationId, done);
  if (done) await releaseLeftovers(tx, ctx, wo);
  return { workOrderId: wo.id, status: wo.status, processedQty: wo.processedQty, receiptId: receipt.id };
}

/**
 * Ledger type of a kitting receipt's stock row. Logiwa posts both sides of a build under
 * "Kitting" (and both sides of a breakdown under "Disassemble Kit"), so Transaction History
 * filtered by Kitting shows the kit output next to the consumed components. The foundation
 * `recordReceipt` always posts "Receiving" for non-return receipts; until it accepts a ledger
 * type (docs/requests/work-orders-kitting.md R2-33) the row is retyped inside the same
 * transaction. Quantities, buckets and links are untouched.
 */
export const KIT_RECEIPT_TXN_TYPE = { Kitting: "Kitting", DisassembleKit: "Disassemble Kit" } as const;

async function retypeReceiptTxn(tx: Tx, txnId: string, type: (typeof KIT_RECEIPT_TXN_TYPE)[keyof typeof KIT_RECEIPT_TXN_TYPE]): Promise<void> {
  await tx.update(schema.inventoryTransactions).set({ type }).where(and(eq(schema.inventoryTransactions.id, txnId), eq(schema.inventoryTransactions.type, "Receiving")));
}

/** Marker stored on the Kitting receipt's line note so a retried Create Kit is replayed, not rebuilt. */
export function kitIdempotencyNote(key: string): string {
  return `idem:${key}`;
}

async function findKitReceiptByKey(tx: Tx, workOrderId: string, key: string): Promise<string | null> {
  const r = schema.receipts;
  const row = (await tx.select({ id: r.id }).from(r)
    .where(and(eq(r.workOrderId, workOrderId), eq(r.type, "Kitting"), eq(r.lineNote, kitIdempotencyNote(key)))).limit(1))[0];
  return row?.id ?? null;
}

/**
 * Create Kit step 1 (Logiwa Confirmation): the scanned Source Location / LP must be one of the
 * components' chosen locations or LPs, or the kitting area for a with-picking work order. When
 * every source is FEFO (none chosen), any confirmation is accepted.
 */
async function assertSourceScan(tx: Tx, wo: WorkOrderRecord, scan: string): Promise<void> {
  const codes = new Set<string>();
  const norm = (v: string) => v.trim().toUpperCase();
  if (wo.type === "Work Order with Picking") {
    const loc = wo.outputLocationId ? (await tx.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, wo.outputLocationId)).limit(1))[0] : undefined;
    if (loc) codes.add(norm(loc.code));
  } else {
    const c = schema.workOrderComponents;
    const rows = await tx.select({ loc: schema.locations.code, lp: schema.licensePlates.number }).from(c)
      .leftJoin(schema.locations, eq(schema.locations.id, c.locationId))
      .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, c.lpId))
      .where(eq(c.workOrderId, wo.id));
    for (const r of rows) { if (r.loc) codes.add(norm(r.loc)); if (r.lp) codes.add(norm(r.lp)); }
    // All-FEFO (no chosen source): the scan must still name a real source (Logiwa requires the
    // Source Location / LP on step 1), i.e. a bin or LP holding usable free stock of a component.
    if (codes.size === 0) {
      for (const code of await fefoSourceCodes(tx, wo)) codes.add(norm(code));
      if (codes.size === 0) return; // nothing usable anywhere: the stock guard reports it with quantities
    }
  }
  // One scan per source location: the drawer sends them comma-separated, and each must be a source.
  const scans = scan.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = codes.size > 0 ? scans.find((s) => !codes.has(norm(s))) : undefined;
  if (bad !== undefined) {
    const list = [...codes];
    const expected = list.length > 4 ? `${list.slice(0, 4).join(", ")} or ${list.length - 4} more` : list.join(" or ");
    throw new DomainError("VALIDATION", `${bad} is not a source of ${wo.code} (expected ${expected}).`, { field: "sourceScan" });
  }
}

/** Location codes and LP numbers holding usable (lock-aware) free stock of the work order's components. */
export async function fefoSourceCodes(tx: Tx, wo: Pick<WorkOrderRecord, "id" | "warehouseId" | "clientId">): Promise<string[]> {
  const productIds = (await componentsOf(tx, wo.id)).map((c) => c.componentProductId);
  const usable = (await freeStockRows(tx, { warehouseId: wo.warehouseId, clientId: wo.clientId, productIds })).filter((r) => classifyFree(r) === "usable");
  const locationIds = [...new Set(usable.map((r) => r.locationId))];
  if (locationIds.length === 0) return [];
  const i = schema.inventory;
  const rows = await tx.select({ loc: schema.locations.code, lp: schema.licensePlates.number }).from(i)
    .innerJoin(schema.locations, eq(schema.locations.id, i.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, i.lpId))
    .where(and(eq(i.warehouseId, wo.warehouseId), eq(i.clientId, wo.clientId), inArray(i.productId, productIds), inArray(i.locationId, locationIds),
      eq(i.status, "Stock"), sql`${i.damageReason} IS NULL`, sql`${i.onHand} - ${i.allocated} > 0`));
  return [...new Set(rows.flatMap((r) => [r.loc, r.lp].filter((x): x is string => Boolean(x))))].sort();
}

/** After the last kit, any unconsumed unpicked allocation goes back to free stock. */
async function releaseLeftovers(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord): Promise<void> {
  const a = schema.inventoryAllocations;
  for (const alloc of await tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated")))) {
    await ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `Released after ${wo.code} completed` } });
  }
  await tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id));
}

/* ------------------------------------------------------- disassemble */

async function assertTargetLp(tx: Tx, lpId: string | null, warehouseId: string): Promise<void> {
  if (!lpId) return;
  const lp = (await tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lpId)).limit(1))[0];
  if (!lp || lp.warehouseId !== warehouseId) throw new DomainError("VALIDATION", "Choose a component LP in the same warehouse.", { field: "targetLpId" });
}

type ComponentAttrs = readonly { readonly productId: string; readonly lotNumber: string | null; readonly expiryDate: string | null; readonly productionDate: string | null }[] | undefined;

/** Attributes for a returned component; tracked attributes are required (Logiwa Add Attribute). */
function attrsFor(product: { readonly id: string; readonly sku: string; readonly trackLot: boolean; readonly trackExpiry: boolean; readonly trackProductionDate: boolean } | undefined, attrs: ComponentAttrs) {
  const a = product ? attrs?.find((x) => x.productId === product.id) : undefined;
  if (product?.trackLot && !a?.lotNumber) throw new DomainError("VALIDATION", `${product.sku} is lot tracked; add its lot number.`, { field: "componentAttributes" });
  if (product?.trackExpiry && !a?.expiryDate) throw new DomainError("VALIDATION", `${product.sku} is expiry tracked; add its expiry date.`, { field: "componentAttributes" });
  if (product?.trackProductionDate && !a?.productionDate) throw new DomainError("VALIDATION", `${product.sku} tracks production dates; add one.`, { field: "componentAttributes" });
  return { lotNumber: a?.lotNumber ?? null, expiryDate: a?.expiryDate ?? null, productionDate: a?.productionDate ?? null };
}

export async function disassembledQty(tx: Tx, workOrderId: string, kitProductId: string): Promise<number> {
  const it = schema.inventoryTransactions;
  return Number((await tx.select({ n: sql<number>`COALESCE(SUM(ABS(${it.uomQty})), 0)` }).from(it)
    .where(and(eq(it.workOrderId, workOrderId), eq(it.productId, kitProductId), eq(it.type, "Disassemble Kit"))).limit(1))[0]?.n ?? 0);
}

export interface DisassembleResult {
  readonly workOrderId: string;
  readonly disassembledQty: number;
  readonly receiptIds: readonly string[];
}

export async function disassembleKit(tx: Tx, ctx: DomainCtx, input: DisassembleInput): Promise<DisassembleResult> {
  const wo = await getWorkOrderForUpdate(tx, ctx, input.workOrderId);
  if (input.version !== undefined && input.version !== wo.version) throw conflictError();
  if (wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is Cancelled.`);
  const done = await disassembledQty(tx, wo.id, wo.kitProductId);
  const left = wo.processedQty - done;
  if (left <= 0) throw new DomainError("INVALID_STATE", `Every kit built by ${wo.code} was already disassembled.`);
  if (input.qty > left) throw new DomainError("VALIDATION", `At most ${left} kits of ${wo.code} can be disassembled.`, { field: "qty" });
  const bucket = (await tx.select().from(schema.inventory).where(eq(schema.inventory.id, input.sourceInventoryId)).limit(1))[0];
  if (!bucket || bucket.productId !== wo.kitProductId || bucket.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose kit stock of this work order's kit and warehouse.", { field: "sourceInventoryId" });
  if (bucket.status !== "Stock" || bucket.damageReason) throw new DomainError("RULE_VIOLATION", "Only undamaged kit stock can be disassembled.");
  if (freeOf(bucket) < input.qty) throw new DomainError("INSUFFICIENT_STOCK", `Only ${freeOf(bucket)} unallocated kits are in that bucket.`);
  const target = (await tx.select().from(schema.locations).where(eq(schema.locations.id, input.targetLocationId)).limit(1))[0];
  if (!target || target.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose a component location in the work order's warehouse.", { field: "targetLocationId" });
  await assertTargetLp(tx, input.targetLpId, wo.warehouseId);
  await ledger.consume(tx, ctx, { inventoryId: bucket.id, qty: input.qty, type: "Disassemble Kit", refs: { workOrderId: wo.id, note: `Disassembled by ${wo.code}` } });
  const receiptIds: string[] = [];
  for (const c of await componentsOf(tx, wo.id)) {
    const product = (await tx.select().from(schema.products).where(eq(schema.products.id, c.componentProductId)).limit(1))[0];
    const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
      type: "DisassembleKit", warehouseId: wo.warehouseId, clientId: wo.clientId, productId: c.componentProductId, packType: product?.uom,
      quantity: c.componentQty * input.qty, locationId: target.id, lpId: input.targetLpId, ...attrsFor(product, input.componentAttributes), workOrderId: wo.id, note: `Disassembled from ${wo.code}`,
    });
    await retypeReceiptTxn(tx, txn.id, "Disassemble Kit");
    receiptIds.push(receipt.id);
  }
  await recordWorkOrderChanges(tx, ctx, wo, { disassembledQty: done }, { disassembledQty: done + input.qty });
  await tx.update(schema.workOrders).set({ version: sql`${schema.workOrders.version} + 1`, updatedBy: ctx.userId }).where(eq(schema.workOrders.id, wo.id));
  return { workOrderId: wo.id, disassembledQty: done + input.qty, receiptIds };
}

export interface DisassembleStockResult {
  readonly kitProductId: string;
  readonly qty: number;
  readonly receiptIds: readonly string[];
}

/**
 * Standalone Disassemble Kit (no work order): breaks free kit stock down by the kit's BOM.
 * Posts ledger "Disassemble Kit" on the kit bucket and one DisassembleKit receipt per component.
 */
export async function disassembleStockKit(tx: Tx, ctx: DomainCtx, input: DisassembleStockInput): Promise<DisassembleStockResult> {
  const kit = (await tx.select().from(schema.products).where(eq(schema.products.id, input.kitProductId)).limit(1))[0];
  if (!kit || !kit.isKit) throw new DomainError("NOT_FOUND", "Kit not found");
  checkScope(ctx, { clientId: kit.clientId }, "Kit");
  const bom = await tx.select().from(schema.kitComponents).where(eq(schema.kitComponents.kitProductId, kit.id));
  if (bom.length === 0) throw new DomainError("RULE_VIOLATION", `${kit.sku} has no components to disassemble into.`);
  const bucket = (await tx.select().from(schema.inventory).where(eq(schema.inventory.id, input.sourceInventoryId)).limit(1))[0];
  if (!bucket || bucket.productId !== kit.id) throw new DomainError("VALIDATION", `Choose stock of ${kit.sku}.`, { field: "sourceInventoryId" });
  checkScope(ctx, bucket, "Kit stock");
  if (bucket.status !== "Stock" || bucket.damageReason) throw new DomainError("RULE_VIOLATION", "Only undamaged kit stock can be disassembled.");
  if (freeOf(bucket) < input.qty) throw new DomainError("INSUFFICIENT_STOCK", `Only ${freeOf(bucket)} unallocated kits are in that bucket.`, { field: "qty" });
  const target = (await tx.select().from(schema.locations).where(eq(schema.locations.id, input.targetLocationId)).limit(1))[0];
  if (!target || target.warehouseId !== bucket.warehouseId) throw new DomainError("VALIDATION", "Choose a component location in the kit stock's warehouse.", { field: "targetLocationId" });
  await assertTargetLp(tx, input.targetLpId, bucket.warehouseId);
  await ledger.consume(tx, ctx, { inventoryId: bucket.id, qty: input.qty, type: "Disassemble Kit", refs: { note: `Disassembled ${input.qty} x ${kit.sku}` } });
  const receiptIds: string[] = [];
  for (const c of bom) {
    const product = (await tx.select().from(schema.products).where(eq(schema.products.id, c.componentProductId)).limit(1))[0];
    const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
      type: "DisassembleKit", warehouseId: bucket.warehouseId, clientId: kit.clientId, productId: c.componentProductId, packType: product?.uom,
      quantity: c.quantity * input.qty, locationId: target.id, lpId: input.targetLpId, ...attrsFor(product, input.componentAttributes), note: `Disassembled from ${kit.sku}`,
    });
    await retypeReceiptTxn(tx, txn.id, "Disassemble Kit");
    receiptIds.push(receipt.id);
  }
  return { kitProductId: kit.id, qty: input.qty, receiptIds };
}

/* ------------------------------------------------------ cancel picking */

export async function cancelPicking(tx: Tx, ctx: DomainCtx, workOrderId: string): Promise<WorkOrderRecord> {
  const wo = await getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.type !== "Work Order with Picking") throw new DomainError("INVALID_STATE", `${wo.code} has no picking to cancel.`);
  if (wo.status !== "In Process" && wo.status !== "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}; only In Process or Shortage work orders have picking to cancel.`);
  if (wo.processedQty > 0) throw new DomainError("INVALID_STATE", `Kits were already built from ${wo.code}; picking can't be cancelled.`);
  transitionWorkOrder(wo.status, "Open", { dryRun: true });
  const a = schema.inventoryAllocations;
  const picked = (await tx.select({ n: sql<number>`COUNT(*)` }).from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Picked"))).limit(1))[0]?.n ?? 0;
  if (Number(picked) > 0) throw new DomainError("INVALID_STATE", `Components of ${wo.code} are already picked to the kitting area; build the kits or move the stock back first.`);
  const pending = await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Pending")));
  if (pending.length) await cancelTasks(tx, ctx, { taskIds: pending.map((t) => t.id) });
  for (const alloc of await tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated")))) {
    await ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `Picking cancelled on ${wo.code}` } });
  }
  await tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id));
  if (wo.jobId) {
    const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId)).limit(1))[0];
    const live = (await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.jobId, wo.jobId), ne(schema.tasks.status, "Cancelled"))).limit(1))[0];
    if (job && !live && job.status !== "Completed" && job.status !== "Cancelled") await cancelJob(tx, ctx, { jobId: job.id });
  }
  return await setStatus(tx, ctx, wo, "Open", { jobId: null });
}

/* --------------------------------------------------------------- cancel */

/**
 * Cancels a work order that has not built kits yet: unpicked allocations go back to free
 * stock, open tasks and the job are cancelled. Picked components stay in the kitting area
 * (they are real stock moves) and must be put away separately.
 */
export async function cancelWorkOrder(tx: Tx, ctx: DomainCtx, workOrderId: string): Promise<WorkOrderRecord> {
  const wo = await getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.status === "Completed" || wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is already ${wo.status}.`);
  if (wo.processedQty > 0) throw new DomainError("INVALID_STATE", `Kits were already built from ${wo.code}; it can't be cancelled.`);
  transitionWorkOrder(wo.status, "Cancelled", { dryRun: true });
  const a = schema.inventoryAllocations;
  const picked = (await tx.select({ n: sql<number>`COUNT(*)` }).from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Picked"))).limit(1))[0]?.n ?? 0;
  const started = (await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Started"))).limit(1))[0];
  if (Number(picked) > 0 || started) throw new DomainError("INVALID_STATE", `Picking of ${wo.code} has started; finish or reverse the picked components first.`);
  const open = await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Pending")));
  if (open.length) await cancelTasks(tx, ctx, { taskIds: open.map((t) => t.id) });
  for (const alloc of await tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated")))) {
    await ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `${wo.code} cancelled` } });
  }
  await tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id));
  if (wo.jobId) {
    const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId)).limit(1))[0];
    if (job && job.status !== "Completed" && job.status !== "Cancelled") await cancelJob(tx, ctx, { jobId: job.id });
  }
  return await setStatus(tx, ctx, wo, "Cancelled", { cancelledAt: nowIso() });
}

/**
 * Data repair (round 4): before the round-3 rule change a partial build on a work order
 * without picking moved it to In Process. The current rule keeps it Open (Processed n of m).
 * This normalizes those legacy rows: without picking, In Process, 0 < processed < requested,
 * no job. Each repaired row gets a change-log entry. Idempotent; returns the repaired codes.
 */
export async function repairLegacyPartialStatuses(tx: Tx, ctx: DomainCtx): Promise<string[]> {
  const w = schema.workOrders;
  const rows = await tx.select().from(w).where(and(
    eq(w.type, "Work Order without Picking"), eq(w.status, "In Process"),
    sql`${w.processedQty} > 0`, sql`${w.processedQty} < ${w.requestedQty}`, sql`${w.jobId} IS NULL`,
  ));
  return await mapSeq(rows, async (r) => (await patchWorkOrder(tx, ctx, r, { status: "Open" })).code);
}

export interface HistoryRepairResult {
  /** Shortage work orders that got their "Manual Allocation - Work Order" exception rows. */
  readonly exceptions: readonly string[];
  /** Completed work orders that got the Kitting receipt for their kit output. */
  readonly receipts: readonly string[];
  /** Kitting / DisassembleKit receipt ledger rows retyped from "Receiving" (live builds before round 6). */
  readonly retyped: number;
  /** In Process with-picking work orders whose picking job got its missing Picking tasks. */
  readonly pickTasks?: readonly string[];
}

/**
 * Judge round 1: older seeded "with picking" work orders were allocated with a job that holds only
 * the Kitting task, so the job read "Picked 0" with nothing to pick and Create Kit had no gate.
 * Live allocation writes one Picking task per allocation slice (source bucket → kitting area).
 * This writes those tasks for every open allocation of the work order that has none, links the
 * allocation to its task, puts the Kitting task last and rolls up the job. Stock is not touched.
 */
export async function repairMissingPickTasks(tx: Tx, ctx: DomainCtx): Promise<string[]> {
  const w = schema.workOrders;
  const a = schema.inventoryAllocations;
  const repaired: string[] = [];
  const rows = await tx.select().from(w).where(and(eq(w.status, "In Process"), eq(w.type, "Work Order with Picking")));
  for (const wo of rows) {
    if (!wo.jobId || (await pickTasksOf(tx, wo.id)).length > 0) continue;
    const job = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId)).limit(1))[0];
    if (!job) continue;
    const allocations = await tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated"), sql`${a.taskId} IS NULL`)).orderBy(asc(a.createdAt));
    if (allocations.length === 0) continue;
    const target = wo.outputLocationId ?? await defaultKittingLocation(tx, wo.warehouseId);
    let taskNo = await nextTaskNo(tx);
    let sequence = 0;
    for (const alloc of allocations) {
      const b = (await tx.select().from(schema.inventory).where(eq(schema.inventory.id, alloc.inventoryId)).limit(1))[0];
      if (!b) continue;
      sequence += 1;
      const task = (await tx.insert(schema.tasks).values({
        jobId: job.id, warehouseId: wo.warehouseId, clientId: wo.clientId, workOrderId: wo.id, priority: job.priority, assigneeUserId: job.assignedToUserId,
        taskNo: taskNo++, taskType: "Picking", sequence, allocationId: alloc.id, productId: b.productId, packType: b.packType, plannedQty: alloc.qty,
        sourceLocationId: b.locationId, sourceLpId: b.lpId, targetLocationId: target, lotNumber: b.lotNumber, expiryDate: b.expiryDate, productionDate: b.productionDate,
        createdBy: ctx.userId, updatedBy: ctx.userId,
      }).returning({ id: schema.tasks.id }))[0];
      await tx.update(a).set({ taskId: task.id, jobId: alloc.jobId ?? job.id, updatedBy: ctx.userId }).where(eq(a.id, alloc.id));
    }
    if (sequence === 0) continue;
    await tx.update(schema.tasks).set({ sequence: sequence + 1 }).where(and(eq(schema.tasks.jobId, job.id), eq(schema.tasks.taskType, "Kitting")));
    await rollupJob(tx, ctx, job.id);
    repaired.push(wo.code);
  }
  return repaired;
}

/**
 * Data repair (round 7): older seeded history was written without the records the live
 * commands produce. Live `allocateWorkOrder` writes one allocation exception per short
 * component on Shortage, and live `createKit` posts a Kitting receipt for the kit output.
 * This backfills both so the Exceptions and Receipts tabs (and Receiving History) behave
 * the same for seeded and live work orders:
 *   - a Shortage work order with no exception rows gets one row per component that is short
 *     now, using the same planner as allocation;
 *   - a Completed work order with no Kitting receipt gets one receipt per kit-output ledger
 *     row (same quantity, location, lot and time). It is linked to that ledger row, and stock
 *     is not touched (the ledger already holds the units).
 * Idempotent; returns the repaired codes.
 */
export async function repairWorkOrderHistory(tx: Tx, ctx: DomainCtx): Promise<HistoryRepairResult> {
  const w = schema.workOrders;
  const ex = schema.allocationExceptions;
  const exceptions: string[] = [];
  for (const wo of await tx.select().from(w).where(eq(w.status, "Shortage"))) {
    const has = (await tx.select({ id: ex.id }).from(ex).where(and(eq(ex.orderId, wo.id), eq(ex.waveNo, WORK_ORDER_EXCEPTION_WAVE))).limit(1))[0];
    if (has) continue;
    let wrote = false;
    for (const c of await componentsOf(tx, wo.id)) {
      const need = componentNeed(wo, c);
      const plan = await planComponent(tx, wo, c, need);
      const got = plan.slices.reduce((s, x) => s + x.qty, 0);
      if (need - got <= 0) continue;
      await recordWorkOrderException(tx, ctx, { workOrder: wo, productId: c.componentProductId, inventoryQty: plan.free, requiredQty: need });
      wrote = true;
    }
    if (wrote) exceptions.push(wo.code);
  }

  const r = schema.receipts;
  const t = schema.inventoryTransactions;
  const receipts: string[] = [];
  for (const wo of await tx.select().from(w).where(eq(w.status, "Completed"))) {
    const has = (await tx.select({ id: r.id }).from(r).where(and(eq(r.workOrderId, wo.id), eq(r.type, "Kitting"))).limit(1))[0];
    if (has) continue;
    // Kit output rows: the kit product coming into a location for this work order.
    const outputs = await tx.select().from(t).where(and(
      eq(t.workOrderId, wo.id), eq(t.productId, wo.kitProductId), inArray(t.type, ["Kitting", "Receiving"]),
      sql`${t.toLocationId} IS NOT NULL`, sql`${t.fromLocationId} IS NULL`, sql`${t.uomQty} > 0`,
    )).orderBy(asc(t.seq));
    if (outputs.length === 0) continue;
    for (const o of outputs) {
      const linked = (await tx.select({ id: r.id }).from(r).where(eq(r.inventoryTransactionId, o.id)).limit(1))[0];
      if (linked || !o.toLocationId) continue;
      await tx.insert(r).values({
        masterId: await sequences.nextInteger(tx, "receipt"), type: "Kitting", warehouseId: wo.warehouseId, clientId: wo.clientId,
        workOrderId: wo.id, shipmentOrderId: wo.shipmentOrderId, productId: o.productId, packType: o.toPackType ?? "Each",
        quantity: o.packQty, uomQuantity: o.uomQty, lotNumber: o.toLot, expiryDate: o.toExpiry, productionDate: o.toProductionDate,
        locationId: o.toLocationId, lpId: o.toLpId, parentLpId: o.toParentLpId, note: `Built by ${wo.code}`,
        inventoryTransactionId: o.id, receivedBy: ctx.source, receivedAt: o.at,
      });
    }
    receipts.push(wo.code);
  }

  // Round 6: live Create Kit / Disassemble posted their receipt rows as "Receiving".
  let retyped = 0;
  for (const [receiptType, txnType] of Object.entries(KIT_RECEIPT_TXN_TYPE) as [keyof typeof KIT_RECEIPT_TXN_TYPE, (typeof KIT_RECEIPT_TXN_TYPE)[keyof typeof KIT_RECEIPT_TXN_TYPE]][]) {
    const ids = (await tx.select({ id: t.id }).from(t).innerJoin(r, eq(r.inventoryTransactionId, t.id))
      .where(and(eq(r.type, receiptType), eq(t.type, "Receiving")))).map((x) => x.id);
    for (const id of ids) await retypeReceiptTxn(tx, id, txnType);
    retyped += ids.length;
  }
  return { exceptions, receipts, retyped, pickTasks: await repairMissingPickTasks(tx, ctx) };
}
