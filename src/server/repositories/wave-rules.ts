/**
 * Wave Rules repository (M03, Logiwa 02 §2): grid, CRUD with field-level change log,
 * soft delete, and next-run computation in the warehouse time zone.
 */
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { WAVE_RULES_GRID } from "@/lib/grid-defs/jobs/reports";
import type { WaveRuleInput } from "@/lib/grid-defs/jobs/forms";
import { nextRunAt } from "@/lib/grid-defs/jobs/schedule";
import type { AppDb } from "@/server/api/db";
import { AppError, conflictError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasWarehouse, scopedWhere } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import type { DomainCtx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { pageOffset } from "@/server/query/paginate";
import { asBool, compileGrid, type FieldSqlMap, qc } from "./jobs-grid";

const r = schema.waveRules;
export const WAVE_RULE_ENTITY = "wave_rule";

const ASSIGNEE_SQL = sql`(CASE ${qc(r.assignMode)}
  WHEN 'Pool' THEN 'Job Pool'
  WHEN 'Roles' THEN (SELECT GROUP_CONCAT(ro.name, ', ') FROM roles ro, json_each(${qc(r.assigneeRoleIds)}) je WHERE ro.id = je.value)
  ELSE (SELECT GROUP_CONCAT(u.name, ', ') FROM users u, json_each(${qc(r.assigneeUserIds)}) je WHERE u.id = je.value) END)`;

export const WAVE_RULE_SQL: FieldSqlMap = {
  name: sql`${qc(r.name)}`,
  warehouse: sql`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(r.warehouseId)})`,
  scheduled: asBool(sql`json_array_length(${qc(r.scheduleDays)}) > 0 AND json_array_length(${qc(r.scheduleTimes)}) > 0`),
  status: sql`COALESCE((SELECT wv.status FROM waves wv WHERE wv.wave_rule_id = ${qc(r.id)} ORDER BY wv.run_at DESC LIMIT 1), 'Pending')`,
  priority: sql`${qc(r.priority)}`,
  assignee: ASSIGNEE_SQL,
  operationType: sql`${qc(r.operationType)}`,
  lastRunBy: sql`(CASE WHEN ${qc(r.lastRunBy)} = 'Integration' THEN 'Auto Run' ELSE ${qc(r.lastRunBy)} END)`,
  lastRunAt: sql`${qc(r.lastRunAt)}`,
  lastWaveNo: sql`${qc(r.lastWaveNo)}`,
  nextRunAt: sql`${qc(r.nextRunAt)}`,
};

export function listWaveRules(db: AppDb, auth: AuthContext, query: GridQuery) {
  const { where, orderBy } = compileGrid(query, WAVE_RULES_GRID, WAVE_RULE_SQL, {
    defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: sql`${qc(r.id)}`, extra: [scopedWhere(r, auth.viewScope), eq(r.isActive, true)],
  });
  const select: Record<string, SQL> = { id: sql`${qc(r.id)}`, warehouseId: sql`${qc(r.warehouseId)}`, ruleSeq: sql`${qc(r.ruleSeq)}`, runCount: sql`${qc(r.runCount)}`, version: sql`${qc(r.version)}`, ...WAVE_RULE_SQL };
  const rows = db.select(select).from(r).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all() as Record<string, unknown>[];
  const total = db.select({ n: count() }).from(r).where(where).get()?.n ?? 0;
  return { rows: rows.map((row) => ({ ...row, scheduled: Boolean(row.scheduled) })), total };
}

export type WaveRuleRow = typeof schema.waveRules.$inferSelect;

export function loadWaveRule(db: AppDb, auth: AuthContext | null, id: string): WaveRuleRow {
  const rule = db.select().from(r).where(eq(r.id, id)).get();
  if (!rule || !rule.isActive) throw notFoundError("Wave rule");
  if (auth) assertInScope(auth.scope, rule, "Wave rule");
  return rule;
}

export function getWaveRuleDetail(db: AppDb, auth: AuthContext, id: string) {
  const rule = loadWaveRule(db, auth, id);
  const warehouse = db.select({ name: schema.warehouses.name, timezone: schema.warehouses.timezone }).from(schema.warehouses).where(eq(schema.warehouses.id, rule.warehouseId)).get();
  const recentWaves = db.select().from(schema.waves).where(eq(schema.waves.waveRuleId, id)).orderBy(desc(schema.waves.runAt)).limit(5).all();
  return { ...rule, warehouseName: warehouse?.name ?? "", timezone: warehouse?.timezone ?? "UTC", recentWaves };
}

function warehouseTz(db: AppDb, warehouseId: string): string {
  return db.select({ tz: schema.warehouses.timezone }).from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get()?.tz ?? "UTC";
}

export function computeNextRun(db: AppDb, rule: Pick<WaveRuleRow, "warehouseId" | "scheduleDays" | "scheduleTimes">, now = new Date()): string | null {
  return nextRunAt(rule.scheduleDays, rule.scheduleTimes, warehouseTz(db, rule.warehouseId), now)?.toISOString() ?? null;
}

function assertReferences(db: AppDb, input: WaveRuleInput): void {
  if (input.jobTypeIds.length > 0 && input.operationType !== "Order Merge") {
    const found = db.select({ id: schema.jobTypes.id, wh: schema.jobTypes.warehouseId, op: schema.jobTypes.operationType }).from(schema.jobTypes).where(inArray(schema.jobTypes.id, input.jobTypeIds)).all();
    const expected = OP_FOR_WAVE[input.operationType];
    if (found.length !== new Set(input.jobTypeIds).size || found.some((f) => f.wh !== input.warehouseId || (expected && f.op !== expected))) {
      throw new AppError("VALIDATION", "Some job types are not available for this warehouse and operation type.", { fieldErrors: { jobTypeIds: ["Choose job types of the selected warehouse"] } });
    }
  }
}

/** Wave operation → job-type operation it selects from. */
export const OP_FOR_WAVE: Readonly<Record<string, string | null>> = {
  Picking: "Picking", "AI Job": "Picking", "Cycle Count": "Count", Replenishment: "Replenishment", "Order Merge": null,
};

function values(input: WaveRuleInput) {
  return {
    name: input.name, warehouseId: input.warehouseId, operationType: input.operationType, priority: input.priority,
    deleteIfNotStarted: input.deleteIfNotStarted, deleteMethod: input.deleteIfNotStarted ? input.deleteMethod : "None" as const,
    deleteTime: input.deleteIfNotStarted ? input.deleteTime ?? null : null,
    jobTypeIds: input.operationType === "Order Merge" ? [] : input.jobTypeIds, filters: input.filters, orderBy: input.orderBy,
    scheduleDays: input.scheduleDays, scheduleTimes: input.scheduleDays.length > 0 ? [...new Set(input.scheduleTimes)].sort() : [],
    assignMode: input.operationType === "Order Merge" ? "Pool" as const : input.assignMode,
    assigneeRoleIds: input.assignMode === "Roles" ? input.assigneeRoleIds : [], assigneeUserIds: input.assignMode === "Users" ? input.assigneeUserIds : [],
    countType: input.operationType === "Cycle Count" ? input.countType ?? "Location" : null,
    lockLocations: input.operationType === "Cycle Count" ? input.lockLocations : false,
    softAllocation: input.operationType === "Replenishment" ? input.softAllocation : false,
    mergeRuleIds: input.operationType === "Order Merge" ? input.mergeRuleIds : [],
  };
}

function assertWarehouse(auth: AuthContext, warehouseId: string): void {
  if (!hasWarehouse(auth.scope, warehouseId)) throw new AppError("VALIDATION", "Choose one of your warehouses", { fieldErrors: { warehouseId: ["Not one of your warehouses"] } });
}

export function createWaveRule(db: AppDb, auth: AuthContext, ctx: DomainCtx, input: WaveRuleInput): WaveRuleRow {
  assertWarehouse(auth, input.warehouseId);
  assertReferences(db, input);
  const seq = (db.get<{ n: number | null }>(sql`SELECT MAX(rule_seq) AS n FROM wave_rules`)?.n ?? 20_500) + 1;
  const v = values(input);
  const row = db.insert(r).values({ ...v, ruleSeq: seq, nextRunAt: computeNextRun(db, v), createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get();
  recordCreate(db, ctx, { entityType: WAVE_RULE_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function updateWaveRule(db: AppDb, auth: AuthContext, ctx: DomainCtx, id: string, input: WaveRuleInput): WaveRuleRow {
  const before = loadWaveRule(db, auth, id);
  if (input.version !== undefined && input.version !== before.version) throw conflictError();
  assertWarehouse(auth, input.warehouseId);
  assertReferences(db, input);
  const v = values(input);
  const after = db.update(r).set({ ...v, nextRunAt: computeNextRun(db, v), updatedBy: ctx.userId, version: sql`${qc(r.version)} + 1` })
    .where(and(eq(r.id, id), eq(r.version, before.version))).returning().get();
  if (!after) throw conflictError();
  recordUpdate(db, ctx, { entityType: WAVE_RULE_ENTITY, entityId: id, entityCode: after.name, before: pick(before), after: pick(after) });
  return after;
}

function pick(row: WaveRuleRow): Record<string, unknown> {
  return {
    name: row.name, priority: row.priority, deleteIfNotStarted: row.deleteIfNotStarted, deleteMethod: row.deleteMethod, deleteTime: row.deleteTime,
    jobTypes: row.jobTypeIds.length, filters: row.filters.map((f) => f.label).join("; "), orderBy: row.orderBy.map((o) => `${o.field} ${o.dir}`).join(", "),
    scheduleDays: row.scheduleDays.join(", "), scheduleTimes: row.scheduleTimes.join(", "), assignMode: row.assignMode,
    countType: row.countType, lockLocations: row.lockLocations, softAllocation: row.softAllocation, runCount: row.runCount,
  };
}

export function deleteWaveRule(db: AppDb, auth: AuthContext, ctx: DomainCtx, id: string): void {
  const rule = loadWaveRule(db, auth, id);
  const running = db.select({ id: schema.waves.id }).from(schema.waves).where(and(eq(schema.waves.waveRuleId, id), inArray(schema.waves.status, ["Pending", "Started", "In Progress"]))).get();
  if (running) throw new AppError("INVALID_STATE", `Wave rule ${rule.name} has a wave in progress; wait until it finishes.`);
  db.update(r).set({ isActive: false, nextRunAt: null, updatedBy: ctx.userId, version: sql`${qc(r.version)} + 1` }).where(eq(r.id, id)).run();
  recordDelete(db, ctx, { entityType: WAVE_RULE_ENTITY, entityId: id, entityCode: rule.name });
}

/** Records the run on the rule (run count, last run/by/wave, next run) with change-log rows. */
export function stampRun(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, waveNo: string, runBy: string, at: Date): void {
  const next = computeNextRun(db, rule, at);
  db.update(r).set({ runCount: rule.runCount + 1, lastRunAt: at.toISOString(), lastRunBy: runBy, lastWaveNo: waveNo, nextRunAt: next }).where(eq(r.id, rule.id)).run();
  recordUpdate(db, ctx, { entityType: WAVE_RULE_ENTITY, entityId: rule.id, entityCode: rule.name, before: { runCount: rule.runCount, lastWaveNo: rule.lastWaveNo }, after: { runCount: rule.runCount + 1, lastWaveNo: waveNo } });
}

export function listEntityChangeLog(db: AppDb, entityType: string, entityId: string, page: number, pageSize: number) {
  const where = and(eq(schema.changeLog.entityType, entityType), eq(schema.changeLog.entityId, entityId));
  const rows = db.select().from(schema.changeLog).where(where).orderBy(desc(schema.changeLog.at)).limit(pageSize).offset((page - 1) * pageSize).all();
  const total = db.select({ n: count() }).from(schema.changeLog).where(where).get()?.n ?? 0;
  return { rows: rows.map((row) => ({ ...row, lineLabel: null })), total };
}
