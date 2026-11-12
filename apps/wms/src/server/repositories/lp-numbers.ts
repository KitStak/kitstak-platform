/**
 * LP Numbers repository (M10): grid, detail (contents), create From Sequence (type prefix +
 * zero-pad, or GS1 SSCC-18 per client) or Custom Numbers, edit with Logiwa's field locks,
 * and label records for Print Barcode (marks the labels printed).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { nextLpNumber, nextValue } from '@/server/domain/sequences';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import { round } from '@/lib/grid-defs/facility/common';
import {
  buildSscc18,
  companyPrefixFor,
  LP_NUMBER_FIELDS,
  LP_NUMBER_SEARCH_FIELDS,
  LP_NUMBER_SORT_FIELDS,
  type LpCreate,
  type LpUpdateInput,
} from '@/lib/grid-defs/facility/lp-numbers';
import {
  assertFound,
  assertVersion,
  assertWarehouseInScope,
  compileGrid,
  domainCtxOf,
  duplicateError,
  listScope,
  logCreate,
  logDelete,
  logUpdate,
  type Actor,
  type GridBinding,
  qc,
} from './locations-shared';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { dbGet, filterSeq, mapSeq } from '@/server/db/sql';

const lp = s.licensePlates;
const ENTITY = 'license_plate';
/** SSCC extension digit used for every KitStaks-issued SSCC (0 = carton). */
const SSCC_EXTENSION = 0;

