/**
 * LP Numbers repository (M10): grid, detail (contents), create From Sequence (type prefix +
 * zero-pad, or GS1 SSCC-18 per client) or Custom Numbers, edit with Logiwa's field locks,
 * and label records for Print Barcode (marks the labels printed).
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { nextLpNumber, nextValue } from "@/server/domain/sequences";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { round } from "@/lib/grid-defs/facility/common";
import { buildSscc18, companyPrefixFor, LP_NUMBER_FIELDS, LP_NUMBER_SEARCH_FIELDS, LP_NUMBER_SORT_FIELDS, type LpCreate, type LpUpdateInput } from "@/lib/grid-defs/facility/lp-numbers";
import { assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, listScope, logCreate, logUpdate, type Actor, type GridBinding, qc } from "./locations-shared";

const lp = s.licensePlates;
const ENTITY = "license_plate";
/** SSCC extension digit used for every KitStaks-issued SSCC (0 = carton). */
const SSCC_EXTENSION = 0;

const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(lp.warehouseId)})`;
const lpTypeCodeSql = sql<string>`(SELECT t.code FROM lp_types t WHERE t.id = ${qc(lp.lpTypeId)})`;
const locationCodeSql = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${qc(lp.locationId)})`;
const parentSql = sql<string | null>`(SELECT p.number FROM license_plates p WHERE p.id = ${qc(lp.parentLpId)})`;
const clientSql = sql<string | null>`(SELECT c.code FROM clients c WHERE c.id = ${qc(lp.clientId)})`;
const unitsSql = sql<number>`COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.lp_id = ${qc(lp.id)}), 0)`;

export const LP_NUMBER_SQL: Readonly<Record<string, SQL>> = {
  number: sql`${lp.number}`,
  warehouseId: sql`${lp.warehouseId}`,
  warehouseCode: warehouseCodeSql,
  lpTypeId: sql`${lp.lpTypeId}`,
  lpTypeCode: lpTypeCodeSql,
  locationCode: locationCodeSql,
  status: sql`${lp.status}`,
  length: sql`${lp.length}`,
  width: sql`${lp.width}`,
  height: sql`${lp.height}`,
  weight: sql`${lp.weight}`,
  actualVolume: sql`${lp.actualVolume}`,
  parentLpNumber: parentSql,
  originalNumber: sql`${lp.originalNumber}`,
  alternateBarcode: sql`${lp.alternateBarcode}`,
  isSscc18: sql`${lp.isSscc18}`,
  labelPrinted: sql`CASE WHEN ${lp.labelPrintedAt} IS NULL THEN 0 ELSE 1 END`,
  createdAt: sql`${lp.createdAt}`,
};

const BINDING: GridBinding = {
  exprs: LP_NUMBER_SQL, fields: LP_NUMBER_FIELDS, sortable: LP_NUMBER_SORT_FIELDS, search: LP_NUMBER_SEARCH_FIELDS,
  defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: lp.number,
};

export interface LpNumberRow {
  readonly id: string;
  readonly number: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly lpTypeId: string;
  readonly lpTypeCode: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly status: "Empty" | "Occupied" | "Shipped" | "Removed";
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly weight: number;
  readonly actualVolume: number;
  readonly parentLpNumber: string | null;
  readonly originalNumber: string | null;
  readonly alternateBarcode: string | null;
  readonly isSscc18: boolean;
  readonly clientCode: string | null;
  readonly units: number;
  readonly labelPrintedAt: string | null;
  readonly createdAt: string;
  readonly version: number;
}

function selection() {
  return {
    id: lp.id, number: lp.number, warehouseId: lp.warehouseId, warehouseCode: warehouseCodeSql, lpTypeId: lp.lpTypeId, lpTypeCode: lpTypeCodeSql,
    locationId: lp.locationId, locationCode: locationCodeSql, status: lp.status, length: lp.length, width: lp.width, height: lp.height, weight: lp.weight,
    actualVolume: lp.actualVolume, parentLpNumber: parentSql, originalNumber: lp.originalNumber, alternateBarcode: lp.alternateBarcode, isSscc18: lp.isSscc18,
    clientCode: clientSql, units: unitsSql, labelPrintedAt: lp.labelPrintedAt, createdAt: lp.createdAt, version: lp.version,
  };
}

export function listLpNumbers(db: AppDb, auth: AuthContext, query: GridQuery): { rows: LpNumberRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [listScope(lp, auth, { warehouseId: lp.warehouseId })]);
  const result = paginate(
    db.select(selection()).from(lp).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(lp).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: result.rows.map((r) => ({ ...r, isSscc18: Boolean(r.isSscc18) })) as LpNumberRow[], total: result.total };
}

