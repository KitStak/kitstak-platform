/**
 * VAS Operations repository (M11): grid, create / edit drawer (calculation type comes from
 * the Data Setup › VAS Type meta), delete. Operations inside an Approved bill's period are
 * locked so billed history can't drift.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasClient, hasWarehouse, scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { VAS_FIELDS, VAS_SEARCH_FIELDS, VAS_SORT_FIELDS, vasCalculationType, type VasSave } from "@/lib/grid-defs/organization/vas";
import { assertVersion, compileGrid, domainCtxOf, logCreate, logDelete, logUpdate, namesOf, type Actor, type GridBinding } from "./clients-shared";

const v = s.vasOperations;
export const VAS_ENTITY = "vas_operation";

const vasTypeNameSql = sql<string>`(SELECT lv.name FROM lookup_values lv WHERE lv.id = vas_operations.vas_type_id)`;
const clientNameSql = sql<string>`(SELECT cl.name FROM clients cl WHERE cl.id = vas_operations.client_id)`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = vas_operations.warehouse_id)`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = vas_operations.created_by)`;
const billedSql = sql<string | null>`(SELECT br.bill_number FROM billing_reports br WHERE br.client_id = vas_operations.client_id AND br.warehouse_id = vas_operations.warehouse_id
  AND br.bill_status = 'Approved' AND br.calc_status = 'Successful' AND substr(vas_operations.operation_at, 1, 10) >= substr(br.period_start, 1, 10) AND substr(vas_operations.operation_at, 1, 10) <= substr(br.period_end, 1, 10) LIMIT 1)`;

const BINDING: GridBinding = {
  exprs: {
    vasTypeId: sql`${v.vasTypeId}`, clientId: sql`${v.clientId}`, warehouseId: sql`${v.warehouseId}`, operationAt: sql`${v.operationAt}`, calculationType: sql`${v.calculationType}`,
    referenceOrderType: sql`${v.referenceOrderType}`, referenceNumber: sql`${v.referenceNumber}`, value: sql`${v.value}`, createdAt: sql`${v.createdAt}`, note: sql`${v.note}`,
    vasTypeName: vasTypeNameSql, clientName: clientNameSql, warehouseCode: warehouseCodeSql, createdByName: createdByNameSql,
  },
  fields: VAS_FIELDS, sortable: VAS_SORT_FIELDS, search: VAS_SEARCH_FIELDS,
  defaultSort: [{ field: "operationAt", dir: "desc" }], tiebreaker: v.id,
};

export interface VasRow {
  readonly id: string;
  readonly vasTypeId: string;
  readonly vasTypeName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly operationAt: string;
  readonly calculationType: (typeof v.$inferSelect)["calculationType"];
  readonly value: number;
  readonly note: string | null;
  readonly referenceOrderType: (typeof v.$inferSelect)["referenceOrderType"];
  readonly referenceNumber: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly billedIn: string | null;
  readonly version: number;
}

const ROW = {
  id: v.id, vasTypeId: v.vasTypeId, vasTypeName: vasTypeNameSql, clientId: v.clientId, clientName: clientNameSql, warehouseId: v.warehouseId, warehouseCode: warehouseCodeSql,
  operationAt: v.operationAt, calculationType: v.calculationType, value: v.value, note: v.note, referenceOrderType: v.referenceOrderType, referenceNumber: v.referenceNumber,
  createdByName: createdByNameSql, createdAt: v.createdAt, billedIn: billedSql, version: v.version,
};

const scope = (auth: AuthContext): SQL | undefined => scopedWhere(v, auth.viewScope);

export function listVas(db: AppDb, auth: AuthContext, query: GridQuery): { rows: VasRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [scope(auth)]);
  const result = paginate(db.select(ROW).from(v).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(v).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: result.rows as VasRow[], total: result.total };
}

export function loadVas(db: AppDb, auth: AuthContext, id: string): typeof v.$inferSelect {
  const row = db.select().from(v).where(eq(v.id, id)).get();
  assertInScope(auth.scope, row, "VAS operation");
  return row!;
}

export function getVas(db: AppDb, auth: AuthContext, id: string): VasRow {
  loadVas(db, auth, id);
  return db.select(ROW).from(v).where(eq(v.id, id)).get() as VasRow;
}

/** Global (NULL warehouse/client) lookups stay visible; scoped ones follow the user's scope. */
function lookupScope(auth: AuthContext): SQL | undefined {
  const lv = s.lookupValues;
  const wh = auth.scope.warehouseIds.length ? sql`(${lv.warehouseId} IS NULL OR ${inArray(lv.warehouseId, [...auth.scope.warehouseIds])})` : sql`${lv.warehouseId} IS NULL`;
  return and(wh, scopedWhere(lv, auth.scope, { clientId: lv.clientId }));
}

/** VAS types (Data Setup) with their calculation type, for the drawer and the fee form. */
export function vasTypes(db: AppDb, auth: AuthContext): { id: string; name: string; calculationType: (typeof v.$inferSelect)["calculationType"]; clientId: string | null; isActive: boolean }[] {
  return db.select({ id: s.lookupValues.id, name: s.lookupValues.name, meta: s.lookupValues.meta, clientId: s.lookupValues.clientId, isActive: s.lookupValues.isActive })
    .from(s.lookupValues).where(and(eq(s.lookupValues.type, "vas_type"), lookupScope(auth)))
    .orderBy(s.lookupValues.sortOrder, s.lookupValues.name).all()
    .map((r) => ({ id: r.id, name: r.name, calculationType: vasCalculationType(r.meta), clientId: r.clientId, isActive: Boolean(r.isActive) }));
}

