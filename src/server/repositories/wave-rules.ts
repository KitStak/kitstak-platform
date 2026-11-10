/**
 * Wave Rules repository (M03, Logiwa 02 §2): grid, CRUD with field-level change log,
 * soft delete, and next-run computation in the warehouse time zone.
 */
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { WAVE_RULES_GRID } from "@/lib/grid-defs/jobs/reports";
import type { WaveRuleInput } from "@/lib/grid-defs/jobs/forms";
import { waveOrderByLabel } from "@/lib/grid-defs/jobs/conditions";
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
import { assignableForWarehouse } from "./wave-rules-options";

const r = schema.waveRules;
export const WAVE_RULE_ENTITY = "wave_rule";

const ASSIGNEE_SQL = sql`(CASE ${qc(r.assignMode)}
  WHEN 'Pool' THEN 'Job Pool'
  WHEN 'Roles' THEN (SELECT GROUP_CONCAT(ro.name, ', ') FROM roles ro, json_each(${qc(r.assigneeRoleIds)}) je WHERE ro.id = je.value)
  ELSE (SELECT GROUP_CONCAT(u.name, ', ') FROM users u, json_each(${qc(r.assigneeUserIds)}) je WHERE u.id = je.value) END)`;
/** Critic R5: an unassigned rule reads "Job Pool" whatever its stored mode (Users / Roles with no picks). */
const ASSIGNEE_DISPLAY_SQL = sql`COALESCE(${ASSIGNEE_SQL}, 'Job Pool')`;

export const WAVE_RULE_SQL: FieldSqlMap = {
  name: sql`${qc(r.name)}`,
  warehouse: sql`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(r.warehouseId)})`,
  scheduled: asBool(sql`json_array_length(${qc(r.scheduleDays)}) > 0 AND json_array_length(${qc(r.scheduleTimes)}) > 0`),
  status: sql`COALESCE((SELECT wv.status FROM waves wv WHERE wv.wave_rule_id = ${qc(r.id)} ORDER BY wv.run_at DESC LIMIT 1), 'Pending')`,
  priority: sql`${qc(r.priority)}`,
  assignee: ASSIGNEE_DISPLAY_SQL,
  operationType: sql`${qc(r.operationType)}`,
  lastRunBy: sql`(CASE WHEN ${qc(r.lastRunBy)} = 'Integration' THEN 'Auto Run' ELSE ${qc(r.lastRunBy)} END)`,
  lastRunAt: sql`${qc(r.lastRunAt)}`,
  lastWaveNo: sql`${qc(r.lastWaveNo)}`,
  nextRunAt: sql`${qc(r.nextRunAt)}`,
};

/**
 * Self-heal: every active rule with a schedule (days and times) gets a computed next run.
 * Rules inserted outside the API (seed, imports, restores) arrive with `next_run_at` NULL.
 * Idempotent; returns the rows fixed.
 */
export function ensureNextRuns(db: AppDb, now = new Date()): number {
  const rows = db.select().from(r).where(and(eq(r.isActive, true), sql`${qc(r.nextRunAt)} IS NULL`)).all();
  let fixed = 0;
  for (const rule of rows) {
    if (rule.scheduleDays.length === 0 || rule.scheduleTimes.length === 0) continue;
    const next = computeNextRun(db, rule, now);
    if (!next) continue;
    db.update(r).set({ nextRunAt: next }).where(and(eq(r.id, rule.id), sql`${qc(r.nextRunAt)} IS NULL`)).run();
    fixed += 1;
  }
  return fixed;
}

const ENSURE_INTERVAL_MS = 60_000;
let lastEnsureAt = 0;

export function listWaveRules(db: AppDb, auth: AuthContext, query: GridQuery) {
  // Self-heal is best effort: a busy writer must never fail (or stall) the grid read; the
  // scheduler tick retries it.
  // Throttled to once a minute per process so concurrent grid reads do not each take a write lock.
  try {
    const nowMs = Date.now();
    if (nowMs - lastEnsureAt > ENSURE_INTERVAL_MS) {
      lastEnsureAt = nowMs;
      ensureNextRuns(db);
    }
  } catch {
    /* retried by the scheduler */
  }
  const { where, orderBy } = compileGrid(query, WAVE_RULES_GRID, WAVE_RULE_SQL, {
    defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: sql`${qc(r.id)}`, extra: [scopedWhere(r, auth.viewScope), eq(r.isActive, true)],
  });
  const select: Record<string, SQL> = { id: sql`${qc(r.id)}`, warehouseId: sql`${qc(r.warehouseId)}`, timezone: sql`(SELECT wtz.timezone FROM warehouses wtz WHERE wtz.id = ${qc(r.warehouseId)})`, ruleSeq: sql`${qc(r.ruleSeq)}`, runCount: sql`${qc(r.runCount)}`, version: sql`${qc(r.version)}`, ...WAVE_RULE_SQL };
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
  // Critic R3: only users / roles that can execute tasks in the warehouse can be job assignees.
  if (input.operationType !== "Order Merge" && (input.assignMode === "Users" || input.assignMode === "Roles")) {
    const ok = assignableForWarehouse(db, input.warehouseId);
    if (input.assignMode === "Users") {
      const allowed = new Set(ok.users.map((u) => u.id));
      if (input.assigneeUserIds.some((id) => !allowed.has(id))) {
        throw new AppError("VALIDATION", "Some selected users can't execute jobs in this warehouse.", { fieldErrors: { assigneeUserIds: ["Choose users who can execute tasks in this warehouse"] } });
      }
    } else {
      const allowed = new Set(ok.roles.map((r) => r.id));
      if (input.assigneeRoleIds.some((id) => !allowed.has(id))) {
        throw new AppError("VALIDATION", "Some selected roles can't execute tasks.", { fieldErrors: { assigneeRoleIds: ["Choose roles that can execute tasks"] } });
      }
    }
  }
}

