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
import * as changeLog from "@/server/domain/change-log";
import * as sequences from "@/server/domain/sequences";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx, Tx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { planDeleteReason, planEditReason, planNameLockedReason } from "@/lib/grid-defs/counts/count-math";
import { assertNoOpenCountConflicts } from "./counts-conflicts";
import { gridRowsById, raw, runGrid, type GridPage } from "./counts-grid";
import { lineGrid, lineRow, planGrid, planRow, type CountLineListRow, type CountPlanListRow } from "./counts-grids";
import { dbAll, dbGet, mapSeq } from "@/server/db/sql";

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
  countType: z.enum(["Location", "SKU", "LP"]),
  locationIds: idList.default([]),
  productIds: idList.default([]),
  /** LP count: the license plates to count (each line = one LP in its current location). */
  lpIds: idList.default([]),
  /** Lines came from Suggest (AI Count Plan): risk-ranked locations / SKUs. Shown as "AI Count Plan = Yes". */
  isAi: z.boolean().default(false),
}).superRefine((v, ctx) => {
  const field = v.countType === "Location" ? "locationIds" : v.countType === "LP" ? "lpIds" : "productIds";
  const noun = v.countType === "Location" ? "location" : v.countType === "LP" ? "license plate" : "product";
  if (v[field].length === 0) ctx.addIssue({ code: "custom", path: [field], message: `Add at least one ${noun}` });
});
export type CountPlanInput = Omit<z.output<typeof countPlanInputSchema>, "lpIds" | "isAi"> & { readonly lpIds?: readonly string[]; readonly isAi?: boolean };

export const countPlanUpdateSchema = z.object({ version: z.number().int().min(1) }).and(countPlanInputSchema);

/* ------------------------------------------------------------------ reads */
export async function listCountPlans(db: AppDb, scope: Scope, query: GridQuery): Promise<GridPage<CountPlanListRow>> {
  const page = await runGrid<CountPlanListRow>(db, planGrid(scope), query);
  return { ...page, rows: page.rows.map(planRow) };
}

export async function countPlansById(db: AppDb, scope: Scope, ids: readonly string[]): Promise<CountPlanListRow[]> {
  return (await gridRowsById<CountPlanListRow>(db, planGrid(scope), raw("p.id"), ids)).map(planRow);
}

