/**
 * Count task handler (M07, replaces the 0.6 stub; exports the count lifecycle helpers). `tasks.execute()` dispatches every
 * `Count` task here. One task = one count line (a location, or a SKU in a location).
 *
 * - Records one `count_line_entries` row per bucket counted (SKU / lot / expiry / LP).
 *   Expected stock that was not entered counts as 0 (a missing bucket is a variance).
 * - Moves the line to Count Completed (through the count-line state machine) and rolls the
 *   plan up (Ready To Count → Count Started → Count Completed / Inventory Updated).
 * - When the job type has "Auto-Update No-Difference Lines", a line with no variance goes
 *   straight to Inventory Updated (nothing to post to the ledger).
 *
 * Per-bucket quantities travel as `countEntries` on the execute input (the web Count
 * Sheet and Quick Count send them). Callers that only send `qty` (mobile) work when the
 * line has at most one bucket.
 *
 * The lifecycle helpers below are exported for the counts repositories; this file imports
 * only leaf domain modules so the task-handler registry has no import cycle.
 */
import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { jobTypeSettingsSchema, parseSettings } from "@/lib/domain-types";
import type { CountLineStatus, CountPlanStatus } from "@/lib/enums";
import { impliedPlanStatus } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import { recordLine, recordUpdate } from "../change-log";
import { DomainError } from "../errors";
import { stateMachines } from "../state-machines";
import { nowIso, type DomainCtx, type Tx } from "../types";
import { assertExecutable, completeTask } from "./shared";
import type { TaskExecuteInput, TaskHandler } from "./types";

export type CountPlanRow = typeof schema.countPlans.$inferSelect;
export type CountLineRow = typeof schema.countPlanLines.$inferSelect;
type InventoryRow = typeof schema.inventory.$inferSelect;

/** One counted bucket. `inventoryId` = an expected bucket; otherwise stock found by the counter. */
export interface CountEntryInput {
  readonly inventoryId?: string | null;
  readonly productId?: string | null;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly lpId?: string | null;
  readonly packType?: string | null;
  /** Counted units that are damaged: recorded against (and posted to) a damaged bucket with this reason. */
  readonly damageReason?: string | null;
  readonly countedQty: number;
}

export interface CountTaskInput extends TaskExecuteInput {
  readonly countEntries?: readonly CountEntryInput[];
}

/* ------------------------------------------------------------------ reads */
export function getCountLine(tx: Tx, lineId: string): CountLineRow {
  const line = tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.id, lineId)).get();
  if (!line) throw new DomainError("NOT_FOUND", "Count line not found");
  return line;
}

export function getCountPlanRow(tx: Tx, planId: string): CountPlanRow {
  const plan = tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, planId)).get();
  if (!plan) throw new DomainError("NOT_FOUND", "Count plan not found");
  return plan;
}

/** Stock the line is expected to find: buckets at its location (only its SKU / LP for SKU / LP lines). */
export function expectedBuckets(tx: Tx, line: Pick<CountLineRow, "productId" | "lpId">, locationId: string | null): InventoryRow[] {
  if (!locationId) return [];
  const i = schema.inventory;
  const conds: SQL[] = [eq(i.locationId, locationId), gt(i.onHand, 0)];
  if (line.productId) conds.push(eq(i.productId, line.productId));
  if (line.lpId) conds.push(eq(i.lpId, line.lpId));
  return tx.select().from(i).where(and(...conds)).orderBy(i.productId, i.lotNumber).all();
}

const nullEq = (col: SQLiteColumn, value: string | null): SQL => (value === null ? isNull(col) : eq(col, value));

/** The bucket a counted entry belongs to (same product / location / LP / lot / expiry / pack, not damaged). */
export function findEntryBucket(tx: Tx, e: { productId: string; locationId: string; lpId: string | null; lotNumber: string | null; expiryDate: string | null; packType: string; damageReason?: string | null }): InventoryRow | undefined {
  const i = schema.inventory;
  return tx.select().from(i).where(and(
    eq(i.productId, e.productId), eq(i.locationId, e.locationId), nullEq(i.lpId, e.lpId), nullEq(i.lotNumber, e.lotNumber),
    nullEq(i.expiryDate, e.expiryDate), eq(i.packType, e.packType), nullEq(i.damageReason, e.damageReason ?? null),
  )).get();
}

