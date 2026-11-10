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
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Priority, WorkOrderStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, sequences, stateMachines } from "@/server/domain";
import { conflictError } from "@/server/api/errors";
import { DomainError } from "@/server/domain/errors";
import { assertUserInWarehouse, cancelJob } from "@/server/domain/jobs";
import { rollupJob } from "@/server/domain/progress";
import { cancel as cancelTasks, execute as executeTasks } from "@/server/domain/tasks";
import { checkScope, nowIso, type DomainCtx, type Tx } from "@/server/domain/types";
import { remainingQty, type CreateKitInput, type DisassembleInput } from "@/lib/grid-defs/work-orders/work-order-model";
import { recordWorkOrderException, transitionWorkOrder } from "./work-orders-adapters";
import { defaultKittingLocation, patchWorkOrder, WO_ENTITY, type WorkOrderRecord } from "./work-orders";

export interface AllocateWorkOrderResult {
  readonly workOrderId: string;
  readonly status: "In Process" | "Shortage";
  readonly allocatedQty: number;
  readonly shortageQty: number;
}

export type AllocateWorkOrder = (tx: Tx, ctx: DomainCtx, workOrderId: string) => AllocateWorkOrderResult;

export interface AllocateOptions {
  readonly jobTypeId?: string | null;
  readonly assigneeUserId?: string | null;
  readonly priority?: Priority;
}

type ComponentRecord = typeof schema.workOrderComponents.$inferSelect;
type Bucket = typeof schema.inventory.$inferSelect;

export const WORK_ORDER_EXCEPTION_WAVE = "Manual Allocation - Work Order";

export function getWorkOrderForUpdate(tx: Tx, ctx: DomainCtx, workOrderId: string): WorkOrderRecord {
  const wo = tx.select().from(schema.workOrders).where(eq(schema.workOrders.id, workOrderId)).get();
  if (!wo) throw new DomainError("NOT_FOUND", "Work order not found");
  checkScope(ctx, wo, "Work order");
  return wo;
}

function componentsOf(tx: Tx, workOrderId: string): ComponentRecord[] {
  return tx.select().from(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, workOrderId)).all();
}

const skuOf = (tx: Tx, productId: string): string =>
  tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get()?.sku ?? productId;

/** Free, allocatable component buckets (FEFO), restricted to the component's chosen source. */
export function candidateBuckets(tx: Tx, wo: WorkOrderRecord, c: ComponentRecord): Bucket[] {
  const i = schema.inventory;
  const rows = tx.select({ i, locked: schema.locations.isLocked, prevent: schema.locations.preventAllocation })
    .from(i).innerJoin(schema.locations, eq(schema.locations.id, i.locationId))
    .where(and(
      eq(i.warehouseId, wo.warehouseId), eq(i.clientId, wo.clientId), eq(i.productId, c.componentProductId), eq(i.status, "Stock"),
      sql`${i.damageReason} IS NULL`, sql`${i.onHand} - ${i.allocated} > 0`,
      c.locationId ? eq(i.locationId, c.locationId) : undefined,
      c.lpId ? eq(i.lpId, c.lpId) : undefined,
      c.lotNumber ? eq(i.lotNumber, c.lotNumber) : undefined,
      c.expiryDate ? eq(i.expiryDate, c.expiryDate) : undefined,
    ))
    .orderBy(asc(i.expiryDate), asc(i.receivedAt), asc(schema.locations.walkingPathPriority)).all();
  // A chosen source location is honoured even when it is flagged "prevent allocation".
  return rows.filter((r) => !r.locked && (c.locationId ? true : !r.prevent)).map((r) => r.i);
}

const freeOf = (b: Bucket): number => b.onHand - b.allocated;

interface Slice { readonly bucket: Bucket; readonly qty: number }