const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(lp.warehouseId)})`;
const lpTypeCodeSql = sql<string>`(SELECT t.code FROM lp_types t WHERE t.id = ${qc(lp.lpTypeId)})`;
const locationCodeSql = sql<
  string | null
>`(SELECT l.code FROM locations l WHERE l.id = ${qc(lp.locationId)})`;
const parentSql = sql<
  string | null
>`(SELECT p.number FROM license_plates p WHERE p.id = ${qc(lp.parentLpId)})`;
const parentTypeSql = sql<
  string | null
>`(SELECT t.code FROM license_plates p JOIN lp_types t ON t.id = p.lp_type_id WHERE p.id = ${qc(lp.parentLpId)})`;
const clientSql = sql<string | null>`(SELECT c.code FROM clients c WHERE c.id = ${qc(lp.clientId)})`;
const unitsSql = sql<number>`COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.lp_id = ${qc(lp.id)}), 0)`;

/*
 * Effective dimensions (critic R4: LPs created from packing showed 0 × 0 × 0 / 0.00 while siblings of the
 * same type showed 24 × 16 × 12). An LP with no dimensions of its own inherits its LP type's, an LP with no
 * weight inherits the type's empty weight, and Actual volume is L × W × H unless a measured volume was saved.
 */
const typeCol = (col: 'length' | 'width' | 'height' | 'empty_weight') =>
  sql`(SELECT t.${sql.raw(col)} FROM lp_types t WHERE t.id = ${qc(lp.lpTypeId)})`;
const dimsUnset = sql`(${qc(lp.length)} = 0 AND ${qc(lp.width)} = 0 AND ${qc(lp.height)} = 0)`;
const effDim = (own: Parameters<typeof qc>[0], col: 'length' | 'width' | 'height') =>
  sql<number>`CASE WHEN ${dimsUnset} THEN COALESCE(${typeCol(col)}, 0) ELSE ${qc(own)} END`;
const lengthSql = effDim(lp.length, 'length');
const widthSql = effDim(lp.width, 'width');
const heightSql = effDim(lp.height, 'height');
const weightSql = sql<number>`CASE WHEN ${qc(lp.weight)} = 0 THEN COALESCE(${typeCol('empty_weight')}, 0) ELSE ${qc(lp.weight)} END`;
const volumeSql = sql<number>`CASE WHEN ${qc(lp.actualVolume)} > 0 THEN ${qc(lp.actualVolume)} ELSE ROUND((${lengthSql} * ${widthSql} * ${heightSql})::numeric, 3)::float8 END`;

export const LP_NUMBER_SQL: Readonly<Record<string, SQL>> = {
  number: sql`${lp.number}`,
  warehouseId: sql`${lp.warehouseId}`,
  warehouseCode: warehouseCodeSql,
  lpTypeId: sql`${lp.lpTypeId}`,
  lpTypeCode: lpTypeCodeSql,
  locationCode: locationCodeSql,
  status: sql`${lp.status}`,
  length: lengthSql,
  width: widthSql,
  height: heightSql,
  weight: weightSql,
  actualVolume: volumeSql,
  parentLpNumber: parentSql,
  parentLpTypeCode: parentTypeSql,
  originalNumber: sql`${lp.originalNumber}`,
  alternateBarcode: sql`${lp.alternateBarcode}`,
  isSscc18: sql`${lp.isSscc18}`,
  labelPrinted: sql`CASE WHEN ${lp.labelPrintedAt} IS NULL THEN 0 ELSE 1 END`,
  createdAt: sql`${lp.createdAt}`,
};

const BINDING: GridBinding = {
  exprs: LP_NUMBER_SQL,
  fields: LP_NUMBER_FIELDS,
  sortable: LP_NUMBER_SORT_FIELDS,
  search: LP_NUMBER_SEARCH_FIELDS,
  defaultSort: [{ field: 'createdAt', dir: 'desc' }],
  tiebreaker: lp.number,
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
  readonly status: 'Empty' | 'Occupied' | 'Shipped' | 'Removed';
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly weight: number;
  readonly actualVolume: number;
  readonly parentLpNumber: string | null;
  readonly parentLpTypeCode: string | null;
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
    id: lp.id,
    number: lp.number,
    warehouseId: lp.warehouseId,
    warehouseCode: warehouseCodeSql,
    lpTypeId: lp.lpTypeId,
    lpTypeCode: lpTypeCodeSql,
    locationId: lp.locationId,
    locationCode: locationCodeSql,
    status: lp.status,
    length: lengthSql,
    width: widthSql,
    height: heightSql,
    weight: weightSql,
    actualVolume: volumeSql,
    parentLpNumber: parentSql,
    parentLpTypeCode: parentTypeSql,
    originalNumber: lp.originalNumber,
    alternateBarcode: lp.alternateBarcode,
    isSscc18: lp.isSscc18,
    clientCode: clientSql,
    units: unitsSql,
    labelPrintedAt: lp.labelPrintedAt,
    createdAt: lp.createdAt,
    version: lp.version,
  };
}

export async function listLpNumbers(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: LpNumberRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [listScope(lp, auth, { warehouseId: lp.warehouseId })]);
  const result = await paginate(
    db
      .select(selection())
      .from(lp)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(lp)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return {
    rows: result.rows.map((r) => ({ ...r, isSscc18: Boolean(r.isSscc18) })) as LpNumberRow[],
    total: result.total,
  };
}

export async function loadLp(db: AppDb, auth: AuthContext, id: string): Promise<typeof lp.$inferSelect> {
  const row = assertFound((await db.select().from(lp).where(eq(lp.id, id)).limit(1))[0], 'LP number');
  assertWarehouseInScope(auth, row.warehouseId, 'LP number');
  return row;
}

export async function getLpNumber(db: AppDb, auth: AuthContext, id: string) {
  await loadLp(db, auth, id);
  const row = (await db.select(selection()).from(lp).where(eq(lp.id, id)).limit(1))[0] as LpNumberRow;
  const contents = await db
    .select({
      id: s.inventory.id,
      sku: s.products.sku,
      productName: s.products.name,
      onHand: s.inventory.onHand,
      allocated: s.inventory.allocated,
      lotNumber: s.inventory.lotNumber,
      expiryDate: s.inventory.expiryDate,
    })
    .from(s.inventory)
    .innerJoin(s.products, eq(s.products.id, s.inventory.productId))
    .where(and(eq(s.inventory.lpId, id), sql`${s.inventory.onHand} > 0`));
  const children = await db
    .select({ id: lp.id, number: lp.number, status: lp.status })
    .from(lp)
    .where(eq(lp.parentLpId, id))
    .limit(200);
  return { ...row, isSscc18: Boolean(row.isSscc18), contents, children };
}

export type LpNumberDetail = Awaited<ReturnType<typeof getLpNumber>>;

/* ---------------- create ---------------- */

async function assertNumberFree(
  db: AppDb,
  warehouseId: string,
  number: string,
  field = 'number',
): Promise<void> {
  const clash = (
    await db
      .select({ id: lp.id })
      .from(lp)
      .where(and(eq(lp.warehouseId, warehouseId), sql`upper(${lp.number}) = upper(${number})`))
      .limit(1)
  )[0];
  if (clash) throw duplicateError(field, `LP number ${number} already exists in this warehouse`);
}

async function resolveLocation(
  db: AppDb,
  warehouseId: string,
  locationId: string | null,
): Promise<string | null> {
  if (locationId) {
    const loc = (
      await db
        .select({ warehouseId: s.locations.warehouseId })
        .from(s.locations)
        .where(eq(s.locations.id, locationId))
        .limit(1)
    )[0];
    if (!loc || loc.warehouseId !== warehouseId)
      throw new AppError('VALIDATION', 'Pick a location of this warehouse', {
        fieldErrors: { locationId: ['Pick a location of this warehouse'] },
      });
    return locationId;
  }
  return (
    (
      await db
        .select({ id: s.warehouses.defaultReceivingLocationId })
        .from(s.warehouses)
        .where(eq(s.warehouses.id, warehouseId))
        .limit(1)
    )[0]?.id ?? null
  );
}

export interface LpCreateResult {
  readonly created: number;
  readonly ids: readonly string[];
  readonly numbers: readonly string[];
}

export async function createLpNumbers(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: LpCreate,
): Promise<LpCreateResult> {
  assertWarehouseInScope(auth, input.warehouseId);
  const type = (await tx.select().from(s.lpTypes).where(eq(s.lpTypes.id, input.lpTypeId)).limit(1))[0];
  if (!type || type.warehouseId !== input.warehouseId)
    throw new AppError('VALIDATION', 'Pick an LP type of this warehouse', {
      fieldErrors: { lpTypeId: ['Pick an LP type of this warehouse'] },
    });
  const locationId = await resolveLocation(tx, input.warehouseId, input.locationId);
  let clientId: string | null = null;
  let clientCode = '';
  const sscc = input.isSscc18 && input.method === 'sequence';
  // Client: required for SSCC18 (its GS1 prefix), optional otherwise to pre-assign the LPs (Logiwa shows it in From Sequence mode).
  if (sscc || input.clientId) {
    const client = input.clientId
      ? (
          await tx
            .select({ id: s.clients.id, code: s.clients.code })
            .from(s.clients)
            .where(eq(s.clients.id, input.clientId))
            .limit(1)
        )[0]
      : undefined;
    if (!client || !hasClient(auth.scope, client.id)) {
      const message = sscc ? 'Client is required for SSCC18 numbers' : 'Pick a client you have access to';
      throw new AppError('VALIDATION', message, { fieldErrors: { clientId: [message] } });
    }
    clientId = client.id;
    clientCode = client.code;
  }
  const ctx = domainCtxOf(actor, auth);
  const numbers: string[] = [];
  const ids: string[] = [];
  const insert = async (number: string, extra: Partial<typeof lp.$inferInsert> = {}) => {
    const row = (
      await tx
        .insert(lp)
        .values({
          number,
          warehouseId: input.warehouseId,
          lpTypeId: type.id,
          locationId,
          clientId,
          status: 'Empty',
          length: type.length,
          width: type.width,
          height: type.height,
          weight: type.emptyWeight,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          ...extra,
        })
        .returning({ id: lp.id })
    )[0];
    await logCreate(tx, ctx, { entityType: ENTITY, entityId: row.id, entityCode: number });
    numbers.push(number);
    ids.push(row.id);
  };

  if (input.method === 'custom') {
    const number = (input.number ?? '').trim().toUpperCase();
    await assertNumberFree(tx, input.warehouseId, number);
    if (input.alternateBarcode) {
      const alt = (
        await tx
          .select({ id: lp.id })
          .from(lp)
          .where(and(eq(lp.warehouseId, input.warehouseId), eq(lp.alternateBarcode, input.alternateBarcode)))
          .limit(1)
      )[0];
      if (alt)
        throw duplicateError(
          'alternateBarcode',
          `Alternate barcode ${input.alternateBarcode} is already used`,
        );
    }
    await insert(number, { alternateBarcode: input.alternateBarcode });
    return { created: 1, ids, numbers };
  }

  const count = input.count ?? 1;
  for (let i = 0; i < count; i += 1) {
    let number = '';
    // Skip numbers that already exist (e.g. created as custom numbers or imported).
    for (let guard = 0; guard < 1000; guard += 1) {
      number = input.isSscc18
        ? buildSscc18(SSCC_EXTENSION, companyPrefixFor(clientCode), await nextValue(tx, `sscc:${clientId}`))
        : await nextLpNumber(tx, type.id);
      const exists = (
        await tx
          .select({ id: lp.id })
          .from(lp)
          .where(and(eq(lp.warehouseId, input.warehouseId), eq(lp.number, number)))
          .limit(1)
      )[0];
      if (!exists) break;
    }
    await insert(number, { isSscc18: input.isSscc18 });
  }
  return { created: count, ids, numbers };
}

/* ---------------- update ---------------- */

/** Which edit-drawer fields are locked for this LP (Logiwa: warehouse, type, location always). */
export function lpLocks(row: Pick<typeof lp.$inferSelect, 'status' | 'isSscc18'>): {
  number: string | null;
  isSscc18: string | null;
} {
  const busy =
    row.status === 'Occupied' ? 'The LP holds stock' : row.status === 'Shipped' ? 'The LP has shipped' : null;
  return {
    number: busy
      ? `${busy}; its number can't change`
      : row.isSscc18
        ? 'SSCC18 numbers are issued by the GS1 sequence'
        : null,
    isSscc18: busy ? `${busy}; the SSCC18 flag can't change` : null,
  };
}

