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
import { dbAll, dbGet } from "@/server/db/sql";

const v = s.vasOperations;
export const VAS_ENTITY = "vas_operation";

const vasTypeNameSql = sql<string>`(SELECT lv.name FROM lookup_values lv WHERE lv.id = vas_operations.vas_type_id)`;
const clientNameSql = sql<string>`(SELECT cl.name FROM clients cl WHERE cl.id = vas_operations.client_id)`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = vas_operations.warehouse_id)`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = vas_operations.created_by)`;
const billedSql = sql<string | null>`(SELECT br.bill_number FROM billing_reports br WHERE br.client_id = vas_operations.client_id AND br.warehouse_id = vas_operations.warehouse_id
  AND br.bill_status = 'Approved' AND br.calc_status = 'Successful' AND substr(vas_operations.operation_at, 1, 10) >= substr(br.period_start, 1, 10) AND substr(vas_operations.operation_at, 1, 10) <= substr(br.period_end, 1, 10) LIMIT 1)`;

const draftSql = sql<string | null>`(SELECT br.bill_number FROM billing_reports br WHERE br.client_id = vas_operations.client_id AND br.warehouse_id = vas_operations.warehouse_id
  AND br.bill_status = 'Draft' AND br.calc_status = 'Successful' AND substr(vas_operations.operation_at, 1, 10) >= substr(br.period_start, 1, 10) AND substr(vas_operations.operation_at, 1, 10) <= substr(br.period_end, 1, 10) LIMIT 1)`;

const BINDING: GridBinding = {
  exprs: {
    vasTypeId: sql`${v.vasTypeId}`, clientId: sql`${v.clientId}`, warehouseId: sql`${v.warehouseId}`, operationAt: sql`${v.operationAt}`, calculationType: sql`${v.calculationType}`,
    referenceOrderType: sql`${v.referenceOrderType}`, referenceNumber: sql`${v.referenceNumber}`, value: sql`${v.value}`, createdAt: sql`${v.createdAt}`, note: sql`${v.note}`, createdBy: sql`${v.createdBy}`,
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
  /** Draft bill whose period contains this operation: changing it makes that bill outdated. */
  readonly draftIn: string | null;
  readonly version: number;
}

const ROW = {
  id: v.id, vasTypeId: v.vasTypeId, vasTypeName: vasTypeNameSql, clientId: v.clientId, clientName: clientNameSql, warehouseId: v.warehouseId, warehouseCode: warehouseCodeSql,
  operationAt: v.operationAt, calculationType: v.calculationType, value: v.value, note: v.note, referenceOrderType: v.referenceOrderType, referenceNumber: v.referenceNumber,
  createdByName: createdByNameSql, createdAt: v.createdAt, billedIn: billedSql, draftIn: draftSql, version: v.version,
};

const scope = (auth: AuthContext): SQL | undefined => scopedWhere(v, auth.viewScope);

export async function listVas(db: AppDb, auth: AuthContext, query: GridQuery): Promise<{ rows: VasRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [scope(auth)]);
  const result = await paginate(db.select(ROW).from(v).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    async () => (await db.select({ n: sql<number>`count(*)` }).from(v).where(grid.where).limit(1))[0]?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: result.rows as VasRow[], total: result.total };
}

export async function loadVas(db: AppDb, auth: AuthContext, id: string): Promise<typeof v.$inferSelect> {
  const row = (await db.select().from(v).where(eq(v.id, id)).limit(1))[0];
  assertInScope(auth.scope, row, "VAS operation");
  return row!;
}

export async function getVas(db: AppDb, auth: AuthContext, id: string): Promise<VasRow> {
  await loadVas(db, auth, id);
  return (await db.select(ROW).from(v).where(eq(v.id, id)).limit(1))[0] as VasRow;
}

/** Users who created a VAS operation the caller can see (the Created by filter options). */
export async function vasCreators(db: AppDb, auth: AuthContext): Promise<{ id: string; name: string }[]> {
  return await db.selectDistinct({ id: s.users.id, name: s.users.name }).from(v).innerJoin(s.users, eq(s.users.id, v.createdBy))
    .where(scope(auth)).orderBy(s.users.name);
}

/** Global (NULL warehouse/client) lookups stay visible; scoped ones follow the user's scope. */
function lookupScope(auth: AuthContext): SQL | undefined {
  const lv = s.lookupValues;
  const wh = auth.scope.warehouseIds.length ? sql`(${lv.warehouseId} IS NULL OR ${inArray(lv.warehouseId, [...auth.scope.warehouseIds])})` : sql`${lv.warehouseId} IS NULL`;
  return and(wh, scopedWhere(lv, auth.scope, { clientId: lv.clientId }));
}