function planComponent(tx: Tx, wo: WorkOrderRecord, c: ComponentRecord, need: number): { slices: Slice[]; free: number } {
  const buckets = candidateBuckets(tx, wo, c);
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

function workOrderJobType(tx: Tx, warehouseId: string, jobTypeId?: string | null): typeof schema.jobTypes.$inferSelect {
  const jt = schema.jobTypes;
  const row = jobTypeId
    ? tx.select().from(jt).where(eq(jt.id, jobTypeId)).get()
    : tx.select().from(jt).where(and(eq(jt.warehouseId, warehouseId), eq(jt.operationType, "Work Order"), eq(jt.isActive, true))).orderBy(asc(jt.code)).get();
  if (!row) throw new DomainError("VALIDATION", "No active Work Order job type is configured for this warehouse.");
  if (row.warehouseId !== warehouseId) throw new DomainError("VALIDATION", `Job type ${row.code} belongs to another warehouse.`);
  if (row.operationType !== "Work Order") throw new DomainError("VALIDATION", `Job type ${row.code} is not a Work Order job type.`);
  if (!row.isActive) throw new DomainError("INVALID_STATE", `Job type ${row.code} is inactive.`);
  return row;
}

const nextTaskNo = (tx: Tx): number => (tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0) + 1;

function setStatus(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, to: WorkOrderStatus, extra: Partial<typeof schema.workOrders.$inferInsert> = {}): WorkOrderRecord {
  if (wo.status === to) return Object.keys(extra).length ? patchWorkOrder(tx, ctx, wo, extra) : wo;
  return patchWorkOrder(tx, ctx, wo, { status: transitionWorkOrder(wo.status, to), ...extra });
}

/** Allocates the components of a "with picking" work order and creates its picking job. */
export function allocateWorkOrderWith(tx: Tx, ctx: DomainCtx, workOrderId: string, opts: AllocateOptions = {}): AllocateWorkOrderResult {
  const wo = getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.type !== "Work Order with Picking") throw new DomainError("INVALID_STATE", `${wo.code} is a work order without picking; build it with Create Kit.`);
  if (wo.status !== "Open" && wo.status !== "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}; only Open or Shortage work orders can be allocated.`);
  const components = componentsOf(tx, wo.id);
  if (components.length === 0) throw new DomainError("VALIDATION", `${wo.code} has no components.`);
  const plans = components.map((c) => {
    const need = componentNeed(wo, c);
    const plan = planComponent(tx, wo, c, need);
    return { c, need, ...plan, short: Math.max(0, need - plan.slices.reduce((s, x) => s + x.qty, 0)) };
  });
  const shortageQty = plans.reduce((s, p) => s + p.short, 0);
  if (shortageQty > 0) {
    for (const p of plans.filter((x) => x.short > 0)) {
      recordWorkOrderException(tx, ctx, { workOrder: wo, productId: p.c.componentProductId, inventoryQty: p.free, requiredQty: p.need });
    }
    if (wo.status !== "Shortage") setStatus(tx, ctx, wo, "Shortage");
    return { workOrderId: wo.id, status: "Shortage", allocatedQty: 0, shortageQty };
  }
  const jobType = workOrderJobType(tx, wo.warehouseId, opts.jobTypeId);
  if (opts.assigneeUserId) assertUserInWarehouse(tx, opts.assigneeUserId, wo.warehouseId);
  const target = wo.outputLocationId ?? defaultKittingLocation(tx, wo.warehouseId);
  const start = new Date(Date.now() + 15 * 60_000);
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: sequences.next(tx, "job"), warehouseId: wo.warehouseId, clientId: wo.clientId, jobType: jobType.code,
    jobTypeId: jobType.id, operationType: "Work Order", workOrderId: wo.id, status: "Pending", priority: opts.priority ?? "None",
    assignedToUserId: opts.assigneeUserId ?? null, plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 3_600_000).toISOString(),
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = nextTaskNo(tx);
  let sequence = 0;
  const base = { jobId: job.id, warehouseId: wo.warehouseId, clientId: wo.clientId, workOrderId: wo.id, priority: job.priority, assigneeUserId: job.assignedToUserId, createdBy: ctx.userId, updatedBy: ctx.userId };
  let allocatedQty = 0;
  for (const p of plans) {
    let componentAllocated = 0;
    for (const s of p.slices) {
      const { allocation } = ledger.allocate(tx, ctx, {
        inventoryId: s.bucket.id, qty: s.qty, workOrderId: wo.id, workOrderComponentId: p.c.id, jobId: job.id, ruleName: "Work order components",
        refs: { note: `Component of ${wo.code}` },
      });
      sequence += 1;
      const task = tx.insert(schema.tasks).values({
        ...base, taskNo: taskNo++, taskType: "Picking", sequence, allocationId: allocation.id, productId: s.bucket.productId, packType: s.bucket.packType,
        plannedQty: s.qty, sourceLocationId: s.bucket.locationId, sourceLpId: s.bucket.lpId, targetLocationId: target,
        lotNumber: s.bucket.lotNumber, expiryDate: s.bucket.expiryDate, productionDate: s.bucket.productionDate,
      }).returning({ id: schema.tasks.id }).get();
      tx.update(schema.inventoryAllocations).set({ taskId: task.id, updatedBy: ctx.userId }).where(eq(schema.inventoryAllocations.id, allocation.id)).run();
      componentAllocated += s.qty;
    }
    if (componentAllocated > 0) {
      tx.update(schema.workOrderComponents).set({ allocatedQty: p.c.allocatedQty + componentAllocated }).where(eq(schema.workOrderComponents.id, p.c.id)).run();
      changeLog.recordLine(tx, ctx, { entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, lineEntityType: "work_order_component", lineEntityId: p.c.id, lineLabel: skuOf(tx, p.c.componentProductId), field: "allocatedQty", from: p.c.allocatedQty, to: p.c.allocatedQty + componentAllocated });
    }
    allocatedQty += componentAllocated;
  }
  const kit = tx.select().from(schema.products).where(eq(schema.products.id, wo.kitProductId)).get();
  sequence += 1;
  tx.insert(schema.tasks).values({ ...base, taskNo: taskNo++, taskType: "Kitting", sequence, productId: wo.kitProductId, packType: kit?.uom ?? "Each", plannedQty: remainingQty(wo), targetLocationId: target }).run();
  rollupJob(tx, ctx, job.id);
  setStatus(tx, ctx, wo, "In Process", { jobId: job.id, actualStartAt: wo.actualStartAt ?? nowIso(), outputLocationId: target });
  return { workOrderId: wo.id, status: "In Process", allocatedQty, shortageQty: 0 };
}

