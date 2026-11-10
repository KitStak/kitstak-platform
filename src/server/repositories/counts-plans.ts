/**
 * Count plans (M07): list, detail, create / edit (Pending only), delete, next code.
 * Plans and lines are M07-owned tables (C1); every write logs change_log.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { AppError, conflictError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, hasWarehouse, type Scope } from "@/server/auth/scope";
import { changeLog, sequences } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx, Tx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { planDeleteReason, planEditReason } from "@/lib/grid-defs/counts/count-math";
import { gridRowsById, raw, runGrid, type GridPage } from "./counts-grid";
import { lineGrid, lineRow, planGrid, planRow, type CountLineListRow, type CountPlanListRow } from "./counts-grids";

export const COUNT_NAME_MAX = 50;
export const COUNT_DESCRIPTION_MAX = 400;
export const MAX_PLAN_LINES = 2000;

const idList = z.array(z.string().trim().min(1).max(64)).max(MAX_PLAN_LINES, `At most ${MAX_PLAN_LINES} lines per plan`);

export const countPlanInputSchema = z.object({
  code: z.string().trim().min(1, "Name is required").max(COUNT_NAME_MAX, `Use at most ${COUNT_NAME_MAX} characters`),
  warehouseId: z.string().trim().min(1, "Warehouse is required").max(64),
  description: z.string().trim().max(COUNT_DESCRIPTION_MAX, `Use at most ${COUNT_DESCRIPTION_MAX} characters`).nullish(),
  scheduledAt: z.string().trim().min(1, "Scheduled count date is required").refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time"),
  lockLocations: z.boolean().default(false),
  countType: z.enum(["Location", "SKU"]),
  locationIds: idList.default([]),
  productIds: idList.default([]),
}).superRefine((v, ctx) => {
  const n = v.countType === "Location" ? v.locationIds.length : v.productIds.length;
  if (n === 0) ctx.addIssue({ code: "custom", path: [v.countType === "Location" ? "locationIds" : "productIds"], message: `Add at least one ${v.countType === "Location" ? "location" : "product"}` });
});
export type CountPlanInput = z.output<typeof countPlanInputSchema>;

export const countPlanUpdateSchema = z.object({ version: z.number().int().min(1) }).and(countPlanInputSchema);

/* ------------------------------------------------------------------ reads */
export function listCountPlans(db: AppDb, scope: Scope, query: GridQuery): GridPage<CountPlanListRow> {
  const page = runGrid<CountPlanListRow>(db, planGrid(scope), query);
  return { ...page, rows: page.rows.map(planRow) };
}

export function countPlansById(db: AppDb, scope: Scope, ids: readonly string[]): CountPlanListRow[] {
  return gridRowsById<CountPlanListRow>(db, planGrid(scope), raw("p.id"), ids).map(planRow);
}

export function getCountPlanSummary(db: AppDb, scope: Scope, id: string): CountPlanListRow {
  const row = countPlansById(db, scope, [id])[0];
  if (!row) throw notFoundError("Count plan");
  return row;
}

export interface CountEntryRow {
  readonly id: string;
  readonly lineId: string;
  readonly sku: string;
  readonly productName: string;
  readonly locationCode: string;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly packType: string;
  readonly systemQty: number;
  readonly countedQty: number;
  readonly countedBy: string | null;
  readonly countedAt: string;
}

export interface CountJobRow {
  readonly id: string;
  readonly code: string;
  readonly jobType: string;
  readonly status: string;
  readonly assigneeName: string | null;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly createdAt: string;
}

export interface CountPlanDetail {
  readonly plan: CountPlanListRow;
  readonly lines: readonly CountLineListRow[];
  readonly entries: readonly CountEntryRow[];
  readonly jobs: readonly CountJobRow[];
  readonly mandatoryCountReason: boolean;
  /** Ids for the edit wizard (Pending plans). */
  readonly locationIds: readonly string[];
  readonly productIds: readonly string[];
}

