/**
 * Web Count Sheet and Quick Count / Instant Count (M07). Both execute Count tasks through
 * `tasks.execute`, so the count task handler records the entries and rolls the plan up.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import { changeLog, sequences, tasks } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import { expectedBuckets, getCountLine, getCountPlanRow, movePlan, moveLine, rollupCountPlan, type CountTaskInput } from "@/server/domain/task-handlers/count";
import { nowIso, type DomainCtx, type Tx } from "@/server/domain/types";
import { defaultCountJobType, insertCountJob } from "./counts-jobs";
import { postCountLine } from "./counts-ops";

const entrySchema = z.object({
  inventoryId: z.string().min(1).max(64).nullish(),
  productId: z.string().min(1).max(64).nullish(),
  lotNumber: z.string().trim().max(60).nullish(),
  expiryDate: z.string().trim().max(30).nullish(),
  lpId: z.string().min(1).max(64).nullish(),
  countedQty: z.number({ error: "Enter the counted quantity" }).int("Whole numbers only").min(0, "Can't be negative").max(10_000_000),
});

export const sheetSubmitSchema = z.object({
  lineId: z.string().min(1).max(64),
  locationId: z.string().min(1).max(64).nullish(),
  entries: z.array(entrySchema).max(500),
  note: z.string().trim().max(400).nullish(),
});

export const instantCountSchema = z.object({
  warehouseId: z.string().min(1, "Choose a warehouse").max(64),
  locationId: z.string().min(1, "Scan a location").max(64),
  entries: z.array(entrySchema).max(500),
  note: z.string().trim().max(400).nullish(),
  updateInventory: z.boolean().default(true),
  reasonId: z.string().min(1).max(64).nullish(),
});

export interface SheetBucket {
  readonly inventoryId: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly lpNumber: string | null;
  readonly packType: string;
  readonly systemQty: number;
  readonly allocated: number;
}

export interface SheetLine {
  readonly lineId: string;
  readonly taskId: string | null;
  readonly taskNo: number | null;
  readonly jobCode: string | null;
  readonly status: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly locationBarcode: string | null;
  readonly productId: string | null;
  readonly sku: string | null;
  readonly isRecountLine: boolean;
  readonly buckets: readonly SheetBucket[];
}

function bucketsFor(db: AppDb, line: { productId: string | null; lpId: string | null }, locationId: string | null): SheetBucket[] {
  const rows = expectedBuckets(db, line, locationId);
  if (rows.length === 0) return [];
  const products = new Map(db.select().from(schema.products).where(inArray(schema.products.id, [...new Set(rows.map((r) => r.productId))])).all().map((p) => [p.id, p]));
  const lpIds = rows.flatMap((r) => (r.lpId ? [r.lpId] : []));
  const lps = new Map(lpIds.length ? db.select().from(schema.licensePlates).where(inArray(schema.licensePlates.id, lpIds)).all().map((l) => [l.id, l.number]) : []);
  return rows.map((r) => ({
    inventoryId: r.id, productId: r.productId, sku: products.get(r.productId)?.sku ?? "—", productName: products.get(r.productId)?.name ?? "",
    lotNumber: r.lotNumber, expiryDate: r.expiryDate, lpNumber: r.lpId ? (lps.get(r.lpId) ?? null) : null, packType: r.packType, systemQty: r.onHand, allocated: r.allocated,
  }));
}

/** Countable lines of a plan (Ready To Count / Count Started) with their expected stock. */
export function countSheet(db: AppDb, scope: Scope, planId: string): SheetLine[] {
  const plan = getCountPlanRow(db, planId);
  if (!hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count plan");
  const rows = db.all<{ lineId: string; status: string; locationId: string | null; productId: string | null; lpId: string | null; isRecountLine: number; locationCode: string | null; locationBarcode: string | null; sku: string | null; taskId: string | null; taskNo: number | null; jobCode: string | null }>(sql`
    SELECT l.id AS lineId, l.status, l.location_id AS locationId, l.product_id AS productId, l.lp_id AS lpId, l.is_recount_line AS isRecountLine,
      lo.code AS locationCode, lo.barcode AS locationBarcode, pr.sku, t.id AS taskId, t.task_no AS taskNo, j.code AS jobCode
    FROM count_plan_lines l LEFT JOIN locations lo ON lo.id = l.location_id LEFT JOIN products pr ON pr.id = l.product_id
    LEFT JOIN tasks t ON t.count_line_id = l.id AND t.status = 'Pending' LEFT JOIN jobs j ON j.id = t.job_id
    WHERE l.plan_id = ${planId} AND l.status IN ('Ready To Count', 'Count Started')
    ORDER BY lo.walking_path_priority, lo.code, pr.sku`);
  return rows.map((r) => ({
    lineId: r.lineId, taskId: r.taskId, taskNo: r.taskNo, jobCode: r.jobCode, status: r.status, locationId: r.locationId, locationCode: r.locationCode,
    locationBarcode: r.locationBarcode, productId: r.productId, sku: r.sku, isRecountLine: r.isRecountLine === 1,
    buckets: bucketsFor(db, r, r.locationId),
  }));
}

/** Submits one line of the Count Sheet: executes its Count task with the per-bucket counts. */
export function submitSheetLine(tx: Tx, ctx: DomainCtx, auth: AuthContext, planId: string, input: z.output<typeof sheetSubmitSchema>): { lineId: string; status: string } {
  const plan = getCountPlanRow(tx, planId);
  if (!hasWarehouse(auth.scope, plan.warehouseId)) throw notFoundError("Count plan");
  const line = getCountLine(tx, input.lineId);
  if (line.planId !== plan.id) throw notFoundError("Count line");
  const task = tx.select().from(schema.tasks).where(and(eq(schema.tasks.countLineId, line.id), eq(schema.tasks.status, "Pending"))).get();
  if (!task) throw new DomainError("INVALID_STATE", line.status === "Pending" ? "Create a job for this count plan before counting" : `This line is ${line.status.toLowerCase()}`);
  const locationId = line.locationId ?? input.locationId;
  if (!locationId) throw new DomainError("VALIDATION", "Scan the location you counted");
  const execInput: CountTaskInput & { taskIds: string[] } = { taskIds: [task.id], targetLocationId: locationId, countEntries: input.entries, note: input.note ?? null };
  tasks.execute(tx, ctx, execInput);
  const after = getCountLine(tx, line.id);
  return { lineId: after.id, status: after.status };
}

/* ------------------------------------------------------------ instant count */
export interface InstantLocation {
  readonly locationId: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly buckets: readonly SheetBucket[];
  readonly openCount: string | null;
}

/** Resolves a scanned location code / barcode for Quick Count. */
export function instantLocation(db: AppDb, scope: Scope, warehouseId: string, code: string): InstantLocation {
  if (!hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const loc = db.select().from(schema.locations)
    .where(and(eq(schema.locations.warehouseId, warehouseId), sql`(lower(${schema.locations.code}) = lower(${code}) OR lower(${schema.locations.barcode}) = lower(${code}))`)).get();
  if (!loc) throw new DomainError("NOT_FOUND", `Location ${code} was not found in this warehouse`);
  const open = db.get<{ code: string }>(sql`
    SELECT p.code FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id
    WHERE l.location_id = ${loc.id} AND l.status IN ('Ready To Count', 'Count Started') AND p.status IN ('Ready To Count', 'Count Started') LIMIT 1`);
  return { locationId: loc.id, code: loc.code, warehouseId, buckets: bucketsFor(db, { productId: null, lpId: null }, loc.id), openCount: open?.code ?? null };
}

export interface InstantResult {
  readonly planId: string;
  readonly code: string;
  readonly status: string;
  readonly varianceLines: number;
}

export function createInstantCount(tx: Tx, ctx: DomainCtx, auth: AuthContext, input: z.output<typeof instantCountSchema>, canUpdateInventory: boolean): InstantResult {
  if (!hasWarehouse(auth.scope, input.warehouseId)) throw notFoundError("Warehouse");
  const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId)).get();
  if (!loc || loc.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "Scan a location in the selected warehouse");
  if (input.updateInventory && !canUpdateInventory) throw new DomainError("FORBIDDEN", "You can't update inventory from a count");
  const jobType = defaultCountJobType(tx, input.warehouseId, true);
  const stock = tx.get<{ n: number | null }>(sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${loc.id} AND on_hand > 0`)?.n ?? 0;
  const plan = tx.insert(schema.countPlans).values({
    code: sequences.instantCountCode(), warehouseId: input.warehouseId, description: input.note?.trim() || `Instant count of ${loc.code}`,
    scheduledAt: nowIso(), lockLocations: false, countType: "Location", operationType: "Instant Count", status: "Pending", createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code });
  const line = tx.insert(schema.countPlanLines).values({ planId: plan.id, locationId: loc.id, status: "Pending", initialStockQty: stock, createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get();
  const jobId = insertCountJob(tx, ctx, jobType, plan, [line], ctx.userId);
  moveLine(tx, ctx, line, "Ready To Count", { jobId });
  movePlan(tx, ctx, getCountPlanRow(tx, plan.id), "Ready To Count");
  const task = tx.select().from(schema.tasks).where(eq(schema.tasks.countLineId, line.id)).get();
  if (!task) throw new DomainError("INVALID_STATE", "The count task could not be created");
  const execInput: CountTaskInput & { taskIds: string[] } = { taskIds: [task.id], targetLocationId: loc.id, countEntries: input.entries, note: input.note ?? null };
  tasks.execute(tx, ctx, execInput);

  let counted = getCountLine(tx, line.id);
  const entries = tx.select().from(schema.countLineEntries).where(eq(schema.countLineEntries.lineId, line.id)).all();
  const hasVariance = entries.some((e) => e.countedQty !== e.systemQty);
  if (counted.status === "Count Completed" && (!hasVariance || input.updateInventory)) {
    if (hasVariance) postCountLine(tx, ctx, counted, getCountPlanRow(tx, plan.id), input.reasonId ?? null, input.note);
    else counted = moveLine(tx, ctx, counted, "Inventory Updated", { inventoryUpdatedAt: nowIso(), inventoryUpdatedBy: ctx.userId });
    rollupCountPlan(tx, ctx, plan.id);
  }
  const final = getCountPlanRow(tx, plan.id);
  return { planId: final.id, code: final.code, status: final.status, varianceLines: hasVariance ? 1 : 0 };
}

/** Product search for "Add found stock" (products of the warehouse's clients in scope). */
export function stockedProducts(db: AppDb, locationId: string): string[] {
  return db.select({ id: schema.inventory.productId }).from(schema.inventory).where(and(eq(schema.inventory.locationId, locationId), gt(schema.inventory.onHand, 0))).all().map((r) => r.id);
}