export const allocateWorkOrder: AllocateWorkOrder = (tx, ctx, workOrderId) => allocateWorkOrderWith(tx, ctx, workOrderId);

/* --------------------------------------------------------- create kit */

export interface CreateKitResult {
  readonly workOrderId: string;
  readonly status: WorkOrderStatus;
  readonly processedQty: number;
  readonly receiptId: string;
}

function activeAllocations(tx: Tx, componentId: string) {
  const a = schema.inventoryAllocations;
  return tx.select().from(a).where(and(eq(a.workOrderComponentId, componentId), inArray(a.status, ["Picked", "Allocated"])))
    .orderBy(sql`CASE ${a.status} WHEN 'Picked' THEN 0 ELSE 1 END`, asc(a.createdAt)).all();
}

/** Completes the pending picking tasks of a work order to its kitting location. */
function completePicking(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, targetLocationId: string): number {
  const pending = tx.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.taskType, "Picking"), inArray(schema.tasks.status, ["Pending", "Started"]))).all();
  if (pending.length === 0) return 0;
  executeTasks(tx, ctx, { taskIds: pending.map((t) => t.id), targetLocationId });
  return pending.length;
}

function consumeComponent(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, c: ComponentRecord, qty: number): void {
  const refs = { workOrderId: wo.id, note: `Consumed by ${wo.code}` };
  let left = qty;
  let fromAllocations = 0;
  if (wo.type === "Work Order with Picking") {
    for (const alloc of activeAllocations(tx, c.id)) {
      if (left <= 0) break;
      const take = Math.min(left, alloc.qty);
      ledger.consume(tx, ctx, { inventoryId: alloc.inventoryId, qty: take, allocationId: alloc.id, type: "Kitting", refs: { ...refs, jobId: alloc.jobId } });
      left -= take;
      fromAllocations += take;
    }
  }
  if (left > 0) {
    for (const b of candidateBuckets(tx, wo, c)) {
      if (left <= 0) break;
      const take = Math.min(left, freeOf(b));
      ledger.consume(tx, ctx, { inventoryId: b.id, qty: take, type: "Kitting", refs });
      left -= take;
    }
  }
  if (left > 0) {
    const where = c.locationId ? " at the chosen source" : "";
    throw new DomainError("INSUFFICIENT_STOCK", `Not enough ${skuOf(tx, c.componentProductId)} free${where}: ${qty - left} of ${qty} units available.`, { productId: c.componentProductId });
  }
  tx.update(schema.workOrderComponents).set({
    consumedQty: c.consumedQty + qty,
    allocatedQty: Math.max(0, c.allocatedQty - fromAllocations),
    pickedQty: wo.type === "Work Order with Picking" ? c.pickedQty + fromAllocations : c.pickedQty,
  }).where(eq(schema.workOrderComponents.id, c.id)).run();
  changeLog.recordLine(tx, ctx, { entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, lineEntityType: "work_order_component", lineEntityId: c.id, lineLabel: skuOf(tx, c.componentProductId), field: "consumedQty", from: c.consumedQty, to: c.consumedQty + qty });
}