/* ------------------------------------------------------------- lifecycle */
/**
 * REQ-16: when a recount line is cancelled (line cancel or its job cancelled), the original line it
 * superseded goes back from Recount Created to Count Completed, keeping its counted result.
 */
export function restoreRecountOriginal(tx: Tx, ctx: DomainCtx, recountLine: CountLineRow): CountLineRow | null {
  if (!recountLine.isRecountLine || !recountLine.recountOfLineId) return null;
  const original = tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.id, recountLine.recountOfLineId)).get();
  if (!original || original.status !== "Recount Created") return null;
  return moveLine(tx, ctx, original, "Count Completed");
}

/** Moves a line along the count-line machine (multi-step paths allowed) and logs it on the plan. */
export function moveLine(tx: Tx, ctx: DomainCtx, line: CountLineRow, to: CountLineStatus, patch: Partial<typeof schema.countPlanLines.$inferInsert> = {}): CountLineRow {
  let status = line.status;
  if (status !== to) {
    const path = stateMachines.countLine.path(status, to);
    if (!path) stateMachines.countLine.transition(status, to);
    for (const step of path ?? []) status = stateMachines.countLine.transition(status, step);
  }
  const updated = tx.update(schema.countPlanLines).set({ ...patch, status, updatedBy: ctx.userId, version: sql`${schema.countPlanLines.version} + 1` })
    .where(eq(schema.countPlanLines.id, line.id)).returning().get();
  const plan = getCountPlanRow(tx, line.planId);
  recordLine(tx, ctx, {
    entityType: "count_plan", entityId: plan.id, entityCode: plan.code, lineEntityType: "count_line", lineEntityId: line.id,
    lineLabel: lineLabel(tx, line), field: "status", from: line.status, to: status,
  });
  return updated;
}

/** "A-01-01-1" / "MLT-WIDGET-01 @ A-01-01-1" for change-log lines. */
export function lineLabel(tx: Tx, line: Pick<CountLineRow, "locationId" | "productId" | "isRecountLine">): string {
  const loc = line.locationId ? tx.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, line.locationId)).get()?.code : null;
  const sku = line.productId ? tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, line.productId)).get()?.sku : null;
  const base = sku ? (loc ? `${sku} @ ${loc}` : sku) : (loc ?? "Line");
  return line.isRecountLine ? `${base} (recount)` : base;
}

/** Re-derives the plan status from its lines and stamps started / completed / updated times. */
export function rollupCountPlan(tx: Tx, ctx: DomainCtx, planId: string): CountPlanRow {
  const plan = getCountPlanRow(tx, planId);
  const lines = tx.select({ status: schema.countPlanLines.status }).from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, planId)).all();
  const target = impliedPlanStatus(plan.status, lines.map((l) => l.status));
  if (!target || target === plan.status) return plan;
  return movePlan(tx, ctx, plan, target);
}

export function movePlan(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, to: CountPlanStatus): CountPlanRow {
  const path = stateMachines.countPlan.path(plan.status, to);
  if (!path) stateMachines.countPlan.transition(plan.status, to);
  let status = plan.status;
  const now = nowIso();
  const patch: Partial<typeof schema.countPlans.$inferInsert> = {};
  for (const step of path ?? []) {
    status = stateMachines.countPlan.transition(status, step);
    if (step === "Count Started" && !plan.startedAt) patch.startedAt = now;
    if (step === "Count Completed") patch.completedAt = now;
    if (step === "Inventory Updated") { patch.inventoryUpdatedAt = now; patch.inventoryUpdatedBy = ctx.userId; }
  }
  const updated = tx.update(schema.countPlans).set({ ...patch, status, updatedBy: ctx.userId, version: sql`${schema.countPlans.version} + 1` })
    .where(eq(schema.countPlans.id, plan.id)).returning().get();
  recordUpdate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code, before: { status: plan.status }, after: { status } });
  return updated;
}