/** `:id` accepts the plan id or its code (deep links use the code). */
export function resolvePlanId(db: AppDb, scope: Scope, idOrCode: string): string {
  const p = db.select({ id: schema.countPlans.id, warehouseId: schema.countPlans.warehouseId }).from(schema.countPlans)
    .where(sql`${schema.countPlans.id} = ${idOrCode} OR ${schema.countPlans.code} = ${idOrCode}`).all()
    .find((r) => hasWarehouse(scope, r.warehouseId));
  if (!p) throw notFoundError("Count plan");
  return p.id;
}

export function getCountPlanDetail(db: AppDb, scope: Scope, idOrCode: string): CountPlanDetail {
  const id = resolvePlanId(db, scope, idOrCode);
  const plan = getCountPlanSummary(db, scope, id);
  const lines = linesOfPlan(db, scope, id);
  const entries = db.all<CountEntryRow>(sql`
    SELECT e.id, e.line_id AS lineId, pr.sku, pr.name AS productName, lo.code AS locationCode, lp.number AS lpNumber, e.lot_number AS lotNumber,
      e.expiry_date AS expiryDate, e.pack_type AS packType, e.system_qty AS systemQty, e.counted_qty AS countedQty, e.counted_by AS countedBy, e.counted_at AS countedAt
    FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN products pr ON pr.id = e.product_id
    JOIN locations lo ON lo.id = e.location_id LEFT JOIN license_plates lp ON lp.id = e.lp_id
    WHERE l.plan_id = ${id} ORDER BY lo.code, pr.sku, e.lot_number`);
  const jobs = db.all<CountJobRow>(sql`
    SELECT j.id, j.code, j.job_type AS jobType, j.status, u.name AS assigneeName, j.task_count AS taskCount, j.completed_task_count AS completedTaskCount, j.created_at AS createdAt
    FROM jobs j LEFT JOIN users u ON u.id = j.assigned_to_user_id WHERE j.count_plan_id = ${id} ORDER BY j.created_at, j.code`);
  const wh = db.select({ m: schema.warehouses.mandatoryCountReason }).from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).get();
  const ids = db.select({ locationId: schema.countPlanLines.locationId, productId: schema.countPlanLines.productId }).from(schema.countPlanLines)
    .where(eq(schema.countPlanLines.planId, id)).all();
  return {
    plan, lines, entries, jobs, mandatoryCountReason: Boolean(wh?.m),
    locationIds: [...new Set(ids.flatMap((r) => (r.locationId ? [r.locationId] : [])))],
    productIds: [...new Set(ids.flatMap((r) => (r.productId ? [r.productId] : [])))],
  };
}

export function linesOfPlan(db: AppDb, scope: Scope, planId: string): CountLineListRow[] {
  const spec = lineGrid(scope, "plan", planId);
  return runGrid<CountLineListRow>(db, spec, { qm: "sw", filters: [], sort: [], page: 1, pageSize: MAX_PLAN_LINES * 2 }).rows.map(lineRow);
}

export function nextCountCode(db: AppDb): string {
  return sequences.peek(db, "count");
}

/* ----------------------------------------------------------------- writes */
function assertWarehouse(scope: Scope, warehouseId: string): void {
  if (!hasWarehouse(scope, warehouseId)) throw new AppError("VALIDATION", "Choose a warehouse you have access to", { fieldErrors: { warehouseId: ["Choose a warehouse you have access to"] } });
}

function assertUniqueCode(tx: Tx, warehouseId: string, code: string, exceptId?: string): void {
  const dup = tx.select({ id: schema.countPlans.id }).from(schema.countPlans)
    .where(and(eq(schema.countPlans.warehouseId, warehouseId), sql`lower(${schema.countPlans.code}) = lower(${code})`)).all()
    .find((r) => r.id !== exceptId);
  if (dup) throw new AppError("DUPLICATE", `A count plan named ${code} already exists in this warehouse`, { fieldErrors: { code: ["This name is already used in this warehouse"] } });
}