function advanceKittingTask(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord, qty: number, locationId: string, done: boolean): void {
  const task = tx.select().from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.taskType, "Kitting"), inArray(schema.tasks.status, ["Pending", "Started"]))).get();
  if (!task) return;
  const now = nowIso();
  const status = done ? stateMachines.task.transition(task.status, "Completed") : task.status === "Pending" ? stateMachines.task.transition(task.status, "Started") : task.status;
  tx.update(schema.tasks).set({
    status, actualQty: task.actualQty + qty, targetLocationId: locationId, executedByUserId: ctx.userId, startedAt: task.startedAt ?? now,
    finishedAt: done ? now : null, updatedBy: ctx.userId,
  }).where(eq(schema.tasks.id, task.id)).run();
  rollupJob(tx, ctx, task.jobId);
}

export function createKit(tx: Tx, ctx: DomainCtx, input: CreateKitInput): CreateKitResult {
  let wo = getWorkOrderForUpdate(tx, ctx, input.workOrderId);
  if (input.version !== undefined && input.version !== wo.version) throw conflictError();
  if (wo.status === "Completed" || wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}.`);
  if (wo.status === "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is short of components; allocate them first.`);
  if (wo.type === "Work Order with Picking" && wo.status === "Open") throw new DomainError("INVALID_STATE", `${wo.code} needs Picking/Job Operations before kits can be built.`);
  const remaining = remainingQty(wo);
  if (input.qty > remaining) throw new DomainError("VALIDATION", `At most ${remaining} kits are left to build on ${wo.code}.`, { field: "qty" });
  const location = tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId)).get();
  if (!location || location.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose an output location in the work order's warehouse.", { field: "locationId" });
  if (input.lpId) {
    const lp = tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, input.lpId)).get();
    if (!lp || lp.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose an LP in the work order's warehouse.", { field: "lpId" });
  }
  const kit = tx.select().from(schema.products).where(eq(schema.products.id, wo.kitProductId)).get();
  if (!kit) throw new DomainError("NOT_FOUND", "Kit product not found");
  if (kit.trackLot && !input.lotNumber) throw new DomainError("VALIDATION", `${kit.sku} is lot tracked; enter a lot number.`, { field: "lotNumber" });
  if (kit.trackExpiry && !input.expiryDate) throw new DomainError("VALIDATION", `${kit.sku} is expiry tracked; enter an expiry date.`, { field: "expiryDate" });
  if (kit.trackProductionDate && !input.productionDate) throw new DomainError("VALIDATION", `${kit.sku} tracks production dates; enter one.`, { field: "productionDate" });
  if (wo.type === "Work Order with Picking") completePicking(tx, ctx, wo, wo.outputLocationId ?? input.locationId);
  for (const c of componentsOf(tx, wo.id)) consumeComponent(tx, ctx, wo, c, c.componentQty * input.qty);
  const { receipt } = ledger.recordReceipt(tx, ctx, {
    type: "Kitting", warehouseId: wo.warehouseId, clientId: wo.clientId, productId: kit.id, packType: kit.uom, quantity: input.qty,
    locationId: input.locationId, lpId: input.lpId, lotNumber: input.lotNumber, expiryDate: input.expiryDate, productionDate: input.productionDate,
    workOrderId: wo.id, shipmentOrderId: wo.shipmentOrderId, note: `Built by ${wo.code}`,
  });
  const processedQty = wo.processedQty + input.qty;
  const done = processedQty >= wo.requestedQty;
  const stamps = { processedQty, actualStartAt: wo.actualStartAt ?? nowIso(), outputLocationId: input.locationId, outputLot: input.lotNumber ?? wo.outputLot, outputExpiry: input.expiryDate ?? wo.outputExpiry };
  if (wo.status === "Open") wo = setStatus(tx, ctx, wo, "In Process", done ? {} : stamps);
  wo = done ? setStatus(tx, ctx, wo, "Completed", { ...stamps, actualFinishAt: nowIso() }) : wo.processedQty === processedQty ? wo : patchWorkOrder(tx, ctx, wo, stamps);
  advanceKittingTask(tx, ctx, wo, input.qty, input.locationId, done);
  if (done) releaseLeftovers(tx, ctx, wo);
  return { workOrderId: wo.id, status: wo.status, processedQty: wo.processedQty, receiptId: receipt.id };
}