/** Job-type "Auto-Update No-Difference Lines" for the job that holds the task. */
export function autoUpdatesNoDifference(tx: Tx, jobId: string | null): boolean {
  if (!jobId) return false;
  const row = tx.select({ settings: schema.jobTypes.settings }).from(schema.jobs)
    .innerJoin(schema.jobTypes, eq(schema.jobTypes.id, schema.jobs.jobTypeId)).where(eq(schema.jobs.id, jobId)).get();
  if (!row) return false;
  return parseSettings(jobTypeSettingsSchema, row.settings).count.autoUpdateNoDifferenceLines;
}

/**
 * Job-type "Blind Count": counters never see the system quantity. Read from the stored settings JSON
 * (`count.blindCount`) so it works as soon as the job type carries the flag (REQ-9 adds it to
 * `jobTypeSettingsSchema` and the Job Types settings page).
 */
export function isBlindCountJob(tx: Tx, jobId: string | null): boolean {
  if (!jobId) return false;
  const row = tx.select({ settings: schema.jobTypes.settings }).from(schema.jobs)
    .innerJoin(schema.jobTypes, eq(schema.jobTypes.id, schema.jobs.jobTypeId)).where(eq(schema.jobs.id, jobId)).get();
  const count = (row?.settings as { count?: { blindCount?: unknown } } | null | undefined)?.count;
  return count?.blindCount === true;
}

/* ---------------------------------------------------------------- entries */
interface ResolvedEntry {
  readonly productId: string;
  readonly lpId: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly damageReason: string | null;
  readonly packType: string;
  readonly systemQty: number;
  readonly countedQty: number;
}

const bucketKey = (e: Pick<ResolvedEntry, "productId" | "lpId" | "lotNumber" | "expiryDate" | "packType" | "damageReason">): string =>
  [e.productId, e.lpId ?? "", e.lotNumber ?? "", e.expiryDate ?? "", e.packType, e.damageReason ?? ""].join("|");

function assertCountQty(qty: number): void {
  if (!Number.isInteger(qty) || qty < 0) throw new DomainError("VALIDATION", "Counted quantity must be zero or a positive whole number");
}

function fromBucket(b: InventoryRow, countedQty: number): ResolvedEntry {
  return { productId: b.productId, lpId: b.lpId, lotNumber: b.lotNumber, expiryDate: b.expiryDate, damageReason: b.damageReason, packType: b.packType, systemQty: b.onHand, countedQty };
}

