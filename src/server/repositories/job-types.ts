/**
 * Job Types repository (M03, Logiwa 02 §6 / 08 §Job Types): grid, CRUD with field-level
 * change log, optimistic concurrency, and a delete guard while wave rules or open jobs
 * still reference the type.
 */
import { and, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { JobTypeInput } from "@/lib/grid-defs/jobs/forms";
import { JOB_TYPES_GRID } from "@/lib/grid-defs/jobs/reports";
import type { AppDb } from "@/server/api/db";
import { AppError, conflictError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasWarehouse, scopedWhere } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import type { DomainCtx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { pageOffset } from "@/server/query/paginate";
import { compileGrid, type FieldSqlMap, qc } from "./jobs-grid";

const jt = schema.jobTypes;
export const JOB_TYPE_ENTITY = "job_type";

export const JOB_TYPE_SQL: FieldSqlMap = {
  code: sql`${qc(jt.code)}`,
  description: sql`${qc(jt.description)}`,
  warehouse: sql`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(jt.warehouseId)})`,
  algorithm: sql`(SELECT a.name FROM algorithms a WHERE a.id = ${qc(jt.allocationAlgorithmId)})`,
  operationType: sql`${qc(jt.operationType)}`,
};

export function listJobTypes(db: AppDb, auth: AuthContext, query: GridQuery, opts: { warehouseId?: string; operationType?: string } = {}) {
  const extra: (SQL | undefined)[] = [scopedWhere(jt, auth.viewScope), eq(jt.isActive, true)];
  if (opts.warehouseId) extra.push(eq(jt.warehouseId, opts.warehouseId));
  if (opts.operationType) extra.push(sql`${qc(jt.operationType)} = ${opts.operationType}`);
  const { where, orderBy } = compileGrid(query, JOB_TYPES_GRID, JOB_TYPE_SQL, { defaultSort: [{ field: "code", dir: "asc" }], tiebreaker: sql`${qc(jt.id)}`, extra });
  const select: Record<string, SQL> = {
    id: sql`${qc(jt.id)}`, warehouseId: sql`${qc(jt.warehouseId)}`, version: sql`${qc(jt.version)}`, template: sql`${qc(jt.template)}`,
    ruleCount: sql`(SELECT COUNT(*) FROM wave_rules r, json_each(r.job_type_ids) je WHERE je.value = ${qc(jt.id)} AND r.is_active = 1)`,
    openJobCount: sql`(SELECT COUNT(*) FROM jobs j WHERE j.job_type_id = ${qc(jt.id)} AND j.status IN ('Pending','Started','In Progress'))`,
    ...JOB_TYPE_SQL,
  };
  const rows = db.select(select).from(jt).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all();
  const total = db.select({ n: count() }).from(jt).where(where).get()?.n ?? 0;
  return { rows, total };
}

export type JobTypeRow = typeof schema.jobTypes.$inferSelect;

export function loadJobType(db: AppDb, auth: AuthContext, id: string): JobTypeRow {
  const row = db.select().from(jt).where(eq(jt.id, id)).get();
  if (!row || !row.isActive) throw notFoundError("Job type");
  assertInScope(auth.scope, row, "Job type");
  return row;
}

/** Why the type can't be deleted, or null. */
export function deleteBlocker(db: AppDb, id: string): string | null {
  const rules = db.all<{ name: string }>(sql`SELECT r.name FROM wave_rules r, json_each(r.job_type_ids) je WHERE je.value = ${id} AND r.is_active = 1`);
  const open = db.select({ n: count() }).from(schema.jobs).where(and(eq(schema.jobs.jobTypeId, id), inArray(schema.jobs.status, ["Pending", "Started", "In Progress"]))).get()?.n ?? 0;
  const parts: string[] = [];
  if (rules.length > 0) parts.push(`wave rule${rules.length === 1 ? "" : "s"} ${rules.slice(0, 3).map((r) => `"${r.name}"`).join(", ")}${rules.length > 3 ? "…" : ""}`);
  if (open > 0) parts.push(`${open} open job${open === 1 ? "" : "s"}`);
  return parts.length > 0 ? `This job type is used by ${parts.join(" and ")}. Remove it from them first.` : null;
}

export function getJobTypeDetail(db: AppDb, auth: AuthContext, id: string) {
  const row = loadJobType(db, auth, id);
  const algorithm = row.allocationAlgorithmId ? db.select({ name: schema.algorithms.name }).from(schema.algorithms).where(eq(schema.algorithms.id, row.allocationAlgorithmId)).get() : undefined;
  return { ...row, algorithmName: algorithm?.name ?? null, deleteBlocker: deleteBlocker(db, id) };
}

function assertUnique(db: AppDb, input: JobTypeInput, exceptId?: string): void {
  const dupe = db.select({ id: jt.id }).from(jt).where(and(eq(jt.warehouseId, input.warehouseId), sql`lower(${qc(jt.code)}) = lower(${input.code})`, eq(jt.isActive, true), exceptId ? ne(jt.id, exceptId) : undefined)).get();
  if (dupe) throw new AppError("DUPLICATE", `A job type named "${input.code}" already exists in this warehouse.`, { fieldErrors: { code: ["This name is already used in the warehouse"] } });
}

function assertAlgorithm(db: AppDb, input: JobTypeInput): void {
  if (!input.allocationAlgorithmId) return;
  const algo = db.select().from(schema.algorithms).where(eq(schema.algorithms.id, input.allocationAlgorithmId)).get();
  if (!algo || algo.warehouseId !== input.warehouseId) {
    throw new AppError("VALIDATION", "Choose an allocation algorithm of this warehouse", { fieldErrors: { allocationAlgorithmId: ["Not an algorithm of this warehouse"] } });
  }
}

function values(input: JobTypeInput) {
  return {
    code: input.code, description: input.description, warehouseId: input.warehouseId, operationType: input.operationType,
    allocationAlgorithmId: input.allocationAlgorithmId ?? null, template: input.settings.template, settings: input.settings, conditions: input.conditions,
    locationConditions: input.locationConditions ?? null, skuConditions: input.skuConditions ?? null,
    sourceLocationConditions: input.sourceLocationConditions ?? null, destinationLocationConditions: input.destinationLocationConditions ?? null,
    lpConditions: input.lpConditions ?? null, productConditions: input.productConditions ?? null, orderBy: input.orderBy, groupBy: input.groupBy ?? null,
  };
}

export function createJobType(db: AppDb, auth: AuthContext, ctx: DomainCtx, input: JobTypeInput): JobTypeRow {
  if (!hasWarehouse(auth.scope, input.warehouseId)) throw new AppError("VALIDATION", "Choose one of your warehouses", { fieldErrors: { warehouseId: ["Not one of your warehouses"] } });
  assertUnique(db, input);
  assertAlgorithm(db, input);
  const row = db.insert(jt).values({ ...values(input), createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get();
  recordCreate(db, ctx, { entityType: JOB_TYPE_ENTITY, entityId: row.id, entityCode: row.code });
  return row;
}

function snapshot(row: JobTypeRow): Record<string, unknown> {
  const s = row.settings;
  return {
    code: row.code, description: row.description, allocationAlgorithmId: row.allocationAlgorithmId, orderScope: s.orderScope,
    ...Object.fromEntries(Object.entries(s.picking ?? {}).map(([k, v]) => [k, v])),
    batchMethod: s.batch?.method, batchMin: s.batch?.min, batchMax: s.batch?.max,
    conditions: row.conditions.map((c) => c.label).join("; "), orderBy: row.orderBy.map((o) => `${o.field} ${o.dir}`).join(", "),
    groupBy: (row.groupBy ?? []).join(", "),
  };
}

export function updateJobType(db: AppDb, auth: AuthContext, ctx: DomainCtx, id: string, input: JobTypeInput): JobTypeRow {
  const before = loadJobType(db, auth, id);
  if (input.version !== undefined && input.version !== before.version) throw conflictError();
  if (input.warehouseId !== before.warehouseId || input.operationType !== before.operationType) {
    throw new AppError("VALIDATION", "Warehouse and operation type can't change after creation.");
  }
  assertUnique(db, input, id);
  assertAlgorithm(db, input);
  const after = db.update(jt).set({ ...values(input), updatedBy: ctx.userId, version: sql`${qc(jt.version)} + 1` }).where(and(eq(jt.id, id), eq(jt.version, before.version))).returning().get();
  if (!after) throw conflictError();
  recordUpdate(db, ctx, { entityType: JOB_TYPE_ENTITY, entityId: id, entityCode: after.code, before: snapshot(before), after: snapshot(after) });
  return after;
}

export function deleteJobType(db: AppDb, auth: AuthContext, ctx: DomainCtx, id: string): void {
  const row = loadJobType(db, auth, id);
  const blocker = deleteBlocker(db, id);
  if (blocker) throw new AppError("INVALID_STATE", blocker);
  db.update(jt).set({ isActive: false, updatedBy: ctx.userId, version: sql`${qc(jt.version)} + 1` }).where(eq(jt.id, id)).run();
  recordDelete(db, ctx, { entityType: JOB_TYPE_ENTITY, entityId: id, entityCode: row.code });
}

export function algorithmsFor(db: AppDb, auth: AuthContext, warehouseId: string) {
  if (!hasWarehouse(auth.scope, warehouseId)) return [];
  return db.select({ id: schema.algorithms.id, name: schema.algorithms.name, kind: schema.algorithms.kind }).from(schema.algorithms)
    .where(and(eq(schema.algorithms.warehouseId, warehouseId), eq(schema.algorithms.status, "Active"), eq(schema.algorithms.kind, "Allocation"))).all();
}