export async function updateLpNumber(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  input: LpUpdateInput,
): Promise<{ id: string; number: string; version: number }> {
  const before = await loadLp(tx, auth, id);
  assertVersion(before.version, input.version);
  const locks = lpLocks(before);
  const number = input.number.trim().toUpperCase();
  if (number !== before.number) {
    if (locks.number)
      throw new AppError('VALIDATION', locks.number, { fieldErrors: { number: [locks.number] } });
    await assertNumberFree(tx, before.warehouseId, number);
  }
  if (input.isSscc18 !== before.isSscc18 && locks.isSscc18)
    throw new AppError('VALIDATION', locks.isSscc18, { fieldErrors: { isSscc18: [locks.isSscc18] } });
  const patch = {
    number,
    alternateBarcode: input.alternateBarcode ?? null,
    length: round(input.length),
    width: round(input.width),
    height: round(input.height),
    weight: round(input.weight),
    actualVolume: round(input.actualVolume, 3),
    isSscc18: input.isSscc18,
    originalNumber:
      number !== before.number ? (before.originalNumber ?? before.number) : before.originalNumber,
  };
  const after = (
    await tx
      .update(lp)
      .set({ ...patch, updatedBy: actor.userId, version: sql`${lp.version} + 1` })
      .where(eq(lp.id, id))
      .returning()
  )[0];
  const pick = (r: typeof lp.$inferSelect) => ({
    number: r.number,
    alternateBarcode: r.alternateBarcode ?? '',
    length: r.length,
    width: r.width,
    height: r.height,
    weight: r.weight,
    actualVolume: r.actualVolume,
    isSscc18: r.isSscc18,
    originalNumber: r.originalNumber ?? '',
  });
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: ENTITY, entityId: id, entityCode: after.number },
    pick(before),
    pick(after),
  );
  return { id, number: after.number, version: after.version };
}

