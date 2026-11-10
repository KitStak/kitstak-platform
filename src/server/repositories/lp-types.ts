/**
 * LP Types repository (M10): grid (21 columns), detail, create/update (General · Parameters ·
 * Other info) and guarded delete (blocked while license plates of the type exist).
 */
import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { round } from "@/lib/grid-defs/facility/common";
import { LP_TYPE_FIELDS, LP_TYPE_SEARCH_FIELDS, LP_TYPE_SORT_FIELDS, lpNumberPreview, type LpTypeSave } from "@/lib/grid-defs/facility/lp-types";
import { assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, listScope, logCreate, logDelete, logUpdate, resolveIds, type Actor, type GridBinding, qc, flattenCustomFields } from "./locations-shared";
import { customFieldSql } from "./custom-field-sql";

const t = s.lpTypes;
const ENTITY = "lp_type";

const lpCountSql = sql<number>`(SELECT COUNT(*) FROM license_plates lp WHERE lp.lp_type_id = ${qc(t.id)})`;
const occupiedSql = sql<number>`(SELECT COUNT(*) FROM license_plates lp WHERE lp.lp_type_id = ${qc(t.id)} AND lp.status = 'Occupied')`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(t.warehouseId)})`;

export const LP_TYPE_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${t.code}`,
  description: sql`${t.description}`,
  warehouseId: sql`${t.warehouseId}`,
  warehouseCode: warehouseCodeSql,
  numberPrefix: sql`${t.numberPrefix}`,
  numberLength: sql`${t.numberLength}`,
  length: sql`${t.length}`,
  width: sql`${t.width}`,
  height: sql`${t.height}`,
  emptyWeight: sql`${t.emptyWeight}`,
  maxWeight: sql`${t.maxWeight}`,
  suitableForParentLp: sql`${t.suitableForParentLp}`,
  useForAiJob: sql`${t.useForAiJob}`,
  onlyOneSku: sql`${t.onlyOneSku}`,
  onlyOneClient: sql`${t.onlyOneClient}`,
  onlyOneExpiry: sql`${t.onlyOneExpiry}`,
  onlyOneProductionDate: sql`${t.onlyOneProductionDate}`,
  onlyOneLot: sql`${t.onlyOneLot}`,
  onlyOneOrder: sql`${t.onlyOneOrder}`,
  onlyOneJob: sql`${t.onlyOneJob}`,
  dimensionUnit: sql`${t.dimensionUnit}`,
  weightUnit: sql`${t.weightUnit}`,
  volumeUnit: sql`${t.volumeUnit}`,
  maxVolume: sql`${t.maxVolume}`,
  lpCount: lpCountSql,
  createdAt: sql`${t.createdAt}`,
  ...customFieldSql(t.customFields),
};

const BINDING: GridBinding = {
  exprs: LP_TYPE_SQL, fields: LP_TYPE_FIELDS, sortable: LP_TYPE_SORT_FIELDS, search: LP_TYPE_SEARCH_FIELDS,
  defaultSort: [{ field: "code", dir: "asc" }], tiebreaker: t.id,
};

const BOOLS = ["onlyOneExpiry", "onlyOneProductionDate", "onlyOneLot", "onlyOneSku", "onlyOneClient", "onlyOneOrder", "onlyOneJob", "suitableForParentLp", "useForAiJob"] as const;

export type LpTypeRow = Omit<typeof t.$inferSelect, "createdBy" | "updatedBy"> & {
  readonly warehouseCode: string;
  readonly lpCount: number;
  readonly occupiedCount: number;
  readonly nextNumber: string;
};