/** VAS types (Data Setup) with their calculation type, for the drawer and the fee form. */
export async function vasTypes(db: AppDb, auth: AuthContext): Promise<{ id: string; name: string; calculationType: (typeof v.$inferSelect)["calculationType"]; clientId: string | null; isActive: boolean }[]> {
  return (await db.select({ id: s.lookupValues.id, name: s.lookupValues.name, meta: s.lookupValues.meta, clientId: s.lookupValues.clientId, isActive: s.lookupValues.isActive })
    .from(s.lookupValues).where(and(eq(s.lookupValues.type, "vas_type"), lookupScope(auth)))
    .orderBy(s.lookupValues.sortOrder, s.lookupValues.name))
    .map((r) => ({ id: r.id, name: r.name, calculationType: vasCalculationType(r.meta), clientId: r.clientId, isActive: Boolean(r.isActive) }));
}

/**
 * Validates every field and throws once with all field errors, so the drawer can mark each
 * invalid field in one round trip. Returns the calculation type of the VAS type.
 */
async function validateVas(db: AppDb, auth: AuthContext, input: VasSave): Promise<(typeof v.$inferSelect)["calculationType"]> {
  const errors: Record<string, string[]> = {};
  const add = (field: string, msg: string) => { (errors[field] ??= []).push(msg); };
  if (!hasWarehouse(auth.scope, input.warehouseId)) add("warehouseId", "Choose a warehouse you have access to");
  if (!hasClient(auth.scope, input.clientId)) add("clientId", "Choose a client you have access to");
  else if (!(await db.select({ id: s.clients.id }).from(s.clients).where(eq(s.clients.id, input.clientId)).limit(1))[0]) add("clientId", "Choose a client");
  const lv = (await db.select().from(s.lookupValues).where(and(eq(s.lookupValues.id, input.vasTypeId), eq(s.lookupValues.type, "vas_type"))).limit(1))[0];
  if (!lv) add("vasTypeId", "Choose a VAS type");
  else if (lv.clientId && lv.clientId !== input.clientId) add("vasTypeId", "This VAS type belongs to another client");
  const ref = await referenceError(db, input);
  if (ref) add("referenceNumber", ref);
  const fields = Object.keys(errors);
  if (fields.length || !lv) {
    const first = errors[fields[0] ?? ""]?.[0] ?? "Check the highlighted fields";
    throw new AppError("VALIDATION", fields.length === 1 ? first : `${fields.length} fields need attention`, { fieldErrors: errors });
  }
  return vasCalculationType(lv.meta);
}

const REFERENCE_TABLES = { "Shipment Order": s.shipmentOrders, "Purchase Order": s.purchaseOrders, "Work Order": s.workOrders } as const;

type RefInput = Pick<VasSave, "clientId" | "warehouseId" | "referenceOrderType" | "referenceNumber">;

async function referenceError(db: AppDb, input: RefInput): Promise<string | null> {
  if (!input.referenceOrderType || !input.referenceNumber) return null;
  const t = REFERENCE_TABLES[input.referenceOrderType];
  const hit = (await db.select({ id: t.id }).from(t).where(and(eq(t.code, input.referenceNumber), eq(t.clientId, input.clientId), eq(t.warehouseId, input.warehouseId))).limit(1))[0];
  return hit ? null : `This ${input.referenceOrderType.toLowerCase()} does not exist for the selected client and warehouse`;
}

/** Reference order must exist for the same client and warehouse (Logiwa: "This shipment order does not exist"). */
export async function assertReference(db: AppDb, input: RefInput): Promise<void> {
  const msg = await referenceError(db, input);
  if (msg) throw new AppError("VALIDATION", msg, { fieldErrors: { referenceNumber: [msg] } });
}

/** Successful Draft bills whose period contains this operation (they go stale when it changes). */
export async function draftBillsFor(db: AppDb, row: { clientId: string; warehouseId: string; operationAt: string }): Promise<{ id: string; billNumber: string }[]> {
  const d = row.operationAt.slice(0, 10);
  return await dbAll<{ id: string; billNumber: string }>(db, sql`SELECT id, bill_number AS "billNumber" FROM billing_reports WHERE client_id = ${row.clientId} AND warehouse_id = ${row.warehouseId}
    AND bill_status = 'Draft' AND calc_status = 'Successful' AND ${d} >= substr(period_start, 1, 10) AND ${d} <= substr(period_end, 1, 10)`);
}

export const OUTDATED_FIELD = "outdated";

/**
 * Marks each Draft bill whose period the change touches as outdated: a change-log entry on the
 * bill, newer than its calculation (the next recalculation clears it). Returns the bill numbers.
 */