/* ---------------- delete / void ---------------- */

/**
 * Raw-SQL probes for every place an LP id is recorded without a foreign key. A hit means the LP
 * carries history: it is voided (status Removed, kept for the audit trail) instead of deleted.
 */
const LP_HISTORY_PROBES: readonly { readonly label: string; readonly where: (id: string) => SQL }[] = [
  { label: 'inventory buckets', where: (id) => sql`SELECT 1 FROM inventory WHERE lp_id = ${id}` },
  {
    label: 'stock movements',
    where: (id) =>
      sql`SELECT 1 FROM inventory_transactions WHERE from_lp_id = ${id} OR to_lp_id = ${id} OR from_parent_lp_id = ${id} OR to_parent_lp_id = ${id}`,
  },
  {
    label: 'receipts',
    where: (id) => sql`SELECT 1 FROM receipts WHERE lp_id = ${id} OR parent_lp_id = ${id}`,
  },
  {
    label: 'tasks',
    where: (id) => sql`SELECT 1 FROM tasks WHERE source_lp_id = ${id} OR target_lp_id = ${id}`,
  },
  { label: 'shipments', where: (id) => sql`SELECT 1 FROM shipments WHERE parent_lp_id = ${id}` },
  {
    label: 'count lines',
    where: (id) =>
      sql`SELECT 1 FROM count_plan_lines WHERE lp_id = ${id} UNION ALL SELECT 1 FROM count_line_entries WHERE lp_id = ${id}`,
  },
  { label: 'work orders', where: (id) => sql`SELECT 1 FROM work_order_components WHERE lp_id = ${id}` },
  { label: 'order lines', where: (id) => sql`SELECT 1 FROM order_lines WHERE pinned_lp_id = ${id}` },
  {
    label: 'snapshots',
    where: (id) => sql`SELECT 1 FROM inventory_snapshots WHERE lp_id = ${id} OR parent_lp_id = ${id}`,
  },
  { label: 'missing log', where: (id) => sql`SELECT 1 FROM missing_log WHERE lp_id = ${id}` },
];