/** Wave operation → job-type operation it selects from. */
export const OP_FOR_WAVE: Readonly<Record<string, string | null>> = {
  Picking: "Picking", "AI Job": "Picking", "Cycle Count": "Count", Replenishment: "Replenishment", "Order Merge": null,
};

/** Rule names are unique per warehouse (case- and space-insensitive) among active rules. */
function assertUniqueName(db: AppDb, input: WaveRuleInput, selfId?: string): void {
  const clash = db.select({ id: r.id }).from(r).where(and(
    eq(r.warehouseId, input.warehouseId), eq(r.isActive, true),
    sql`lower(trim(${qc(r.name)})) = ${input.name.trim().toLowerCase()}`,
    selfId ? sql`${qc(r.id)} <> ${selfId}` : sql`1 = 1`,
  )).get();
  if (clash) {
    throw new AppError("VALIDATION", `A wave rule named "${input.name.trim()}" already exists in this warehouse.`, {
      fieldErrors: { name: ["This name is already used by another wave rule in the warehouse"] },
    });
  }
}

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
  assertUniqueName(db, input);
  const seq =(db.get<{ n: number | null }>(sql`SELECT MAX(rule_seq) AS n FROM wave_rules`)?.n ?? 20_500) + 1;
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
  assertUniqueName(db, input, id);
  const v = values(input);
  const after = db.update(r).set({ ...v, nextRunAt: computeNextRun(db, v), updatedBy: ctx.userId, version: sql`${qc(r.version)} + 1` })
    .where(and(eq(r.id, id), eq(r.version, before.version))).returning().get();
  if (!after) throw conflictError();
  recordUpdate(db, ctx, { entityType: WAVE_RULE_ENTITY, entityId: id, entityCode: after.name, before: pick(db, before), after: pick(db, after) });
  return after;
}

function namesOf(db: AppDb, table: "job_types" | "roles" | "users" | "lookup_values", ids: readonly string[]): string {
  if (ids.length === 0) return "";
  const col = table === "job_types" ? "code" : "name";
  const rows = db.all<{ id: string; n: string }>(sql`SELECT id, ${sql.raw(col)} AS n FROM ${sql.raw(table)} WHERE id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  const byId = new Map(rows.map((x) => [x.id, x.n]));
  return ids.map((x) => byId.get(x) ?? "(removed)").join(", ");
}

/** Change-log snapshot in display values (labels and names, never raw keys or ids). */
function pick(db: AppDb, row: WaveRuleRow): Record<string, unknown> {
  const yes = (b: boolean) => (b ? "Yes" : "No");
  return {
    name: row.name, priority: row.priority, deleteIfNotStarted: yes(row.deleteIfNotStarted), deleteMethod: row.deleteMethod, deleteTime: row.deleteTime,
    jobTypes: namesOf(db, "job_types", row.jobTypeIds), filters: row.filters.map((f) => f.label).join("; "),
    orderBy: row.orderBy.map((o) => `${waveOrderByLabel(o.field)} (${o.dir === "desc" ? "descending" : "ascending"})`).join(", "),
    scheduleDays: row.scheduleDays.join(", "), scheduleTimes: row.scheduleTimes.join(", "),
    assignMode: row.assignMode === "Pool" ? "Job pool" : row.assignMode,
    assignedRoles: namesOf(db, "roles", row.assigneeRoleIds ?? []), assignedUsers: namesOf(db, "users", row.assigneeUserIds ?? []),
    mergeRules: namesOf(db, "lookup_values", row.mergeRuleIds ?? []),
    countType: row.countType, lockLocations: yes(row.lockLocations), softAllocation: yes(row.softAllocation), runCount: row.runCount,
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
  const rows = db.select({ row: schema.changeLog, userName: schema.users.name }).from(schema.changeLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.changeLog.userId))
    .where(where).orderBy(desc(schema.changeLog.at)).limit(pageSize).offset((page - 1) * pageSize).all();
  const total = db.select({ n: count() }).from(schema.changeLog).where(where).get()?.n ?? 0;
  // Logiwa shows the user's display name; the raw source (email / integration) stays as a tooltip.
  return { rows: rows.map(({ row, userName }) => ({ ...row, source: displayActor(db, userName, row.source), sourceDetail: row.source, lineLabel: null })), total };
}

/** Display name for an actor string: a user's name when the source is a user's email, else the source. */
export function displayActor(db: AppDb, userName: string | null | undefined, source: string | null): string {
  if (userName) return userName;
  if (!source) return "System";
  if (source.includes("@")) return db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.email, source)).get()?.name ?? source;
  return source;
}