export function listLpTypes(db: AppDb, auth: AuthContext, query: GridQuery): { rows: LpTypeRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [listScope(t, auth)]);
  const { createdBy: _cb, updatedBy: _ub, ...cols } = getTableColumns(t);
  void _cb; void _ub;
  const result = paginate(
    db.select({ ...cols, warehouseCode: warehouseCodeSql, lpCount: lpCountSql, occupiedCount: occupiedSql }).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  const rows = (result.rows as unknown as (LpTypeRow & Record<string, unknown>)[]).map((r) => {
    const out: Record<string, unknown> = { ...r, nextNumber: lpNumberPreview(r.numberPrefix, r.numberLength, r.nextSequence) };
    for (const k of BOOLS) out[k] = Boolean(r[k]);
    return out as LpTypeRow;
  });
  return { rows, total: result.total };
}

export function loadLpType(db: AppDb, auth: AuthContext, id: string): typeof t.$inferSelect {
  const row = assertFound(db.select().from(t).where(eq(t.id, id)).get(), "LP type");
  assertWarehouseInScope(auth, row.warehouseId, "LP type");
  return row;
}

export function getLpType(db: AppDb, auth: AuthContext, id: string) {
  const row = loadLpType(db, auth, id);
  const stats = db.select({ lpCount: lpCountSql, occupied: occupiedSql, warehouseCode: warehouseCodeSql }).from(t).where(eq(t.id, id)).get();
  const byStatus = db.select({ status: s.licensePlates.status, n: sql<number>`count(*)` }).from(s.licensePlates).where(eq(s.licensePlates.lpTypeId, id)).groupBy(s.licensePlates.status).all();
  return { ...row, warehouseCode: stats?.warehouseCode ?? "", lpCount: stats?.lpCount ?? 0, occupiedCount: stats?.occupied ?? 0, byStatus, nextNumber: lpNumberPreview(row.numberPrefix, row.numberLength, row.nextSequence) };
}

export type LpTypeDetail = ReturnType<typeof getLpType>;

function columnsFor(input: LpTypeSave) {
  return {
    warehouseId: input.warehouseId,
    code: input.code.trim().toUpperCase(),
    description: input.description,
    numberPrefix: input.numberPrefix.trim().toUpperCase(),
    numberLength: input.numberLength,
    length: round(input.length), width: round(input.width), height: round(input.height),
    dimensionUnit: input.dimensionUnit, weightUnit: input.weightUnit, volumeUnit: input.volumeUnit,
    emptyWeight: round(input.emptyWeight), maxWeight: round(input.maxWeight), maxVolume: round(input.maxVolume, 3),
    onlyOneExpiry: input.onlyOneExpiry, onlyOneProductionDate: input.onlyOneProductionDate, onlyOneLot: input.onlyOneLot,
    onlyOneSku: input.onlyOneSku, onlyOneClient: input.onlyOneClient, onlyOneOrder: input.onlyOneOrder, onlyOneJob: input.onlyOneJob,
    suitableForParentLp: input.suitableForParentLp, useForAiJob: input.useForAiJob,
    customFields: input.customFields,
  };
}

function assertCodeFree(db: AppDb, warehouseId: string, code: string, exceptId?: string): void {
  const clash = db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, warehouseId), sql`lower(${t.code}) = lower(${code})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("code", `LP type ${code} already exists in this warehouse`);
}

/** A prefix shared by two types of one warehouse would let their numbers collide. */
function assertPrefixFree(db: AppDb, warehouseId: string, prefix: string, exceptId?: string): void {
  const clash = db.select({ id: t.id, code: t.code }).from(t).where(and(eq(t.warehouseId, warehouseId), sql`upper(${t.numberPrefix}) = upper(${prefix})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("numberPrefix", `Prefix ${prefix.toUpperCase()} is already used by LP type ${clash.code}`);
}

function display(db: AppDb, row: typeof t.$inferSelect): Record<string, unknown> {
  const wh = resolveIds(db, "warehouses", [row.warehouseId]);
  const { id: _i, warehouseId, customFields: _c, nextSequence: _n, createdAt: _a, createdBy: _b, updatedAt: _u, updatedBy: _ub, version: _v, ...rest } = row;
  void _i; void _n; void _a; void _b; void _u; void _ub; void _v;
  return { ...rest, ...flattenCustomFields(_c), warehouse: wh.get(warehouseId) ?? "" };
}