export interface LpRemovalFacts {
  readonly status: LpNumberRow['status'];
  readonly units: number;
  readonly parentNumber: string | null;
  readonly childCount: number;
  /** Where the LP is referenced (empty when it was never used). */
  readonly history: readonly string[];
}

export type LpRemoval =
  | { readonly mode: 'delete' }
  | { readonly mode: 'void'; readonly because: string }
  | { readonly mode: 'blocked'; readonly reason: string };

/**
 * Pure rule for removing an LP number (critic R5: LPs could never be removed, so their LP type
 * could never be deleted):
 * - blocked while it holds stock, is nested on a parent LP, has child LPs, or has shipped;
 * - deleted outright when it was never used anywhere;
 * - otherwise voided: status Removed, location cleared, row kept so its history still resolves.
 */
export function lpRemovalPlan(f: LpRemovalFacts): LpRemoval {
  if (f.units > 0 || f.status === 'Occupied')
    return {
      mode: 'blocked',
      reason: `holds ${f.units.toLocaleString('en-US')} ${f.units === 1 ? 'unit' : 'units'}; move or adjust the stock first`,
    };
  if (f.status === 'Shipped')
    return { mode: 'blocked', reason: 'has shipped; shipped LPs keep their shipment record' };
  if (f.parentNumber)
    return {
      mode: 'blocked',
      reason: `is nested on parent LP ${f.parentNumber}; take it off the parent first`,
    };
  if (f.childCount > 0)
    return {
      mode: 'blocked',
      reason: `has ${f.childCount} child ${f.childCount === 1 ? 'LP' : 'LPs'}; take them off first`,
    };
  if (f.history.length === 0) return { mode: 'delete' };
  if (f.status === 'Removed')
    return { mode: 'blocked', reason: `is already voided; it stays for its ${f.history.join(', ')} history` };
  return { mode: 'void', because: `it has ${f.history.join(', ')} history` };
}