export async function getCountPlanSummary(db: AppDb, scope: Scope, id: string): Promise<CountPlanListRow> {
  const row = (await countPlansById(db, scope, [id]))[0];
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
  /** Task rows cancelled with the job or line (not part of taskCount). */
  readonly cancelledTaskCount: number;
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
export async function resolvePlanId(db: AppDb, scope: Scope, idOrCode: string): Promise<string> {
  const p = (await db.select({ id: schema.countPlans.id, warehouseId: schema.countPlans.warehouseId }).from(schema.countPlans)
    .where(sql`${schema.countPlans.id} = ${idOrCode} OR ${schema.countPlans.code} = ${idOrCode}`))
    .find((r) => hasWarehouse(scope, r.warehouseId));
  if (!p) throw notFoundError("Count plan");
  return p.id;
}

export async function getCountPlanDetail(db: AppDb, scope: Scope, idOrCode: string): Promise<CountPlanDetail> {
  const id = await resolvePlanId(db, scope, idOrCode);
  const plan = await getCountPlanSummary(db, scope, id);
  const lines = await linesOfPlan(db, scope, id);
  const entries = await dbAll<CountEntryRow>(db, sql`
    SELECT e.id, e.line_id AS "lineId", pr.sku, pr.name AS "productName", lo.code AS "locationCode", lp.number AS "lpNumber", e.lot_number AS "lotNumber",
      e.expiry_date AS "expiryDate", e.pack_type AS "packType", e.system_qty AS "systemQty", e.counted_qty AS "countedQty",
      COALESCE((SELECT u.name FROM users u WHERE lower(u.email) = lower(e.counted_by)), e.counted_by) AS "countedBy", e.counted_at AS "countedAt"
    FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN products pr ON pr.id = e.product_id
    JOIN locations lo ON lo.id = e.location_id LEFT JOIN license_plates lp ON lp.id = e.lp_id
    WHERE l.plan_id = ${id} ORDER BY lo.code, pr.sku, e.lot_number`);
  const jobs = await dbAll<CountJobRow>(db, sql`
    SELECT j.id, j.code, j.job_type AS "jobType", j.status, u.name AS "assigneeName",
      -- Counters come from the task rows (same rule as rollupJob), so a stale jobs.task_count can never show.
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status <> 'Cancelled') AS "taskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status = 'Completed') AS "completedTaskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.job_id = j.id AND t.status = 'Cancelled') AS "cancelledTaskCount", j.created_at AS "createdAt"
    FROM jobs j LEFT JOIN users u ON u.id = j.assigned_to_user_id WHERE j.count_plan_id = ${id} ORDER BY j.created_at, j.code`);
  const wh = (await db.select({ m: schema.warehouses.mandatoryCountReason }).from(schema.warehouses).where(eq(schema.warehouses.id, plan.warehouseId)).limit(1))[0];
  const ids = await db.select({ locationId: schema.countPlanLines.locationId, productId: schema.countPlanLines.productId }).from(schema.countPlanLines)
    .where(eq(schema.countPlanLines.planId, id));
  return {
    plan, lines, entries, jobs, mandatoryCountReason: Boolean(wh?.m),
    locationIds: [...new Set(ids.flatMap((r) => (r.locationId ? [r.locationId] : [])))],
    productIds: [...new Set(ids.flatMap((r) => (r.productId ? [r.productId] : [])))],
  };
}

export async function linesOfPlan(db: AppDb, scope: Scope, planId: string): Promise<CountLineListRow[]> {
  const spec = lineGrid(scope, "plan", planId);
  return (await runGrid<CountLineListRow>(db, spec, { qm: "sw", filters: [], sort: [], page: 1, pageSize: MAX_PLAN_LINES * 2 })).rows.map(lineRow);
}

export async function nextCountCode(db: AppDb): Promise<string> {
  return await sequences.peek(db, "count");
}

/** Wizard default warehouse when no working context is set: the in-scope warehouse holding the most stock. */
export async function busiestWarehouseId(db: AppDb, scope: Scope): Promise<string | null> {
  if (scope.warehouseIds.length === 0) return null;
  const row = (await db.select({ id: schema.inventory.warehouseId, n: sql<number>`SUM(${schema.inventory.onHand})` }).from(schema.inventory)
    .where(and(inArray(schema.inventory.warehouseId, [...scope.warehouseIds]), gt(schema.inventory.onHand, 0)))
    .groupBy(schema.inventory.warehouseId).orderBy(sql`2 DESC`).limit(1))[0];
  return row?.id ?? null;
}

/* ----------------------------------------------------------------- writes */
function assertWarehouse(scope: Scope, warehouseId: string): void {
  if (!hasWarehouse(scope, warehouseId)) throw new AppError("VALIDATION", "Choose a warehouse you have access to", { fieldErrors: { warehouseId: ["Choose a warehouse you have access to"] } });
}

async function assertUniqueCode(tx: Tx, warehouseId: string, code: string, exceptId?: string): Promise<void> {
  const dup = (await tx.select({ id: schema.countPlans.id }).from(schema.countPlans)
    .where(and(eq(schema.countPlans.warehouseId, warehouseId), sql`lower(${schema.countPlans.code}) = lower(${code})`)))
    .find((r) => r.id !== exceptId);
  if (dup) throw new AppError("DUPLICATE", `A count plan named ${code} already exists in this warehouse`, { fieldErrors: { code: ["This name is already used in this warehouse"] } });
}

async function stockAt(tx: Tx, locationId: string): Promise<number> {
  return (await dbGet<{ n: number | null }>(tx, sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND on_hand > 0`))?.n ?? 0;
}

async function stockOf(tx: Tx, productId: string, warehouseId: string): Promise<number> {
  return (await dbGet<{ n: number | null }>(tx, sql`SELECT SUM(on_hand) AS n FROM inventory WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND on_hand > 0`))?.n ?? 0;
}

type LineInsert = typeof schema.countPlanLines.$inferInsert;

/** Validated line rows for a plan's locations / products (warehouse + client scope). */
export async function buildPlanLines(tx: Tx, scope: Scope, planId: string, input: Pick<CountPlanInput, "countType" | "warehouseId" | "locationIds" | "productIds"> & { readonly lpIds?: readonly string[] }, userId: string | null): Promise<LineInsert[]> {
  if (input.countType === "LP") return await buildLpLines(tx, scope, planId, input.warehouseId, input.lpIds ?? [], userId);
  if (input.countType === "Location") {
    const ids = [...new Set(input.locationIds)];
    const locs = ids.length ? await tx.select().from(schema.locations).where(inArray(schema.locations.id, ids)) : [];
    if (locs.length !== ids.length || locs.some((l) => l.warehouseId !== input.warehouseId)) {
      throw new AppError("VALIDATION", "Some locations are not in the selected warehouse", { fieldErrors: { locationIds: ["Some locations are not in the selected warehouse"] } });
    }
    return await mapSeq(ids, async (locationId) => ({ planId, locationId, status: "Pending" as const, initialStockQty: await stockAt(tx, locationId), createdBy: userId, updatedBy: userId }));
  }
  const ids = [...new Set(input.productIds)];
  const prods = ids.length ? await tx.select().from(schema.products).where(inArray(schema.products.id, ids)) : [];
  if (prods.length !== ids.length || prods.some((p) => !hasClient(scope, p.clientId))) {
    throw new AppError("VALIDATION", "Some products are not available to you", { fieldErrors: { productIds: ["Some products are not available to you"] } });
  }
  return await mapSeq(ids, async (productId) => ({ planId, productId, status: "Pending" as const, initialStockQty: await stockOf(tx, productId, input.warehouseId), createdBy: userId, updatedBy: userId }));
}

/**
 * LP count lines (Logiwa Count Type "LP"): one line per license plate, placed at the LP's
 * current location with `lp_id` set, so the sheet, jobs and Update Inv. only see that LP's
 * buckets. The LP must be in the plan's warehouse, sit in a location, and belong to a client
 * the viewer can access (or to no client).
 */
async function buildLpLines(tx: Tx, scope: Scope, planId: string, warehouseId: string, lpIds: readonly string[], userId: string | null): Promise<LineInsert[]> {
  const ids = [...new Set(lpIds)];
  const lps = ids.length ? await tx.select().from(schema.licensePlates).where(inArray(schema.licensePlates.id, ids)) : [];
  const bad = (msg: string) => new AppError("VALIDATION", msg, { fieldErrors: { lpIds: [msg] } });
  if (lps.length !== ids.length || lps.some((l) => l.warehouseId !== warehouseId)) throw bad("Some license plates are not in the selected warehouse");
  if (lps.some((l) => l.clientId && !hasClient(scope, l.clientId))) throw bad("Some license plates are not available to you");
  const unplaced = lps.find((l) => !l.locationId);
  if (unplaced) throw bad(`License plate ${unplaced.number} is not in a location, so it can't be counted`);
  const byId = new Map(lps.map((l) => [l.id, l]));
  return await mapSeq(ids, async (lpId) => {
    const lp = byId.get(lpId)!;
    const qty = (await dbGet<{ n: number | null }>(tx, sql`SELECT SUM(on_hand) AS n FROM inventory WHERE lp_id = ${lpId} AND on_hand > 0`))?.n ?? 0;
    return { planId, locationId: lp.locationId, lpId, status: "Pending" as const, initialStockQty: qty, createdBy: userId, updatedBy: userId };
  });
}

/** A location / SKU / LP may be in only one open count plan (the pickers flag them; this is the server guard). */
export async function assertPlanScopeFree(tx: Tx, input: Pick<CountPlanInput, "countType" | "warehouseId" | "locationIds" | "productIds"> & { readonly lpIds?: readonly string[] }, exceptPlanId: string | null): Promise<void> {
  await assertNoOpenCountConflicts(tx, {
    warehouseId: input.warehouseId, exceptPlanId,
    locationIds: input.countType === "Location" ? input.locationIds : [],
    productIds: input.countType === "SKU" ? input.productIds : [],
    lpIds: input.countType === "LP" ? (input.lpIds ?? []) : [],
  });
}

async function consumeCodeIfSuggested(tx: Tx, code: string): Promise<void> {
  if (code.toUpperCase() === (await sequences.peek(tx, "count")).toUpperCase()) await sequences.next(tx, "count");
}

export async function createCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, input: CountPlanInput): Promise<CountPlanListRow> {
  assertWarehouse(auth.scope, input.warehouseId);
  await assertUniqueCode(tx, input.warehouseId, input.code);
  await assertPlanScopeFree(tx, input, null);
  await consumeCodeIfSuggested(tx, input.code);
  const plan = (await tx.insert(schema.countPlans).values({
    code: input.code, warehouseId: input.warehouseId, description: input.description || null, scheduledAt: new Date(input.scheduledAt).toISOString(),
    lockLocations: input.lockLocations, countType: input.countType, operationType: "Cycle Count", status: "Pending", isAi: input.isAi ?? false,
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  const lines = await buildPlanLines(tx, auth.scope, plan.id, input, ctx.userId);
  for (const chunk of chunks(lines, 200)) await tx.insert(schema.countPlanLines).values(chunk);
  await changeLog.recordCreate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code });
  return await getCountPlanSummary(tx, auth.scope, plan.id);
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function loadOwnPlan(tx: Tx, scope: Scope, id: string): Promise<typeof schema.countPlans.$inferSelect> {
  const plan = (await tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];
  if (!plan || !hasWarehouse(scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

export async function updateCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string, input: CountPlanInput & { version: number }): Promise<CountPlanListRow> {
  const plan = await loadOwnPlan(tx, auth.scope, id);
  if (plan.version !== input.version) throw conflictError();
  const reason = planEditReason(plan.status);
  if (reason) throw new DomainError("INVALID_STATE", reason);
  assertWarehouse(auth.scope, input.warehouseId);
  if (input.code.toLowerCase() !== plan.code.toLowerCase() || input.warehouseId !== plan.warehouseId) await assertUniqueCode(tx, input.warehouseId, input.code, plan.id);
  await assertPlanScopeFree(tx, input, id);
  const before = await tx.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id));
  const updated = (await tx.update(schema.countPlans).set({
    code: input.code, warehouseId: input.warehouseId, description: input.description || null, scheduledAt: new Date(input.scheduledAt).toISOString(),
    lockLocations: input.lockLocations, countType: input.countType, updatedBy: ctx.userId, version: sql`${schema.countPlans.version} + 1`,
  }).where(and(eq(schema.countPlans.id, id), eq(schema.countPlans.version, input.version))).returning())[0];
  if (!updated) throw conflictError();
  const wanted = await buildPlanLines(tx, auth.scope, id, input, ctx.userId);
  const keyOf = (l: { locationId?: string | null; productId?: string | null; lpId?: string | null }) => `${l.locationId ?? ""}|${l.productId ?? ""}|${l.lpId ?? ""}`;
  const wantedKeys = new Set(wanted.map(keyOf));
  const keep = new Set(before.filter((l) => wantedKeys.has(keyOf(l))).map(keyOf));
  const removed = before.filter((l) => !wantedKeys.has(keyOf(l)));
  if (removed.length) await tx.delete(schema.countPlanLines).where(inArray(schema.countPlanLines.id, removed.map((l) => l.id)));
  const added = wanted.filter((l) => !keep.has(keyOf(l)));
  for (const chunk of chunks(added, 200)) await tx.insert(schema.countPlanLines).values(chunk);
  await changeLog.recordUpdate(tx, ctx, {
    entityType: "count_plan", entityId: id, entityCode: updated.code,
    before: { code: plan.code, warehouseId: await whCode(tx, plan.warehouseId), description: plan.description, scheduledAt: plan.scheduledAt, lockLocations: plan.lockLocations, countType: plan.countType, countLines: before.length },
    after: { code: updated.code, warehouseId: await whCode(tx, updated.warehouseId), description: updated.description, scheduledAt: updated.scheduledAt, lockLocations: updated.lockLocations, countType: updated.countType, countLines: wanted.length },
  });
  return await getCountPlanSummary(tx, auth.scope, id);
}

/** Header-only edit (name + description) - allowed at any status, like Logiwa's Edit Count drawer. Lines, warehouse, date and lock stay as they are. */
export const countPlanHeaderSchema = z.object({
  version: z.number().int().min(1),
  code: countPlanInputSchema.shape.code,
  description: countPlanInputSchema.shape.description,
});

export async function updateCountPlanHeader(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string, input: z.infer<typeof countPlanHeaderSchema>): Promise<CountPlanListRow> {
  const plan = await loadOwnPlan(tx, auth.scope, id);
  if (plan.version !== input.version) throw conflictError();
  // Inventory Updated: the description stays editable (Logiwa parity); the name is locked.
  const nameLocked = planNameLockedReason(plan.status);
  if (nameLocked && input.code !== plan.code) throw new DomainError("INVALID_STATE", nameLocked);
  if (input.code.toLowerCase() !== plan.code.toLowerCase()) await assertUniqueCode(tx, plan.warehouseId, input.code, plan.id);
  const description = input.description || null;
  if (input.code === plan.code && description === plan.description) return await getCountPlanSummary(tx, auth.scope, id);
  const updated = (await tx.update(schema.countPlans).set({ code: input.code, description, updatedBy: ctx.userId, version: sql`${schema.countPlans.version} + 1` })
    .where(and(eq(schema.countPlans.id, id), eq(schema.countPlans.version, input.version))).returning())[0];
  if (!updated) throw conflictError();
  await changeLog.recordUpdate(tx, ctx, {
    entityType: "count_plan", entityId: id, entityCode: updated.code,
    before: { code: plan.code, description: plan.description },
    after: { code: updated.code, description: updated.description },
  });
  return await getCountPlanSummary(tx, auth.scope, id);
}

async function whCode(tx: Tx, id: string): Promise<string> {
  return (await tx.select({ code: schema.warehouses.code }).from(schema.warehouses).where(eq(schema.warehouses.id, id)).limit(1))[0]?.code ?? id;
}

export async function deleteCountPlan(tx: Tx, ctx: DomainCtx, auth: AuthContext, id: string, version?: number): Promise<void> {
  const plan = await loadOwnPlan(tx, auth.scope, id);
  if (version !== undefined && plan.version !== version) throw conflictError();
  const reason = planDeleteReason(plan.status);
  if (reason) throw new DomainError("INVALID_STATE", reason);
  const jobs = (await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.countPlanId, id)).limit(1))[0];
  if (jobs) throw new DomainError("INVALID_STATE", "This count plan has jobs; cancel it instead");
  await tx.delete(schema.countPlans).where(eq(schema.countPlans.id, id));
  await changeLog.recordDelete(tx, ctx, { entityType: "count_plan", entityId: id, entityCode: plan.code });
}

/** Live stock per location for the wizard grid (Location Count) or per product in a warehouse (SKU Count). */
export async function stockHints(db: AppDb, warehouseId: string, locationIds: readonly string[], productIds: readonly string[]): Promise<{ locations: Record<string, number>; products: Record<string, number> }> {
  const locations: Record<string, number> = {};
  const products: Record<string, number> = {};
  if (locationIds.length) {
    for (const r of await db.select({ id: schema.inventory.locationId, n: sql<number>`SUM(${schema.inventory.onHand})` }).from(schema.inventory)
      .where(and(inArray(schema.inventory.locationId, [...locationIds]), gt(schema.inventory.onHand, 0))).groupBy(schema.inventory.locationId)) locations[r.id] = Number(r.n);
  }
  if (productIds.length) {
    for (const r of await db.select({ id: schema.inventory.productId, n: sql<number>`SUM(${schema.inventory.onHand})` }).from(schema.inventory)
      .where(and(inArray(schema.inventory.productId, [...productIds]), eq(schema.inventory.warehouseId, warehouseId), gt(schema.inventory.onHand, 0))).groupBy(schema.inventory.productId)) products[r.id] = Number(r.n);
  }
  return { locations, products };
}