/** After the last kit, any unconsumed unpicked allocation goes back to free stock. */
function releaseLeftovers(tx: Tx, ctx: DomainCtx, wo: WorkOrderRecord): void {
  const a = schema.inventoryAllocations;
  for (const alloc of tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated"))).all()) {
    ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `Released after ${wo.code} completed` } });
  }
  tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id)).run();
}

/* ------------------------------------------------------- disassemble */

export function disassembledQty(tx: Tx, workOrderId: string, kitProductId: string): number {
  const it = schema.inventoryTransactions;
  return Number(tx.select({ n: sql<number>`COALESCE(SUM(ABS(${it.uomQty})), 0)` }).from(it)
    .where(and(eq(it.workOrderId, workOrderId), eq(it.productId, kitProductId), eq(it.type, "Disassemble Kit"))).get()?.n ?? 0);
}

export interface DisassembleResult {
  readonly workOrderId: string;
  readonly disassembledQty: number;
  readonly receiptIds: readonly string[];
}

export function disassembleKit(tx: Tx, ctx: DomainCtx, input: DisassembleInput): DisassembleResult {
  const wo = getWorkOrderForUpdate(tx, ctx, input.workOrderId);
  if (input.version !== undefined && input.version !== wo.version) throw conflictError();
  if (wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is Cancelled.`);
  const done = disassembledQty(tx, wo.id, wo.kitProductId);
  const left = wo.processedQty - done;
  if (left <= 0) throw new DomainError("INVALID_STATE", `Every kit built by ${wo.code} was already disassembled.`);
  if (input.qty > left) throw new DomainError("VALIDATION", `At most ${left} kits of ${wo.code} can be disassembled.`, { field: "qty" });
  const bucket = tx.select().from(schema.inventory).where(eq(schema.inventory.id, input.sourceInventoryId)).get();
  if (!bucket || bucket.productId !== wo.kitProductId || bucket.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose kit stock of this work order's kit and warehouse.", { field: "sourceInventoryId" });
  if (bucket.status !== "Stock" || bucket.damageReason) throw new DomainError("RULE_VIOLATION", "Only undamaged kit stock can be disassembled.");
  if (freeOf(bucket) < input.qty) throw new DomainError("INSUFFICIENT_STOCK", `Only ${freeOf(bucket)} unallocated kits are in that bucket.`);
  const target = tx.select().from(schema.locations).where(eq(schema.locations.id, input.targetLocationId)).get();
  if (!target || target.warehouseId !== wo.warehouseId) throw new DomainError("VALIDATION", "Choose a component location in the work order's warehouse.", { field: "targetLocationId" });
  ledger.consume(tx, ctx, { inventoryId: bucket.id, qty: input.qty, type: "Disassemble Kit", refs: { workOrderId: wo.id, note: `Disassembled by ${wo.code}` } });
  const receiptIds: string[] = [];
  for (const c of componentsOf(tx, wo.id)) {
    const product = tx.select().from(schema.products).where(eq(schema.products.id, c.componentProductId)).get();
    const { receipt } = ledger.recordReceipt(tx, ctx, {
      type: "DisassembleKit", warehouseId: wo.warehouseId, clientId: wo.clientId, productId: c.componentProductId, packType: product?.uom,
      quantity: c.componentQty * input.qty, locationId: target.id, lpId: input.targetLpId, workOrderId: wo.id, note: `Disassembled from ${wo.code}`,
    });
    receiptIds.push(receipt.id);
  }
  changeLog.recordUpdate(tx, ctx, { entityType: WO_ENTITY, entityId: wo.id, entityCode: wo.code, before: { disassembledQty: done }, after: { disassembledQty: done + input.qty } });
  tx.update(schema.workOrders).set({ version: sql`${schema.workOrders.version} + 1`, updatedBy: ctx.userId }).where(eq(schema.workOrders.id, wo.id)).run();
  return { workOrderId: wo.id, disassembledQty: done + input.qty, receiptIds };
}

/* ------------------------------------------------------ cancel picking */

export function cancelPicking(tx: Tx, ctx: DomainCtx, workOrderId: string): WorkOrderRecord {
  const wo = getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.type !== "Work Order with Picking") throw new DomainError("INVALID_STATE", `${wo.code} has no picking to cancel.`);
  if (wo.status !== "In Process" && wo.status !== "Shortage") throw new DomainError("INVALID_STATE", `${wo.code} is ${wo.status}; only In Process or Shortage work orders have picking to cancel.`);
  if (wo.processedQty > 0) throw new DomainError("INVALID_STATE", `Kits were already built from ${wo.code}; picking can't be cancelled.`);
  transitionWorkOrder(wo.status, "Open", { dryRun: true });
  const a = schema.inventoryAllocations;
  const picked = tx.select({ n: sql<number>`COUNT(*)` }).from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Picked"))).get()?.n ?? 0;
  if (Number(picked) > 0) throw new DomainError("INVALID_STATE", `Components of ${wo.code} are already picked to the kitting area; build the kits or move the stock back first.`);
  const pending = tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Pending"))).all();
  if (pending.length) cancelTasks(tx, ctx, { taskIds: pending.map((t) => t.id) });
  for (const alloc of tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated"))).all()) {
    ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `Picking cancelled on ${wo.code}` } });
  }
  tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id)).run();
  if (wo.jobId) {
    const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId)).get();
    const live = tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.jobId, wo.jobId), ne(schema.tasks.status, "Cancelled"))).get();
    if (job && !live && job.status !== "Completed" && job.status !== "Cancelled") cancelJob(tx, ctx, { jobId: job.id });
  }
  return setStatus(tx, ctx, wo, "Open", { jobId: null });
}

