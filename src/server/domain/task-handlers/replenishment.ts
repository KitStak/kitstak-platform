/**
 * Replenishment (BUILD_PLAN M03 §9, owner M03).
 *
 *   createReplenishmentJob — one job of Replenishment tasks from `putaway.dynamicReplenishmentTargets`
 *     (source = reserve stock, FEFO/FIFO/LIFO; target = the product's pick face).
 *   executeReplenishment — Pick phase: source → cart / LP, then a Put-phase task is created
 *     for the remainder of the trip. Put / Direct Put: → target pick face. Supports LP swap
 *     (put the whole source LP) and pack-type conversion. Every move writes ledger `Replenishment`.
 */
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { jobTypeSettingsSchema, parseSettings } from "@/lib/domain-types";
import type { Priority } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { recordCreate } from "../change-log";
import { DomainError } from "../errors";
import { freeQty, type InventoryRow } from "../ledger/bucket";
import { move } from "../ledger/operations";
import { getLocation } from "../ledger/rules";
import { rollupJob } from "../progress";
import { dynamicReplenishmentTargets } from "../putaway";
import { next } from "../sequences";
import type { DomainCtx, Tx } from "../types";
import { assertExecutable, assertQty, completeTask } from "./shared";
import type { TaskExecution, TaskHandler, TaskRow } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function nextTaskNo(tx: Tx): number {
  return (tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0) + 1;
}

/** Stock that can feed a pick face: free Stock outside pick faces, in algorithm order. */
export function replenishmentSources(tx: Tx, warehouseId: string, productId: string, method: "FEFO" | "FIFO" | "LIFO"): InventoryRow[] {
  const rows = tx.select({ inv: schema.inventory, loc: schema.locations }).from(schema.inventory)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventory.locationId))
    .where(and(
      eq(schema.inventory.warehouseId, warehouseId), eq(schema.inventory.productId, productId), eq(schema.inventory.status, "Stock"),
      gt(schema.inventory.onHand, 0), sql`${schema.inventory.damageReason} IS NULL`,
      sql`COALESCE(${schema.locations.replenishmentType}, '') <> 'Target'`, sql`COALESCE(${schema.locations.areaType}, '') NOT IN ('Picking','Packing','Shipment','Receiving','Returns')`,
      eq(schema.locations.preventAllocation, false),
    )).all().map((r) => r.inv).filter((b) => freeQty(b) > 0);
  const key = (b: InventoryRow): string => (method === "FEFO" ? b.expiryDate ?? "9999" : b.receivedAt ?? "9999");
  return rows.sort((a, b) => (method === "LIFO" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
}

/** The product's pick face: a Target / Picking location already holding it, else any Target location. */
export function pickFaceFor(tx: Tx, warehouseId: string, productId: string): string | null {
  const holding = tx.get<{ id: string }>(sql`SELECT l.id FROM inventory i JOIN locations l ON l.id = i.location_id
    WHERE i.product_id = ${productId} AND i.warehouse_id = ${warehouseId} AND (l.replenishment_type = 'Target' OR l.area_type = 'Picking')
    ORDER BY l.walking_path_priority LIMIT 1`);
  if (holding) return holding.id;
  return tx.get<{ id: string }>(sql`SELECT id FROM locations WHERE warehouse_id = ${warehouseId} AND replenishment_type = 'Target' AND is_active = 1 ORDER BY walking_path_priority LIMIT 1`)?.id ?? null;
}

export interface CreateReplenishmentJobInput {
  readonly warehouseId: string;
  readonly jobTypeId: string;
  readonly waveId?: string | null;
  readonly waveNo?: string | null;
  readonly ruleName?: string | null;
  readonly waveRuleId?: string | null;
  readonly priority?: Priority;
  readonly assigneeUserId?: string | null;
  readonly now?: Date;
}

export interface CreateReplenishmentJobResult {
  readonly jobId: string | null;
  readonly taskCount: number;
  readonly skipped: readonly { readonly sku: string; readonly reason: string }[];
}

export function createReplenishmentJob(tx: Tx, ctx: DomainCtx, input: CreateReplenishmentJobInput): CreateReplenishmentJobResult {
  const jobType = tx.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, input.jobTypeId)).get();
  if (!jobType || jobType.operationType !== "Replenishment") throw new DomainError("VALIDATION", "Choose a replenishment job type.");
  const settings = parseSettings(jobTypeSettingsSchema, jobType.settings).replenishment;
  const targets = dynamicReplenishmentTargets(tx, input.warehouseId, { onlyNeeded: true });
  const plans: { productId: string; source: InventoryRow; qty: number; target: string }[] = [];
  const skipped: { sku: string; reason: string }[] = [];
  for (const target of targets) {
    const face = pickFaceFor(tx, input.warehouseId, target.productId);
    if (!face) { skipped.push({ sku: target.sku, reason: "No pick face location" }); continue; }
    let need = target.toReplenish;
    for (const source of replenishmentSources(tx, input.warehouseId, target.productId, settings.algorithmMethod)) {
      if (need <= 0) break;
      if (source.locationId === face) continue;
      const qty = settings.onlyPickFullLp && source.lpId ? freeQty(source) : Math.min(need, freeQty(source));
      plans.push({ productId: target.productId, source, qty, target: face });
      need -= qty;
    }
    if (need === target.toReplenish) skipped.push({ sku: target.sku, reason: "No reserve stock to replenish from" });
  }
  if (plans.length === 0) return { jobId: null, taskCount: 0, skipped };
  const start = (input.now ?? new Date()).getTime() + HOUR_MS;
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: next(tx, "job"), warehouseId: input.warehouseId, clientId: null, jobType: jobType.code, jobTypeId: jobType.id,
    operationType: "Replenishment", status: "Pending", priority: input.priority ?? "None", assignedToUserId: input.assigneeUserId ?? null,
    waveId: input.waveId ?? null, waveNumber: input.waveNo ?? null, ruleName: input.ruleName ?? null, waveRuleId: input.waveRuleId ?? null,
    plannedStartAt: new Date(start).toISOString(), plannedEndAt: new Date(start + HOUR_MS).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = nextTaskNo(tx);
  const phase = settings.flow === "Direct Put" ? "Direct Put" : "Replenishment Pick Phase";
  plans.forEach((p, i) => {
    tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: input.warehouseId, clientId: p.source.clientId, taskType: "Replenishment", status: "Pending",
      priority: input.priority ?? "None", sequence: i + 1, productId: p.productId, packType: p.source.packType, plannedQty: p.qty,
      sourceLocationId: p.source.locationId, sourceLpId: p.source.lpId, targetLocationId: p.target, lotNumber: p.source.lotNumber,
      expiryDate: p.source.expiryDate, productionDate: p.source.productionDate, replenishmentPhase: phase, assigneeUserId: input.assigneeUserId ?? null,
      plannedStartAt: new Date(start).toISOString(), plannedFinishAt: new Date(start + (i + 1) * MINUTE_MS).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
    }).run();
  });
  rollupJob(tx, ctx, job.id);
  return { jobId: job.id, taskCount: plans.length, skipped };
}