function resolveEntry(tx: Tx, line: CountLineRow, locationId: string, e: CountEntryInput): ResolvedEntry {
  assertCountQty(e.countedQty);
  if (e.inventoryId) {
    const b = tx.select().from(schema.inventory).where(eq(schema.inventory.id, e.inventoryId)).get();
    if (!b || b.locationId !== locationId) throw new DomainError("VALIDATION", "A counted bucket is not in this location");
    if (line.productId && b.productId !== line.productId) throw new DomainError("VALIDATION", "A counted bucket belongs to another SKU");
    return fromBucket(b, e.countedQty);
  }
  const productId = e.productId ?? line.productId;
  if (!productId) throw new DomainError("VALIDATION", "Choose the SKU you counted");
  if (line.productId && productId !== line.productId) throw new DomainError("VALIDATION", "This line only counts its own SKU");
  const product = tx.select().from(schema.products).where(eq(schema.products.id, productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const spec = { productId, locationId, lpId: e.lpId ?? line.lpId ?? null, lotNumber: e.lotNumber?.trim() || null, expiryDate: e.expiryDate || null, packType: e.packType || product.uom, damageReason: e.damageReason?.trim() || null };
  const existing = findEntryBucket(tx, spec);
  return { ...spec, systemQty: existing?.onHand ?? 0, countedQty: e.countedQty };
}

/** Builds the full entry set for a line: entered rows + expected buckets not entered (counted 0). */
export function resolveCountEntries(tx: Tx, line: CountLineRow, locationId: string, input: CountTaskInput): ResolvedEntry[] {
  const expected = expectedBuckets(tx, line, locationId);
  let entered: ResolvedEntry[];
  if (input.countEntries && input.countEntries.length > 0) {
    entered = input.countEntries.map((e) => resolveEntry(tx, line, locationId, e));
  } else {
    const qty = input.qty ?? 0;
    assertCountQty(qty);
    if (expected.length > 1) throw new DomainError("VALIDATION", "This location holds several SKUs or lots; enter the counted quantity for each one");
    if (expected.length === 1) entered = [fromBucket(expected[0] as InventoryRow, qty)];
    else if (line.productId) entered = [resolveEntry(tx, line, locationId, { productId: line.productId, countedQty: qty })];
    else if (qty > 0) throw new DomainError("VALIDATION", "Choose the SKU you found in this location");
    else entered = [];
  }
  const seen = new Set<string>();
  for (const e of entered) {
    const key = bucketKey(e);
    if (seen.has(key)) throw new DomainError("VALIDATION", "The same SKU and lot was entered twice; combine the quantities");
    seen.add(key);
  }
  const missing = expected.filter((b) => !seen.has(bucketKey(fromBucket(b, 0)))).map((b) => fromBucket(b, 0));
  return [...entered, ...missing];
}

/* ---------------------------------------------------------------- handler */
export const executeCount: TaskHandler = (tx, ctx, task, input) => {
  assertExecutable(task);
  if (!task.countLineId) throw new DomainError("VALIDATION", `Task ${task.taskNo} is not linked to a count line.`);
  const line = getCountLine(tx, task.countLineId);
  if (line.status !== "Ready To Count" && line.status !== "Count Started") {
    throw new DomainError("INVALID_STATE", `This count line is ${line.status.toLowerCase()}.`);
  }
  const plan = getCountPlanRow(tx, line.planId);
  if (plan.status === "Cancelled" || plan.status === "Inventory Updated") throw new DomainError("INVALID_STATE", `Count plan ${plan.code} is ${plan.status.toLowerCase()}.`);
  const locationId = line.locationId ?? input.targetLocationId;
  const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc || loc.warehouseId !== plan.warehouseId) throw new DomainError("VALIDATION", "Count in a location of the plan's warehouse");

  const entries = resolveCountEntries(tx, line, locationId, input as CountTaskInput);
  const now = nowIso();
  for (const e of entries) {
    tx.insert(schema.countLineEntries).values({ lineId: line.id, locationId, ...e, countedBy: ctx.source, countedAt: now }).run();
  }
  const counted = entries.reduce((s, e) => s + e.countedQty, 0);
  const system = entries.reduce((s, e) => s + e.systemQty, 0);
  // The first counted task starts the job, so a one-task job shows Actual Start as well as Actual Finish
  // (the job rollup only stamps started_at on Pending → Started, not on Pending → Completed).
  if (task.jobId) tx.update(schema.jobs).set({ startedAt: now }).where(and(eq(schema.jobs.id, task.jobId), isNull(schema.jobs.startedAt))).run();
  completeTask(tx, ctx, task, { doneQty: counted, targetLocationId: locationId });

  let updated = moveLine(tx, ctx, line, "Count Completed", {
    locationId, countedQty: counted, approvedStockQty: system, approvedCountQty: counted, countUserId: ctx.userId,
    startedAt: line.startedAt ?? now, completedAt: now, note: input.note?.trim() || line.note,
  });
  const noDifference = entries.every((e) => e.countedQty === e.systemQty);
  if (noDifference && autoUpdatesNoDifference(tx, task.jobId)) {
    updated = moveLine(tx, ctx, updated, "Inventory Updated", { inventoryUpdatedAt: now, inventoryUpdatedBy: ctx.userId });
  }
  rollupCountPlan(tx, ctx, plan.id);
  return { taskId: task.id, doneQty: counted, shortQty: 0 };
};