/* --------------------------------------------------------------- cancel */

/**
 * Cancels a work order that has not built kits yet: unpicked allocations go back to free
 * stock, open tasks and the job are cancelled. Picked components stay in the kitting area
 * (they are real stock moves) and must be put away separately.
 */
export function cancelWorkOrder(tx: Tx, ctx: DomainCtx, workOrderId: string): WorkOrderRecord {
  const wo = getWorkOrderForUpdate(tx, ctx, workOrderId);
  if (wo.status === "Completed" || wo.status === "Cancelled") throw new DomainError("INVALID_STATE", `${wo.code} is already ${wo.status}.`);
  if (wo.processedQty > 0) throw new DomainError("INVALID_STATE", `Kits were already built from ${wo.code}; it can't be cancelled.`);
  transitionWorkOrder(wo.status, "Cancelled", { dryRun: true });
  const a = schema.inventoryAllocations;
  const picked = tx.select({ n: sql<number>`COUNT(*)` }).from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Picked"))).get()?.n ?? 0;
  const started = tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Started"))).get();
  if (Number(picked) > 0 || started) throw new DomainError("INVALID_STATE", `Picking of ${wo.code} has started; finish or reverse the picked components first.`);
  const open = tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.status, "Pending"))).all();
  if (open.length) cancelTasks(tx, ctx, { taskIds: open.map((t) => t.id) });
  for (const alloc of tx.select().from(a).where(and(eq(a.workOrderId, wo.id), eq(a.status, "Allocated"))).all()) {
    ledger.releaseAllocation(tx, ctx, { allocationId: alloc.id, refs: { workOrderId: wo.id, note: `${wo.code} cancelled` } });
  }
  tx.update(schema.workOrderComponents).set({ allocatedQty: 0 }).where(eq(schema.workOrderComponents.workOrderId, wo.id)).run();
  if (wo.jobId) {
    const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, wo.jobId)).get();
    if (job && job.status !== "Completed" && job.status !== "Cancelled") cancelJob(tx, ctx, { jobId: job.id });
  }
  return setStatus(tx, ctx, wo, "Cancelled", { cancelledAt: nowIso() });
}