function resolveType(db: AppDb, input: VasSave): (typeof v.$inferSelect)["calculationType"] {
  const lv = db.select().from(s.lookupValues).where(and(eq(s.lookupValues.id, input.vasTypeId), eq(s.lookupValues.type, "vas_type"))).get();
  if (!lv) throw new AppError("VALIDATION", "Choose a VAS type", { fieldErrors: { vasTypeId: ["Choose a VAS type"] } });
  if (lv.clientId && lv.clientId !== input.clientId) throw new AppError("VALIDATION", "This VAS type belongs to another client", { fieldErrors: { vasTypeId: ["This VAS type belongs to another client"] } });
  return vasCalculationType(lv.meta);
}

function assertWritable(db: AppDb, auth: AuthContext, input: VasSave): void {
  if (!hasWarehouse(auth.scope, input.warehouseId)) throw new AppError("VALIDATION", "Choose a warehouse you have access to", { fieldErrors: { warehouseId: ["Choose a warehouse you have access to"] } });
  if (!hasClient(auth.scope, input.clientId)) throw new AppError("VALIDATION", "Choose a client you have access to", { fieldErrors: { clientId: ["Choose a client you have access to"] } });
  const client = db.select({ status: s.clients.status }).from(s.clients).where(eq(s.clients.id, input.clientId)).get();
  if (!client) throw new AppError("VALIDATION", "Choose a client", { fieldErrors: { clientId: ["Choose a client"] } });
}

/** Approved bill whose period contains this operation, if any. */
export function billedIn(db: AppDb, row: { clientId: string; warehouseId: string; operationAt: string }): string | null {
  const d = row.operationAt.slice(0, 10);
  return db.get<{ n: string }>(sql`SELECT bill_number AS n FROM billing_reports WHERE client_id = ${row.clientId} AND warehouse_id = ${row.warehouseId}
    AND bill_status = 'Approved' AND calc_status = 'Successful' AND ${d} >= substr(period_start, 1, 10) AND ${d} <= substr(period_end, 1, 10) LIMIT 1`)?.n ?? null;
}

function lockedBy(db: AppDb, row: { clientId: string; warehouseId: string; operationAt: string }): void {
  const bill = billedIn(db, row);
  if (bill) throw new AppError("INVALID_STATE", `Billed in approved bill ${bill}; cancel its approval first`);
}

function snapshot(db: AppDb, row: typeof v.$inferSelect): Record<string, unknown> {
  return {
    vasTypeId: namesOf(db, "lookup_values", [row.vasTypeId]).get(row.vasTypeId) ?? "", clientId: namesOf(db, "clients", [row.clientId]).get(row.clientId) ?? "",
    warehouseId: namesOf(db, "warehouses", [row.warehouseId]).get(row.warehouseId) ?? "", operationAt: row.operationAt, calculationType: row.calculationType, value: row.value,
    note: row.note ?? "", referenceOrderType: row.referenceOrderType ?? "", referenceNumber: row.referenceNumber ?? "",
  };
}

const iso = (value: string): string => new Date(value).toISOString();
const code = (row: { referenceNumber: string | null; operationAt: string }): string => row.referenceNumber ?? row.operationAt.slice(0, 10);

export function createVas(tx: AppDb, auth: AuthContext, actor: Actor, input: VasSave): { id: string } {
  assertWritable(tx, auth, input);
  const calculationType = resolveType(tx, input);
  const operationAt = iso(input.operationAt);
  lockedBy(tx, { clientId: input.clientId, warehouseId: input.warehouseId, operationAt });
  const row = tx.insert(v).values({
    clientId: input.clientId, warehouseId: input.warehouseId, vasTypeId: input.vasTypeId, operationAt, calculationType, value: Math.round(input.value * 100) / 100,
    note: input.note, referenceOrderType: input.referenceNumber ? input.referenceOrderType ?? null : input.referenceOrderType ?? null, referenceNumber: input.referenceNumber,
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning().get();
  logCreate(tx, domainCtxOf(actor, auth), VAS_ENTITY, row.id, code(row));
  return { id: row.id };
}

export function updateVas(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: VasSave): { id: string; version: number } {
  const before = loadVas(tx, auth, id);
  assertVersion(before.version, input.version);
  lockedBy(tx, before);
  assertWritable(tx, auth, input);
  const calculationType = resolveType(tx, input);
  const operationAt = iso(input.operationAt);
  lockedBy(tx, { clientId: input.clientId, warehouseId: input.warehouseId, operationAt });
  const after = tx.update(v).set({
    clientId: input.clientId, warehouseId: input.warehouseId, vasTypeId: input.vasTypeId, operationAt, calculationType, value: Math.round(input.value * 100) / 100, note: input.note,
    referenceOrderType: input.referenceOrderType ?? null, referenceNumber: input.referenceNumber, updatedBy: actor.userId, version: sql`${v.version} + 1`,
  }).where(eq(v.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), VAS_ENTITY, id, code(after), snapshot(tx, before), snapshot(tx, after));
  return { id, version: after.version };
}

export function deleteVas(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadVas(inner, auth, id);
    lockedBy(inner, row);
    inner.delete(v).where(eq(v.id, id)).run();
    logDelete(inner, ctx, VAS_ENTITY, id, code(row));
  });
}