export function loadLp(db: AppDb, auth: AuthContext, id: string): typeof lp.$inferSelect {
  const row = assertFound(db.select().from(lp).where(eq(lp.id, id)).get(), "LP number");
  assertWarehouseInScope(auth, row.warehouseId, "LP number");
  return row;
}

export function getLpNumber(db: AppDb, auth: AuthContext, id: string) {
  loadLp(db, auth, id);
  const row = db.select(selection()).from(lp).where(eq(lp.id, id)).get() as LpNumberRow;
  const contents = db.select({ id: s.inventory.id, sku: s.products.sku, productName: s.products.name, onHand: s.inventory.onHand, allocated: s.inventory.allocated, lotNumber: s.inventory.lotNumber, expiryDate: s.inventory.expiryDate })
    .from(s.inventory).innerJoin(s.products, eq(s.products.id, s.inventory.productId))
    .where(and(eq(s.inventory.lpId, id), sql`${s.inventory.onHand} > 0`)).all();
  const children = db.select({ id: lp.id, number: lp.number, status: lp.status }).from(lp).where(eq(lp.parentLpId, id)).limit(200).all();
  return { ...row, isSscc18: Boolean(row.isSscc18), contents, children };
}

export type LpNumberDetail = ReturnType<typeof getLpNumber>;

/* ---------------- create ---------------- */

function assertNumberFree(db: AppDb, warehouseId: string, number: string, field = "number"): void {
  const clash = db.select({ id: lp.id }).from(lp).where(and(eq(lp.warehouseId, warehouseId), sql`upper(${lp.number}) = upper(${number})`)).get();
  if (clash) throw duplicateError(field, `LP number ${number} already exists in this warehouse`);
}

function resolveLocation(db: AppDb, warehouseId: string, locationId: string | null): string | null {
  if (locationId) {
    const loc = db.select({ warehouseId: s.locations.warehouseId }).from(s.locations).where(eq(s.locations.id, locationId)).get();
    if (!loc || loc.warehouseId !== warehouseId) throw new AppError("VALIDATION", "Pick a location of this warehouse", { fieldErrors: { locationId: ["Pick a location of this warehouse"] } });
    return locationId;
  }
  return db.select({ id: s.warehouses.defaultReceivingLocationId }).from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).get()?.id ?? null;
}

export interface LpCreateResult {
  readonly created: number;
  readonly ids: readonly string[];
  readonly numbers: readonly string[];
}

export function createLpNumbers(tx: AppDb, auth: AuthContext, actor: Actor, input: LpCreate): LpCreateResult {
  assertWarehouseInScope(auth, input.warehouseId);
  const type = tx.select().from(s.lpTypes).where(eq(s.lpTypes.id, input.lpTypeId)).get();
  if (!type || type.warehouseId !== input.warehouseId) throw new AppError("VALIDATION", "Pick an LP type of this warehouse", { fieldErrors: { lpTypeId: ["Pick an LP type of this warehouse"] } });
  const locationId = resolveLocation(tx, input.warehouseId, input.locationId);
  let clientId: string | null = null;
  let clientCode = "";
  if (input.isSscc18 && input.method === "sequence") {
    const client = input.clientId ? tx.select({ id: s.clients.id, code: s.clients.code }).from(s.clients).where(eq(s.clients.id, input.clientId)).get() : undefined;
    if (!client || !hasClient(auth.scope, client.id)) throw new AppError("VALIDATION", "Client is required for SSCC18 numbers", { fieldErrors: { clientId: ["Client is required for SSCC18 numbers"] } });
    clientId = client.id;
    clientCode = client.code;
  }
  const ctx = domainCtxOf(actor, auth);
  const numbers: string[] = [];
  const ids: string[] = [];
  const insert = (number: string, extra: Partial<typeof lp.$inferInsert> = {}) => {
    const row = tx.insert(lp).values({
      number, warehouseId: input.warehouseId, lpTypeId: type.id, locationId, clientId, status: "Empty",
      length: type.length, width: type.width, height: type.height, weight: type.emptyWeight, createdBy: actor.userId, updatedBy: actor.userId, ...extra,
    }).returning({ id: lp.id }).get();
    logCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: number });
    numbers.push(number);
    ids.push(row.id);
  };

  if (input.method === "custom") {
    const number = (input.number ?? "").trim().toUpperCase();
    assertNumberFree(tx, input.warehouseId, number);
    if (input.alternateBarcode) {
      const alt = tx.select({ id: lp.id }).from(lp).where(and(eq(lp.warehouseId, input.warehouseId), eq(lp.alternateBarcode, input.alternateBarcode))).get();
      if (alt) throw duplicateError("alternateBarcode", `Alternate barcode ${input.alternateBarcode} is already used`);
    }
    insert(number, { alternateBarcode: input.alternateBarcode });
    return { created: 1, ids, numbers };
  }

  const count = input.count ?? 1;
  for (let i = 0; i < count; i += 1) {
    let number = "";
    // Skip numbers that already exist (e.g. created as custom numbers or imported).
    for (let guard = 0; guard < 1000; guard += 1) {
      number = input.isSscc18 ? buildSscc18(SSCC_EXTENSION, companyPrefixFor(clientCode), nextValue(tx, `sscc:${clientId}`)) : nextLpNumber(tx, type.id);
      const exists = tx.select({ id: lp.id }).from(lp).where(and(eq(lp.warehouseId, input.warehouseId), eq(lp.number, number))).get();
      if (!exists) break;
    }
    insert(number, { isSscc18: input.isSscc18 });
  }
  return { created: count, ids, numbers };
}