export async function lpRemovalFacts(db: AppDb, row: typeof lp.$inferSelect): Promise<LpRemovalFacts> {
  const units =
    (
      await db
        .select({ n: sql<number>`COALESCE(SUM(${s.inventory.onHand}), 0)` })
        .from(s.inventory)
        .where(eq(s.inventory.lpId, row.id))
        .limit(1)
    )[0]?.n ?? 0;
  const parentNumber = row.parentLpId
    ? ((await db.select({ n: lp.number }).from(lp).where(eq(lp.id, row.parentLpId)).limit(1))[0]?.n ?? null)
    : null;
  const childCount =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(lp)
        .where(eq(lp.parentLpId, row.id))
        .limit(1)
    )[0]?.n ?? 0;
  const history = (
    await filterSeq(
      LP_HISTORY_PROBES,
      async (p) =>
        (await dbGet<{ x: number } | undefined>(db, sql`SELECT (EXISTS (${p.where(row.id)}))::int AS x`))
          ?.x === 1,
    )
  ).map((p) => p.label);
  return { status: row.status, units, parentNumber, childCount, history };
}

/** Per-row removal preview for the confirm dialog: what will happen to each selected LP. */
export async function lpRemovalPreview(db: AppDb, auth: AuthContext, ids: readonly string[]) {
  return await mapSeq([...new Set(ids)].slice(0, 1000), async (id) => {
    const row = await loadLp(db, auth, id);
    const plan = lpRemovalPlan(await lpRemovalFacts(db, row));
    return { id, number: row.number, status: row.status, ...plan };
  });
}

export type LpRemovalPreview = Awaited<ReturnType<typeof lpRemovalPreview>>;

/** Bulk delete / void (per-id savepoints). Every success writes a Delete row, or a status Update row for a void. */
export async function removeLpNumbers(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
): Promise<BulkResult & { readonly deleted: readonly string[]; readonly voided: readonly string[] }> {
  const ctx = domainCtxOf(actor, auth);
  const deleted: string[] = [];
  const voided: string[] = [];
  const result = await runBulk(tx, ids, async (inner, id) => {
    const row = await loadLp(inner, auth, id);
    const plan = lpRemovalPlan(await lpRemovalFacts(inner, row));
    if (plan.mode === 'blocked') throw new AppError('INVALID_STATE', `${row.number} ${plan.reason}`);
    if (plan.mode === 'delete') {
      await inner.delete(lp).where(eq(lp.id, id));
      await logDelete(inner, ctx, {
        entityType: ENTITY,
        entityId: id,
        entityCode: row.number,
        warehouseId: row.warehouseId,
      });
      deleted.push(id);
      return;
    }
    await inner
      .update(lp)
      .set({ status: 'Removed', locationId: null, updatedBy: actor.userId, version: sql`${lp.version} + 1` })
      .where(eq(lp.id, id));
    const loc = row.locationId
      ? ((
          await inner
            .select({ code: s.locations.code })
            .from(s.locations)
            .where(eq(s.locations.id, row.locationId))
            .limit(1)
        )[0]?.code ?? '')
      : '';
    await logUpdate(
      inner,
      ctx,
      { entityType: ENTITY, entityId: id, entityCode: row.number },
      { status: row.status, location: loc },
      { status: 'Removed', location: '' },
    );
    voided.push(id);
  });
  return { ...result, deleted, voided };
}

/* ---------------- labels ---------------- */

export async function lpLabelRecords(tx: AppDb, auth: AuthContext, ids: readonly string[]) {
  const rows = await tx
    .select({
      id: lp.id,
      number: lp.number,
      lpType: lpTypeCodeSql,
      warehouseCode: warehouseCodeSql,
      locationCode: locationCodeSql,
      clientName: sql<string | null>`(SELECT c.name FROM clients c WHERE c.id = ${qc(lp.clientId)})`,
    })
    .from(lp)
    .where(and(inArray(lp.id, [...ids]), listScope(lp, auth, { warehouseId: lp.warehouseId })))
    .orderBy(lp.number);
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'None of the selected LP numbers were found');
  await tx
    .update(lp)
    .set({ labelPrintedAt: new Date().toISOString() })
    .where(
      inArray(
        lp.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    ...(r.lpType ? { lpType: r.lpType } : {}),
    ...(r.warehouseCode ? { warehouseCode: r.warehouseCode } : {}),
    ...(r.locationCode ? { locationCode: r.locationCode } : {}),
    ...(r.clientName ? { clientName: r.clientName } : {}),
  }));
}