function sourceBucket(tx: Tx, task: TaskRow): InventoryRow {
  if (!task.productId || !task.sourceLocationId) throw new DomainError("INVALID_STATE", `Replenishment task ${task.taskNo} has no source.`);
  const rows = tx.select().from(schema.inventory).where(and(
    eq(schema.inventory.productId, task.productId), eq(schema.inventory.locationId, task.sourceLocationId), eq(schema.inventory.status, "Stock"),
    task.sourceLpId ? eq(schema.inventory.lpId, task.sourceLpId) : sql`${schema.inventory.lpId} IS NULL`,
    task.lotNumber ? eq(schema.inventory.lotNumber, task.lotNumber) : sql`1 = 1`,
  )).all().filter((b) => freeQty(b) > 0).sort((a, b) => freeQty(b) - freeQty(a));
  const bucket = rows[0];
  if (!bucket) throw new DomainError("INSUFFICIENT_STOCK", `No free stock left at the source of replenishment task ${task.taskNo}.`);
  return bucket;
}

export const executeReplenishment: TaskHandler = (tx, ctx, task, input): TaskExecution => {
  assertExecutable(task);
  const remaining = task.plannedQty - task.actualQty;
  const bucket = sourceBucket(tx, task);
  const qty = input.qty ?? Math.min(remaining, freeQty(bucket));
  assertQty(qty, Math.min(remaining, freeQty(bucket)), "Replenished");
  const target = getLocation(tx, input.targetLocationId);
  const lpSwap = Boolean(task.sourceLpId && input.targetLpId === undefined && qty === bucket.onHand && task.replenishmentPhase !== "Replenishment Pick Phase");
  const toPackType = task.toPackType && task.toPackType !== task.packType ? task.toPackType : undefined;
  if (qty > 0) {
    move(tx, ctx, {
      inventoryId: bucket.id, qty, toLocationId: target.id, toLpId: lpSwap ? bucket.lpId : input.targetLpId ?? null, toPackType,
      type: "Replenishment", refs: { jobId: task.jobId, taskId: task.id },
    });
  }
  completeTask(tx, ctx, task, { doneQty: qty, targetLocationId: target.id, targetLpId: input.targetLpId ?? null });
  tx.update(schema.tasks).set({ lpSwap, packTypeConversionApplied: Boolean(toPackType) }).where(eq(schema.tasks.id, task.id)).run();
  if (task.replenishmentPhase === "Replenishment Pick Phase" && qty > 0 && task.targetLocationId && task.targetLocationId !== target.id) {
    tx.insert(schema.tasks).values({
      taskNo: nextTaskNo(tx), jobId: task.jobId, warehouseId: task.warehouseId, clientId: task.clientId, taskType: "Replenishment", status: "Pending",
      priority: task.priority, sequence: task.sequence, productId: task.productId, packType: toPackType ?? task.packType, plannedQty: qty,
      sourceLocationId: target.id, sourceLpId: input.targetLpId ?? null, targetLocationId: task.targetLocationId, lotNumber: task.lotNumber,
      expiryDate: task.expiryDate, productionDate: task.productionDate, replenishmentPhase: "Replenishment Put Phase", assigneeUserId: task.assigneeUserId,
      plannedStartAt: task.plannedStartAt, plannedFinishAt: task.plannedFinishAt, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).run();
  }
  return { taskId: task.id, doneQty: qty, shortQty: Math.max(0, remaining - qty), resolutionJobId: null };
};

/** Cancels the open replenishment tasks of a job set (used by Delete-if-not-started). */
export function openReplenishmentTaskIds(tx: Tx, jobIds: readonly string[]): string[] {
  if (jobIds.length === 0) return [];
  return tx.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(inArray(schema.tasks.jobId, [...jobIds]), eq(schema.tasks.taskType, "Replenishment"), ne(schema.tasks.status, "Completed"))).all().map((r) => r.id);
}