function stockAt(tx: Tx, locationId: string): number {
  return tx.get<{ n: number | null }>(sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND on_hand > 0`)?.n ?? 0;
}

function stockOf(tx: Tx, productId: string, warehouseId: string): number {
  return tx.get<{ n: number | null }>(sql`SELECT SUM(on_hand) AS n FROM inventory WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND on_hand > 0`)?.n ?? 0;
}

type LineInsert = typeof schema.countPlanLines.$inferInsert;

/** Validated line rows for a plan's locations / products (warehouse + client scope). */
export function buildPlanLines(tx: Tx, scope: Scope, planId: string, input: Pick<CountPlanInput, "countType" | "warehouseId" | "locationIds" | "productIds">, userId: string | null): LineInsert[] {
  if (input.countType === "Location") {
    const ids = [...new Set(input.locationIds)];
    const locs = ids.length ? tx.select().from(schema.locations).where(inArray(schema.locations.id, ids)).all() : [];
    if (locs.length !== ids.length || locs.some((l) => l.warehouseId !== input.warehouseId)) {
      throw new AppError("VALIDATION", "Some locations are not in the selected warehouse", { fieldErrors: { locationIds: ["Some locations are not in the selected warehouse"] } });
    }
    return ids.map((locationId) => ({ planId, locationId, status: "Pending" as const, initialStockQty: stockAt(tx, locationId), createdBy: userId, updatedBy: userId }));
  }
  const ids = [...new Set(input.productIds)];
  const prods = ids.length ? tx.select().from(schema.products).where(inArray(schema.products.id, ids)).all() : [];
  if (prods.length !== ids.length || prods.some((p) => !hasClient(scope, p.clientId))) {
    throw new AppError("VALIDATION", "Some products are not available to you", { fieldErrors: { productIds: ["Some products are not available to you"] } });
  }
  return ids.map((productId) => ({ planId, productId, status: "Pending" as const, initialStockQty: stockOf(tx, productId, input.warehouseId), createdBy: userId, updatedBy: userId }));
}

function consumeCodeIfSuggested(tx: Tx, code: string): void {
  if (code.toUpperCase() === sequences.peek(tx, "count").toUpperCase()) sequences.next(tx, "count");
}

export function createCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, input: CountPlanInput): CountPlanListRow {
  assertWarehouse(auth.scope, input.warehouseId);
  assertUniqueCode(tx, input.warehouseId, input.code);
  consumeCodeIfSuggested(tx, input.code);
  const plan = tx.insert(schema.countPlans).values({
    code: input.code, warehouseId: input.warehouseId, description: input.description || null, scheduledAt: new Date(input.scheduledAt).toISOString(),
    lockLocations: input.lockLocations, countType: input.countType, operationType: "Cycle Count", status: "Pending",
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  const lines = buildPlanLines(tx, auth.scope, plan.id, input, ctx.userId);
  for (const chunk of chunks(lines, 200)) tx.insert(schema.countPlanLines).values(chunk).run();
  changeLog.recordCreate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code });
  return getCountPlanSummary(tx, auth.scope, plan.id);
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function loadOwnPlan(tx: Tx, scope: Scope, id: string): typeof schema.countPlans.$inferSelect {
  const plan = tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
  if (!plan || !hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

export function updateCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string, input: CountPlanInput & { version: number }): CountPlanListRow {
  const plan = loadOwnPlan(tx, auth.scope, id);
  if (plan.version !== input.version) throw conflictError();
  const reason = planEditReason(plan.status);
  if (reason) throw new DomainError("INVALID_STATE", reason);
  assertWarehouse(auth.scope, input.warehouseId);
  if (input.code.toLowerCase() !== plan.code.toLowerCase() || input.warehouseId !== plan.warehouseId) assertUniqueCode(tx, input.warehouseId, input.code, plan.id);
  const before = tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id)).all();
  const updated = tx.update(schema.countPlans).set({
    code: input.code, warehouseId: input.warehouseId, description: input.description || null, scheduledAt: new Date(input.scheduledAt).toISOString(),
    lockLocations: input.lockLocations, countType: input.countType, updatedBy: ctx.userId, version: sql`${schema.countPlans.version} + 1`,
  }).where(and(eq(schema.countPlans.id, id), eq(schema.countPlans.version, input.version))).returning().get();
  if (!updated) throw conflictError();
  const wanted = buildPlanLines(tx, auth.scope, id, input, ctx.userId);
  const keyOf = (l: { locationId?: string | null; productId?: string | null }) => `${l.locationId ?? ""}|${l.productId ?? ""}`;
  const wantedKeys = new Set(wanted.map(keyOf));
  const keep = new Set(before.filter((l) => wantedKeys.has(keyOf(l))).map(keyOf));
  const removed = before.filter((l) => !wantedKeys.has(keyOf(l)));
  if (removed.length) tx.delete(schema.countPlanLines).where(inArray(schema.countPlanLines.id, removed.map((l) => l.id))).run();
  const added = wanted.filter((l) => !keep.has(keyOf(l)));
  for (const chunk of chunks(added, 200)) tx.insert(schema.countPlanLines).values(chunk).run();
  changeLog.recordUpdate(tx, ctx, {
    entityType: "count_plan", entityId: id, entityCode: updated.code,
    before: { code: plan.code, warehouseId: whCode(tx, plan.warehouseId), description: plan.description, scheduledAt: plan.scheduledAt, lockLocations: plan.lockLocations, countType: plan.countType, countLines: before.length },
    after: { code: updated.code, warehouseId: whCode(tx, updated.warehouseId), description: updated.description, scheduledAt: updated.scheduledAt, lockLocations: updated.lockLocations, countType: updated.countType, countLines: wanted.length },
  });
  return getCountPlanSummary(tx, auth.scope, id);
}

function whCode(tx: Tx, id: string): string {
  return tx.select({ code: schema.warehouses.code }).from(schema.warehouses).where(eq(schema.warehouses.id, id)).get()?.code ?? id;
}

export function deleteCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string, version?: number): void {
  const plan = loadOwnPlan(tx, auth.scope, id);
  if (version !== undefined && plan.version !== version) throw conflictError();
  const reason = planDeleteReason(plan.status);
  if (reason) throw new DomainError("INVALID_STATE", reason);
  const jobs = tx.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.countPlanId, id)).get();
  if (jobs) throw new DomainError("INVALID_STATE", "This count plan has jobs; cancel it instead");
  tx.delete(schema.countPlans).where(eq(schema.countPlans.id, id)).run();
  changeLog.recordDelete(tx, ctx, { entityType: "count_plan", entityId: id, entityCode: plan.code });
}

/** Live stock per location for the wizard grid (Location Count) or per product in a warehouse (SKU Count). */
export function stockHints(db: AppDb, warehouseId: string, locationIds: readonly string[], productIds: readonly string[]): { locations: Record<string, number>; products: Record<string, number> } {
  const locations: Record<string, number> = {};
  const products: Record<string, number> = {};
  if (locationIds.length) {
    for (const r of db.select({ id: schema.inventory.locationId, n: sql<number>`SUM(${schema.inventory.onHand})` }).from(schema.inventory)
      .where(and(inArray(schema.inventory.locationId, [...locationIds]), gt(schema.inventory.onHand, 0))).groupBy(schema.inventory.locationId).all()) locations[r.id] = Number(r.n);
  }
  if (productIds.length) {
    for (const r of db.select({ id: schema.inventory.productId, n: sql<number>`SUM(${schema.inventory.onHand})` }).from(schema.inventory)
      .where(and(inArray(schema.inventory.productId, [...productIds]), eq(schema.inventory.warehouseId, warehouseId), gt(schema.inventory.onHand, 0))).groupBy(schema.inventory.productId).all()) products[r.id] = Number(r.n);
  }
  return { locations, products };
}