export function createLpType(tx: AppDb, auth: AuthContext, actor: Actor, input: LpTypeSave): { id: string; code: string } {
  assertWarehouseInScope(auth, input.warehouseId);
  assertCodeFree(tx, input.warehouseId, input.code.trim());
  assertPrefixFree(tx, input.warehouseId, input.numberPrefix.trim());
  const row = tx.insert(t).values({ ...columnsFor(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: t.id, code: t.code }).get();
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.code });
  return row;
}

export function updateLpType(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: LpTypeSave): { id: string; code: string; version: number } {
  const before = loadLpType(tx, auth, id);
  assertVersion(before.version, input.version);
  if (input.warehouseId !== before.warehouseId) {
    throw new AppError("VALIDATION", "An LP type can't move to another warehouse", { fieldErrors: { warehouseId: ["An LP type can't move to another warehouse"] } });
  }
  assertCodeFree(tx, before.warehouseId, input.code.trim(), id);
  assertPrefixFree(tx, before.warehouseId, input.numberPrefix.trim(), id);
  const used = tx.select({ n: sql<number>`count(*)` }).from(s.licensePlates).where(eq(s.licensePlates.lpTypeId, id)).get()?.n ?? 0;
  if (used > 0 && (input.numberPrefix.trim().toUpperCase() !== before.numberPrefix.toUpperCase() || input.numberLength !== before.numberLength)) {
    const message = `${used} LP numbers already use ${before.numberPrefix} with ${before.numberLength} digits; the prefix and length are locked`;
    throw new AppError("VALIDATION", message, { fieldErrors: { numberPrefix: [message] } });
  }
  const snapshot = display(tx, before);
  const after = tx.update(t).set({ ...columnsFor(input), updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: after.code }, snapshot, display(tx, after));
  return { id, code: after.code, version: after.version };
}

/** Why an LP type can't be deleted, or null. */
export function lpTypeDeleteBlocker(db: AppDb, id: string): string | null {
  const counts = db.select({ n: sql<number>`count(*)`, voided: sql<number>`COALESCE(SUM(CASE WHEN ${s.licensePlates.status} = 'Removed' THEN 1 ELSE 0 END), 0)` }).from(s.licensePlates).where(eq(s.licensePlates.lpTypeId, id)).get();
  const lps = counts?.n ?? 0;
  if (lps > 0) {
    const voided = counts?.voided ?? 0;
    const base = `has ${lps.toLocaleString("en-US")} LP ${lps === 1 ? "number" : "numbers"}`;
    if (voided === lps) return `${base}, voided but kept for their stock history`;
    return voided > 0 ? `${base} (${voided} voided); delete the unused ones from LP Numbers first` : `${base}; delete the unused ones from LP Numbers first`;
  }
  const caps = db.select({ n: sql<number>`count(*)` }).from(s.locationLpCapacity).where(eq(s.locationLpCapacity.lpTypeId, id)).get()?.n ?? 0;
  if (caps > 0) return `is used by ${caps} location LP ${caps === 1 ? "capacity" : "capacities"}`;
  return null;
}

export function deleteLpTypes(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadLpType(inner, auth, id);
    const reason = lpTypeDeleteBlocker(inner, id);
    if (reason) throw new AppError("INVALID_STATE", `${row.code} ${reason}`);
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.code, warehouseId: row.warehouseId });
  });
}

/** Options for pickers: every type in scope, optionally one warehouse. */
export function lpTypeIdsInScope(db: AppDb, auth: AuthContext, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(db.select({ id: t.id }).from(t).where(and(inArray(t.id, [...ids]), listScope(t, auth))).all().map((r) => r.id));
}