/* ---------------- update ---------------- */

/** Which edit-drawer fields are locked for this LP (Logiwa: warehouse, type, location always). */
export function lpLocks(row: Pick<typeof lp.$inferSelect, "status" | "isSscc18">): { number: string | null; isSscc18: string | null } {
  const busy = row.status === "Occupied" ? "The LP holds stock" : row.status === "Shipped" ? "The LP has shipped" : null;
  return {
    number: busy ? `${busy}; its number can't change` : row.isSscc18 ? "SSCC18 numbers are issued by the GS1 sequence" : null,
    isSscc18: busy ? `${busy}; the SSCC18 flag can't change` : null,
  };
}

export function updateLpNumber(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: LpUpdateInput): { id: string; number: string; version: number } {
  const before = loadLp(tx, auth, id);
  assertVersion(before.version, input.version);
  const locks = lpLocks(before);
  const number = input.number.trim().toUpperCase();
  if (number !== before.number) {
    if (locks.number) throw new AppError("VALIDATION", locks.number, { fieldErrors: { number: [locks.number] } });
    assertNumberFree(tx, before.warehouseId, number);
  }
  if (input.isSscc18 !== before.isSscc18 && locks.isSscc18) throw new AppError("VALIDATION", locks.isSscc18, { fieldErrors: { isSscc18: [locks.isSscc18] } });
  const patch = {
    number, alternateBarcode: input.alternateBarcode ?? null, length: round(input.length), width: round(input.width), height: round(input.height),
    weight: round(input.weight), actualVolume: round(input.actualVolume, 3), isSscc18: input.isSscc18,
    originalNumber: number !== before.number ? before.originalNumber ?? before.number : before.originalNumber,
  };
  const after = tx.update(lp).set({ ...patch, updatedBy: actor.userId, version: sql`${lp.version} + 1` }).where(eq(lp.id, id)).returning().get();
  const pick = (r: typeof lp.$inferSelect) => ({ number: r.number, alternateBarcode: r.alternateBarcode ?? "", length: r.length, width: r.width, height: r.height, weight: r.weight, actualVolume: r.actualVolume, isSscc18: r.isSscc18, originalNumber: r.originalNumber ?? "" });
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: after.number }, pick(before), pick(after));
  return { id, number: after.number, version: after.version };
}

/* ---------------- labels ---------------- */

export function lpLabelRecords(tx: AppDb, auth: AuthContext, ids: readonly string[]) {
  const rows = tx.select({ id: lp.id, number: lp.number, lpType: lpTypeCodeSql, warehouseCode: warehouseCodeSql, locationCode: locationCodeSql, clientName: sql<string | null>`(SELECT c.name FROM clients c WHERE c.id = ${qc(lp.clientId)})` })
    .from(lp).where(and(inArray(lp.id, [...ids]), listScope(lp, auth, { warehouseId: lp.warehouseId }))).orderBy(lp.number).all();
  if (rows.length === 0) throw new AppError("NOT_FOUND", "None of the selected LP numbers were found");
  tx.update(lp).set({ labelPrintedAt: new Date().toISOString() }).where(inArray(lp.id, rows.map((r) => r.id))).run();
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    ...(r.lpType ? { lpType: r.lpType } : {}),
    ...(r.warehouseCode ? { warehouseCode: r.warehouseCode } : {}),
    ...(r.locationCode ? { locationCode: r.locationCode } : {}),
    ...(r.clientName ? { clientName: r.clientName } : {}),
  }));
}