export async function markDraftsOutdated(tx: AppDb, ctx: { userId: string | null; source: string }, rows: readonly { clientId: string; warehouseId: string; operationAt: string }[], what: string, at: string = new Date().toISOString()): Promise<string[]> {
  const seen = new Map<string, string>();
  for (const row of rows) for (const b of await draftBillsFor(tx, row)) seen.set(b.id, b.billNumber);
  for (const [id, billNumber] of seen) {
    await tx.insert(s.changeLog).values({
      entityType: "billing_report", entityId: id, entityCode: billNumber, type: "Update", field: OUTDATED_FIELD, fieldLabel: "Outdated",
      fromValue: null, toValue: what, message: `Outdated: ${what} after calculation. Recalculate the bill to include it.`, userId: ctx.userId, source: ctx.source, at,
    });
  }
  return [...seen.values()];
}

/** Approved bill whose period contains this operation, if any. */
export async function billedIn(db: AppDb, row: { clientId: string; warehouseId: string; operationAt: string }): Promise<string | null> {
  const d = row.operationAt.slice(0, 10);
  return (await dbGet<{ n: string }>(db, sql`SELECT bill_number AS n FROM billing_reports WHERE client_id = ${row.clientId} AND warehouse_id = ${row.warehouseId}
    AND bill_status = 'Approved' AND calc_status = 'Successful' AND ${d} >= substr(period_start, 1, 10) AND ${d} <= substr(period_end, 1, 10) LIMIT 1`))?.n ?? null;
}

async function lockedBy(db: AppDb, row: { clientId: string; warehouseId: string; operationAt: string }): Promise<void> {
  const bill = await billedIn(db, row);
  if (bill) throw new AppError("INVALID_STATE", `Billed in approved bill ${bill}; cancel its approval first`);
}

async function snapshot(db: AppDb, row: typeof v.$inferSelect): Promise<Record<string, unknown>> {
  return {
    vasTypeId: (await namesOf(db, "lookup_values", [row.vasTypeId])).get(row.vasTypeId) ?? "", clientId: (await namesOf(db, "clients", [row.clientId])).get(row.clientId) ?? "",
    warehouseId: (await namesOf(db, "warehouses", [row.warehouseId])).get(row.warehouseId) ?? "", operationAt: row.operationAt, calculationType: row.calculationType, value: row.value,
    note: row.note ?? "", referenceOrderType: row.referenceOrderType ?? "", referenceNumber: row.referenceNumber ?? "",
  };
}

const iso = (value: string): string => new Date(value).toISOString();
const code = (row: { referenceNumber: string | null; operationAt: string }): string => row.referenceNumber ?? row.operationAt.slice(0, 10);

export async function createVas(tx: AppDb, auth: AuthContext, actor: Actor, input: VasSave): Promise<{ id: string; outdatedBills: string[] }> {
  const calculationType = await validateVas(tx, auth, input);
  const operationAt = iso(input.operationAt);
  await lockedBy(tx, { clientId: input.clientId, warehouseId: input.warehouseId, operationAt });
  const row = (await tx.insert(v).values({
    clientId: input.clientId, warehouseId: input.warehouseId, vasTypeId: input.vasTypeId, operationAt, calculationType, value: Math.round(input.value * 100) / 100,
    note: input.note, referenceOrderType: input.referenceNumber ? input.referenceOrderType ?? null : input.referenceOrderType ?? null, referenceNumber: input.referenceNumber,
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning())[0];
  const ctx = domainCtxOf(actor, auth);
  await logCreate(tx, ctx, VAS_ENTITY, row.id, code(row));
  return { id: row.id, outdatedBills: await markDraftsOutdated(tx, ctx, [row], `VAS operation ${code(row)} added`) };
}

export async function updateVas(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: VasSave): Promise<{ id: string; version: number; outdatedBills: string[] }> {
  const before = await loadVas(tx, auth, id);
  assertVersion(before.version, input.version);
  await lockedBy(tx, before);
  const calculationType = await validateVas(tx, auth, input);
  const operationAt = iso(input.operationAt);
  await lockedBy(tx, { clientId: input.clientId, warehouseId: input.warehouseId, operationAt });
  const after = (await tx.update(v).set({
    clientId: input.clientId, warehouseId: input.warehouseId, vasTypeId: input.vasTypeId, operationAt, calculationType, value: Math.round(input.value * 100) / 100, note: input.note,
    referenceOrderType: input.referenceOrderType ?? null, referenceNumber: input.referenceNumber, updatedBy: actor.userId, version: sql`${v.version} + 1`,
  }).where(eq(v.id, id)).returning())[0];
  const ctx = domainCtxOf(actor, auth);
  await logUpdate(tx, ctx, VAS_ENTITY, id, code(after), await snapshot(tx, before), await snapshot(tx, after));
  return { id, version: after.version, outdatedBills: await markDraftsOutdated(tx, ctx, [before, after], `VAS operation ${code(after)} changed`) };
}

export async function deleteVas(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadVas(inner, auth, id);
    await lockedBy(inner, row);
    await inner.delete(v).where(eq(v.id, id));
    await logDelete(inner, ctx, VAS_ENTITY, id, code(row));
    await markDraftsOutdated(inner, ctx, [row], `VAS operation ${code(row)} deleted`);
  });
}


