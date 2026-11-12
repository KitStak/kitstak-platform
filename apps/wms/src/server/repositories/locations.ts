/**
 * Locations repository (M10): grid list (21 columns, grid grammar), zone summary, detail,
 * create/update with product + LP capacities, guarded bulk delete, lock/unlock, labels.
 * Every read is scoped (warehouse); every write logs field-level change_log rows.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import * as s from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import { round } from '@/lib/grid-defs/facility/common';
import { capacityLineChanges, type CapacityLine } from '@/lib/grid-defs/facility/change-log-copy';
import {
  legacyRoleFor,
  LOCATION_FIELDS,
  LOCATION_SEARCH_FIELDS,
  LOCATION_SORT_FIELDS,
  unsetAsNull,
  type LocationSave,
} from '@/lib/grid-defs/facility/locations';
import {
  assertFound,
  assertVersion,
  assertWarehouseInScope,
  compileGrid,
  domainCtxOf,
  duplicateError,
  listScope,
  logCapacityChanges,
  logCreate,
  logDelete,
  logUpdate,
  resolveIds,
  type Actor,
  type GridBinding,
  qc,
  flattenCustomFields,
} from './locations-shared';
import { customFieldSql } from './custom-field-sql';
import {
  isReservation,
  ledgerEffect,
  RESERVATION_TXN_TYPES,
  type LedgerDirection,
  type LedgerKind,
} from '@/lib/grid-defs/facility/location-ledger';
import { forEachSeq } from '@/server/db/sql';

const l = s.locations;

const onHandSql = sql<number>`COALESCE((SELECT SUM(i.on_hand) FROM inventory i WHERE i.location_id = ${qc(l.id)}), 0)`;
const skuCountSql = sql<number>`(SELECT COUNT(DISTINCT i.product_id) FROM inventory i WHERE i.location_id = ${qc(l.id)} AND i.on_hand > 0)`;
const cartSql = sql<
  string | null
>`(SELECT mc.code FROM inventory i JOIN mobile_carts mc ON mc.id = i.mobile_cart_id WHERE i.location_id = ${qc(l.id)} AND i.on_hand > 0 LIMIT 1)`;

export const LOCATION_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${l.code}`,
  displayMember: sql`${l.displayMember}`,
  barcode: sql`COALESCE(${l.barcode}, ${l.code})`,
  warehouseId: sql`${l.warehouseId}`,
  warehouseCode: sql`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(l.warehouseId)})`,
  locationGroupId: sql`${l.locationGroupId}`,
  locationGroup: sql`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${qc(l.locationGroupId)})`,
  locationZoneId: sql`${l.locationZoneId}`,
  locationZone: sql`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${qc(l.locationZoneId)})`,
  locationType: sql`${l.locationType}`,
  replenishmentType: sql`${l.replenishmentType}`,
  areaType: sql`${l.areaType}`,
  assignedMobileCart: cartSql,
  walkingPathPriority: sql`${l.walkingPathPriority}`,
  level: sql`${l.level}`,
  mezzanine: sql`${l.mezzanine}`,
  aisle: sql`${l.aisle}`,
  rack: sql`COALESCE(${l.rack}, NULLIF(${l.bay}, ''))`,
  position: sql`${l.position}`,
  column: sql`${l.column}`,
  height: sql`${l.height}`,
  volume: sql`${l.volume}`,
  abcCode: sql`${l.abcCode}`,
  dedicatedClient: sql`(SELECT c.name FROM clients c WHERE c.id = ${qc(l.dedicatedClientId)})`,
  isLocked: sql`${l.isLocked}`,
  inventoryStatus: sql`CASE WHEN ${onHandSql} > 0 THEN 'Occupied' ELSE 'Available' END`,
  hasInventory: sql`CASE WHEN ${onHandSql} > 0 THEN 1 ELSE 0 END`,
  preventAllocation: sql`${l.preventAllocation}`,
  dedicatedClientId: sql`${l.dedicatedClientId}`,
  storedUnits: onHandSql,
  createdAt: sql`${l.createdAt}`,
  ...customFieldSql(l.customFields),
};

const BINDING: GridBinding = {
  exprs: LOCATION_SQL,
  fields: LOCATION_FIELDS,
  sortable: LOCATION_SORT_FIELDS,
  search: LOCATION_SEARCH_FIELDS,
  defaultSort: [{ field: 'code', dir: 'asc' }],
  tiebreaker: l.id,
};

export interface LocationRow {
  readonly id: string;
  readonly code: string;
  readonly displayMember: string | null;
  readonly barcode: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly locationGroup: string | null;
  readonly locationZone: string | null;
  readonly locationType: string | null;
  readonly replenishmentType: string | null;
  readonly areaType: string | null;
  readonly assignedMobileCart: string | null;
  readonly walkingPathPriority: number | null;
  readonly level: string | null;
  readonly mezzanine: string | null;
  readonly aisle: string;
  readonly rack: string | null;
  readonly position: string | null;
  readonly column: number | null;
  readonly height: number;
  readonly volume: number;
  readonly volumeUnit: string;
  readonly abcCode: string;
  readonly dedicatedClient: string | null;
  readonly isLocked: boolean;
  readonly inventoryStatus: 'Available' | 'Occupied';
  readonly preventAllocation: boolean;
  readonly storedUnits: number;
  readonly skuCount: number;
  readonly openTaskCount: number;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
  readonly version: number;
}

const openTaskSql = sql<number>`(SELECT COUNT(*) FROM tasks t WHERE (t.source_location_id = ${qc(l.id)} OR t.target_location_id = ${qc(l.id)}) AND t.status IN ('Pending','Started'))`;

function selection() {
  return {
    id: l.id,
    code: l.code,
    displayMember: l.displayMember,
    barcode: sql<string>`${LOCATION_SQL.barcode}`,
    warehouseId: l.warehouseId,
    warehouseCode: sql<string>`${LOCATION_SQL.warehouseCode}`,
    locationGroup: sql<string | null>`${LOCATION_SQL.locationGroup}`,
    locationZone: sql<string | null>`${LOCATION_SQL.locationZone}`,
    locationType: l.locationType,
    replenishmentType: l.replenishmentType,
    areaType: l.areaType,
    assignedMobileCart: cartSql,
    walkingPathPriority: l.walkingPathPriority,
    level: l.level,
    mezzanine: l.mezzanine,
    aisle: l.aisle,
    rack: sql<string | null>`${LOCATION_SQL.rack}`,
    position: l.position,
    column: l.column,
    height: l.height,
    volume: l.volume,
    volumeUnit: l.volumeUnit,
    abcCode: l.abcCode,
    dedicatedClient: sql<string | null>`${LOCATION_SQL.dedicatedClient}`,
    isLocked: l.isLocked,
    inventoryStatus: sql<'Available' | 'Occupied'>`${LOCATION_SQL.inventoryStatus}`,
    preventAllocation: l.preventAllocation,
    storedUnits: onHandSql,
    skuCount: skuCountSql,
    openTaskCount: openTaskSql,
    customFields: l.customFields,
    version: l.version,
  };
}

export async function listLocations(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: LocationRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [listScope(l, auth)]);
  const result = await paginate(
    db
      .select(selection())
      .from(l)
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(l)
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return {
    rows: result.rows.map((r) => ({
      ...r,
      ...unsetFields(r),
      isLocked: Boolean(r.isLocked),
      preventAllocation: Boolean(r.preventAllocation),
    })) as LocationRow[],
    total: result.total,
  };
}

/** 0 / "" / "0" mean "not set" for walking path, column and level (see `optionalInt`). */
function unsetFields(r: {
  readonly walkingPathPriority: number | null;
  readonly column: number | null;
  readonly level: string | null;
}) {
  return {
    walkingPathPriority: unsetAsNull(r.walkingPathPriority),
    column: unsetAsNull(r.column),
    level: r.level && r.level !== '0' ? r.level : null,
  };
}

/* ---------------- zone summary strip ---------------- */

export interface ZoneSummaryRow {
  readonly zoneId: string | null;
  readonly zone: string;
  /** Owning warehouse code; null when the group spans warehouses (only "No zone" can). */
  readonly warehouseCode: string | null;
  readonly binCount: number;
  readonly occupiedCount: number;
  readonly storedUnits: number;
}

export async function getZoneSummary(
  db: AppDb,
  auth: AuthContext,
  warehouseId?: string,
): Promise<ZoneSummaryRow[]> {
  const where = and(listScope(l, auth), warehouseId ? eq(l.warehouseId, warehouseId) : undefined);
  const rows = await db
    .select({
      zoneId: l.locationZoneId,
      zone: sql<string>`COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = ${qc(l.locationZoneId)}), 'No zone')`,
      warehouseCode: sql<
        string | null
      >`CASE WHEN COUNT(DISTINCT ${s.warehouses.id}) = 1 THEN MAX(${s.warehouses.code}) ELSE NULL END`,
      binCount: sql<number>`COUNT(*)`,
      occupiedCount: sql<number>`SUM(CASE WHEN ${onHandSql} > 0 THEN 1 ELSE 0 END)`,
      storedUnits: sql<number>`SUM(${onHandSql})`,
    })
    .from(l)
    .innerJoin(s.warehouses, eq(s.warehouses.id, l.warehouseId))
    .where(where)
    .groupBy(l.locationZoneId);
  return rows.sort((a, b) =>
    a.zoneId === null
      ? 1
      : b.zoneId === null
        ? -1
        : a.zone.localeCompare(b.zone) || (a.warehouseCode ?? '').localeCompare(b.warehouseCode ?? ''),
  );
}

/* ---------------- detail ---------------- */

export async function loadLocation(db: AppDb, auth: AuthContext, id: string): Promise<typeof l.$inferSelect> {
  const row = assertFound((await db.select().from(l).where(eq(l.id, id)).limit(1))[0], 'Location');
  assertWarehouseInScope(auth, row.warehouseId, 'Location');
  return row;
}

export async function getLocation(db: AppDb, auth: AuthContext, id: string) {
  const row = await loadLocation(db, auth, id);
  const names = await resolveIds(db, 'lookup_values', [row.locationGroupId, row.locationZoneId]);
  const wh = (
    await db
      .select({ code: s.warehouses.code, name: s.warehouses.name })
      .from(s.warehouses)
      .where(eq(s.warehouses.id, row.warehouseId))
      .limit(1)
  )[0];
  const client = row.dedicatedClientId
    ? (
        await db
          .select({ code: s.clients.code, name: s.clients.name })
          .from(s.clients)
          .where(eq(s.clients.id, row.dedicatedClientId))
          .limit(1)
      )[0]
    : undefined;
  const productCapacities = await db
    .select({
      id: s.locationProductCapacity.id,
      clientId: s.locationProductCapacity.clientId,
      clientName: s.clients.name,
      productId: s.locationProductCapacity.productId,
      sku: s.products.sku,
      productName: s.products.name,
      packType: s.locationProductCapacity.packType,
      minQty: s.locationProductCapacity.minQty,
      maxQty: s.locationProductCapacity.maxQty,
    })
    .from(s.locationProductCapacity)
    .innerJoin(s.products, eq(s.products.id, s.locationProductCapacity.productId))
    .innerJoin(s.clients, eq(s.clients.id, s.locationProductCapacity.clientId))
    .where(eq(s.locationProductCapacity.locationId, id))
    .orderBy(asc(s.products.sku));
  const lpCapacities = await db
    .select({
      id: s.locationLpCapacity.id,
      lpTypeId: s.locationLpCapacity.lpTypeId,
      lpTypeCode: s.lpTypes.code,
      minQty: s.locationLpCapacity.minQty,
      maxQty: s.locationLpCapacity.maxQty,
      clientId: s.locationLpCapacity.clientId,
      productId: s.locationLpCapacity.productId,
      sku: sql<string | null>`(SELECT p.sku FROM products p WHERE p.id = ${s.locationLpCapacity.productId})`,
    })
    .from(s.locationLpCapacity)
    .innerJoin(s.lpTypes, eq(s.lpTypes.id, s.locationLpCapacity.lpTypeId))
    .where(eq(s.locationLpCapacity.locationId, id));
  const stats = (
    await db
      .select({ storedUnits: onHandSql, skuCount: skuCountSql, openTaskCount: openTaskSql, cart: cartSql })
      .from(l)
      .where(eq(l.id, id))
      .limit(1)
  )[0];
  return {
    ...row,
    ...unsetFields(row),
    barcode: row.barcode ?? row.code,
    warehouseCode: wh?.code ?? '',
    warehouseName: wh?.name ?? '',
    locationGroup: row.locationGroupId ? (names.get(row.locationGroupId) ?? null) : null,
    locationZone: row.locationZoneId ? (names.get(row.locationZoneId) ?? null) : null,
    dedicatedClientName: client ? `${client.code} · ${client.name}` : null,
    storedUnits: stats?.storedUnits ?? 0,
    skuCount: stats?.skuCount ?? 0,
    openTaskCount: stats?.openTaskCount ?? 0,
    assignedMobileCart: stats?.cart ?? null,
    inventoryStatus: (stats?.storedUnits ?? 0) > 0 ? 'Occupied' : 'Available',
    productCapacities,
    lpCapacities,
  };
}

export type LocationDetail = Awaited<ReturnType<typeof getLocation>>;

export async function getLocationContents(db: AppDb, auth: AuthContext, id: string) {
  await loadLocation(db, auth, id);
  const buckets = await db
    .select({
      id: s.inventory.id,
      productId: s.products.id,
      sku: s.products.sku,
      productName: s.products.name,
      clientName: s.clients.name,
      lotNumber: s.inventory.lotNumber,
      expiryDate: s.inventory.expiryDate,
      status: s.inventory.status,
      packType: s.inventory.packType,
      onHand: s.inventory.onHand,
      allocated: s.inventory.allocated,
      damaged: s.inventory.damaged,
      lpNumber: s.licensePlates.number,
      receivedAt: s.inventory.receivedAt,
    })
    .from(s.inventory)
    .innerJoin(s.products, eq(s.products.id, s.inventory.productId))
    .leftJoin(s.clients, eq(s.clients.id, s.inventory.clientId))
    .leftJoin(s.licensePlates, eq(s.licensePlates.id, s.inventory.lpId))
    .where(and(eq(s.inventory.locationId, id), sql`${s.inventory.onHand} > 0`))
    .orderBy(asc(s.products.sku));
  const tasks = await db
    .select({
      id: s.tasks.id,
      taskNo: s.tasks.taskNo,
      taskType: s.tasks.taskType,
      status: s.tasks.status,
      jobId: s.tasks.jobId,
      jobCode: s.jobs.code,
      productId: s.tasks.productId,
      sku: sql<string | null>`(SELECT p.sku FROM products p WHERE p.id = ${s.tasks.productId})`,
      plannedQty: s.tasks.plannedQty,
      direction: sql<
        'Source' | 'Target'
      >`CASE WHEN ${s.tasks.sourceLocationId} = ${id} THEN 'Source' ELSE 'Target' END`,
    })
    .from(s.tasks)
    .innerJoin(s.jobs, eq(s.jobs.id, s.tasks.jobId))
    .where(
      and(
        sql`(${s.tasks.sourceLocationId} = ${id} OR ${s.tasks.targetLocationId} = ${id})`,
        inArray(s.tasks.status, ['Pending', 'Started']),
      ),
    )
    .orderBy(asc(s.tasks.taskNo))
    .limit(200);
  const first = await ledgerPage(db, id, { page: 1, ps: 25, kind: 'movements' });
  return { buckets, tasks, ledger: first.rows, ledgerTotal: first.total };
}

export interface LocationLedgerRow {
  readonly id: string;
  readonly type: string;
  readonly productId: string;
  readonly sku: string;
  readonly direction: LedgerDirection;
  /** Units, always positive; read with `direction`. */
  readonly qty: number;
  /** Signed change to this location's on-hand. */
  readonly delta: number;
  readonly reservation: boolean;
  readonly lotNumber: string | null;
  readonly at: string;
  readonly source: string;
  readonly note: string | null;
}

async function ledgerPage(
  db: AppDb,
  id: string,
  q: { readonly page: number; readonly ps: number; readonly kind: LedgerKind },
): Promise<{ rows: LocationLedgerRow[]; total: number }> {
  const t = s.inventoryTransactions;
  const here = sql`(${t.fromLocationId} = ${id} OR ${t.toLocationId} = ${id})`;
  const list = sql.join(
    RESERVATION_TXN_TYPES.map((v) => sql`${v}`),
    sql`, `,
  );
  const kind =
    q.kind === 'all'
      ? undefined
      : q.kind === 'reservations'
        ? sql`${t.type} IN (${list})`
        : sql`${t.type} NOT IN (${list})`;
  const where = and(here, kind);
  const total =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  const raw = await db
    .select({
      id: t.id,
      type: t.type,
      productId: s.products.id,
      sku: s.products.sku,
      uomQty: t.uomQty,
      fromLocationId: t.fromLocationId,
      toLocationId: t.toLocationId,
      lot: sql<string | null>`COALESCE(${t.toLot}, ${t.fromLot})`,
      at: t.at,
      source: t.source,
      note: t.note,
    })
    .from(t)
    .innerJoin(s.products, eq(s.products.id, t.productId))
    .where(where)
    .orderBy(sql`${t.seq} DESC`)
    .limit(q.ps)
    .offset((q.page - 1) * q.ps);
  const rows = raw.map((r) => {
    const effect = ledgerEffect(r.fromLocationId === id, r.toLocationId === id, r.uomQty);
    return {
      id: r.id,
      type: r.type,
      productId: r.productId,
      sku: r.sku,
      ...effect,
      reservation: isReservation(r.type),
      lotNumber: r.lot,
      at: r.at,
      source: r.source,
      note: r.note,
    };
  });
  return { rows, total };
}

/** Paged ledger of one location (critic R5: hard-capped at 100 and mixed with reservations). */
export async function listLocationLedger(
  db: AppDb,
  auth: AuthContext,
  id: string,
  q: { readonly page: number; readonly ps: number; readonly kind: LedgerKind },
) {
  await loadLocation(db, auth, id);
  return await ledgerPage(db, id, q);
}

/* ---------------- writes ---------------- */

function columnsFor(info: LocationSave['info'], zoneName: string | null) {
  const barcode = info.barcode?.trim() ? info.barcode.trim() : info.code.trim();
  return {
    warehouseId: info.warehouseId,
    code: info.code.trim(),
    zone: zoneName ?? '',
    aisle: info.aisle ?? '',
    bay: info.rack ?? '',
    level: info.level === null ? '' : String(info.level),
    type: legacyRoleFor(info.areaType),
    capacityUnits: info.maxCapacityQty,
    barcode,
    displayMember: info.displayMember,
    locationGroupId: info.locationGroupId,
    locationZoneId: info.locationZoneId,
    locationType: info.locationType,
    areaType: info.areaType,
    replenishmentType: info.replenishmentType,
    walkingPathPriority: info.walkingPathPriority ?? 0, // REQ-2: store null once the column is nullable
    capacityType: info.capacityType,
    maxCapacityQty: info.maxCapacityQty,
    maxSkuQty: info.maxSkuQty,
    mezzanine: info.mezzanine,
    rack: info.rack,
    column: info.column ?? 0, // REQ-2
    position: info.position,
    dimensionUnit: info.dimensionUnit,
    height: round(info.height),
    width: round(info.width),
    length: round(info.length),
    volumeUnit: info.volumeUnit,
    volume: round(info.volume, 5),
    abcCode: info.abcCode,
    singleClient: info.singleClient,
    isLocked: info.isLocked,
    dedicatedClientId: info.singleClient ? info.dedicatedClientId : info.dedicatedClientId,
    printApplyOnPacking: info.printApplyOnPacking,
    colorCode: info.colorCode,
    preventAllocation: info.preventAllocation,
    preventInventorySync: info.preventInventorySync,
    onlyOneLot: info.onlyOneLot,
    onlyDamaged: info.onlyDamaged,
    onlyOneExpiry: info.onlyOneExpiry,
    onlyOneSku: info.onlyOneSku,
    onlyOneLp: info.onlyOneLp,
    onlyOneProductionDate: info.onlyOneProductionDate,
    autoRemoveLpAfterReplenishment: info.autoRemoveLpAfterReplenishment,
    autoRemoveLpAfterTransfer: info.autoRemoveLpAfterTransfer,
  };
}

function writeColumns(input: LocationSave, zoneName: string | null) {
  return { ...columnsFor(input.info, zoneName), customFields: input.customFields };
}

async function assertLookup(
  db: AppDb,
  id: string | null,
  type: 'location_group' | 'location_zone',
  warehouseId: string,
  field: string,
): Promise<string | null> {
  if (!id) return null;
  const row = (
    await db
      .select({ name: s.lookupValues.name, warehouseId: s.lookupValues.warehouseId })
      .from(s.lookupValues)
      .where(and(eq(s.lookupValues.id, id), eq(s.lookupValues.type, type)))
      .limit(1)
  )[0];
  if (!row || (row.warehouseId && row.warehouseId !== warehouseId)) {
    throw new AppError('VALIDATION', 'Pick a value from this warehouse', {
      fieldErrors: { [field]: ['Pick a value from this warehouse'] },
    });
  }
  return row.name;
}

async function assertCodeFree(
  db: AppDb,
  warehouseId: string,
  code: string,
  exceptId?: string,
): Promise<void> {
  const clash = (
    await db
      .select({ id: l.id })
      .from(l)
      .where(and(eq(l.warehouseId, warehouseId), sql`lower(${l.code}) = lower(${code})`))
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId)
    throw duplicateError('info.code', `Location ${code} already exists in this warehouse`);
}

interface CapacityLines {
  readonly product: readonly CapacityLine[];
  readonly lp: readonly CapacityLine[];
}

/** Current capacity lines of a location, keyed for the per-line change log. */
async function capacityLines(db: AppDb, locationId: string): Promise<CapacityLines> {
  const products = await db
    .select({
      productId: s.locationProductCapacity.productId,
      sku: s.products.sku,
      pack: s.locationProductCapacity.packType,
      min: s.locationProductCapacity.minQty,
      max: s.locationProductCapacity.maxQty,
    })
    .from(s.locationProductCapacity)
    .innerJoin(s.products, eq(s.products.id, s.locationProductCapacity.productId))
    .where(eq(s.locationProductCapacity.locationId, locationId))
    .orderBy(asc(s.products.sku));
  const lps = await db
    .select({
      lpTypeId: s.locationLpCapacity.lpTypeId,
      productId: s.locationLpCapacity.productId,
      code: s.lpTypes.code,
      min: s.locationLpCapacity.minQty,
      max: s.locationLpCapacity.maxQty,
      sku: sql<string | null>`(SELECT p.sku FROM products p WHERE p.id = ${s.locationLpCapacity.productId})`,
    })
    .from(s.locationLpCapacity)
    .innerJoin(s.lpTypes, eq(s.lpTypes.id, s.locationLpCapacity.lpTypeId))
    .where(eq(s.locationLpCapacity.locationId, locationId))
    .orderBy(asc(s.lpTypes.code));
  return {
    product: products.map((p) => ({
      key: `${p.productId}|${p.pack}`,
      label: p.pack && p.pack !== 'Each' ? `${p.sku} (${p.pack})` : p.sku,
      min: p.min,
      max: p.max,
    })),
    lp: lps.map((p) => ({
      key: `${p.lpTypeId}|${p.productId ?? ''}`,
      label: p.sku ? `${p.code} · ${p.sku}` : p.code,
      min: p.min,
      max: p.max,
    })),
  };
}

async function logCapacities(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ref: { entityId: string; entityCode: string },
  before: CapacityLines,
  after: CapacityLines,
): Promise<void> {
  await logCapacityChanges(tx, domainCtxOf(actor, auth), { entityType: 'location', ...ref }, [
    ...capacityLineChanges('productCapacity', before.product, after.product),
    ...capacityLineChanges('lpCapacity', before.lp, after.lp),
  ]);
}

async function writeCapacities(
  tx: AppDb,
  auth: AuthContext,
  locationId: string,
  input: LocationSave,
): Promise<void> {
  await tx.delete(s.locationProductCapacity).where(eq(s.locationProductCapacity.locationId, locationId));
  await tx.delete(s.locationLpCapacity).where(eq(s.locationLpCapacity.locationId, locationId));
  await forEachSeq(input.productCapacities, async (c, i) => {
    const product = (
      await tx
        .select({ clientId: s.products.clientId })
        .from(s.products)
        .where(eq(s.products.id, c.productId))
        .limit(1)
    )[0];
    if (!product || product.clientId !== c.clientId) {
      throw new AppError('VALIDATION', 'The product does not belong to the selected client', {
        fieldErrors: { [`productCapacities.${i}.productId`]: ['Pick a product of this client'] },
      });
    }
    await tx
      .insert(s.locationProductCapacity)
      .values({
        locationId,
        clientId: c.clientId,
        productId: c.productId,
        packType: c.packType,
        minQty: c.minQty,
        maxQty: c.maxQty,
      });
  });
  await forEachSeq(input.lpCapacities, async (c, i) => {
    const type = (
      await tx
        .select({ warehouseId: s.lpTypes.warehouseId })
        .from(s.lpTypes)
        .where(eq(s.lpTypes.id, c.lpTypeId))
        .limit(1)
    )[0];
    if (!type || type.warehouseId !== input.info.warehouseId) {
      throw new AppError('VALIDATION', 'Pick an LP type of this warehouse', {
        fieldErrors: { [`lpCapacities.${i}.lpTypeId`]: ['Pick an LP type of this warehouse'] },
      });
    }
    await tx
      .insert(s.locationLpCapacity)
      .values({
        locationId,
        lpTypeId: c.lpTypeId,
        minQty: c.minQty,
        maxQty: c.maxQty,
        clientId: c.assignProduct ? c.clientId : null,
        productId: c.assignProduct ? c.productId : null,
      });
  });
  void auth;
}

/** Display snapshot (ids resolved to names) for change-log diffs. */
async function display(db: AppDb, row: typeof l.$inferSelect): Promise<Record<string, unknown>> {
  const names = await resolveIds(db, 'lookup_values', [row.locationGroupId, row.locationZoneId]);
  const wh = await resolveIds(db, 'warehouses', [row.warehouseId]);
  const cl = await resolveIds(db, 'clients', [row.dedicatedClientId]);
  const {
    id: _id,
    warehouseId,
    locationGroupId,
    locationZoneId,
    dedicatedClientId,
    zone: _zone,
    bay: _bay,
    type: _type,
    capacityUnits: _cu,
    customFields: _cf,
    ...rest
  } = row;
  void _id;
  void _zone;
  void _bay;
  void _type;
  void _cu;
  return {
    ...rest,
    // Same "not set" normalisation as the UI, so the change log reads "— --> 777", never "0 --> 777".
    ...unsetFields(rest),
    ...flattenCustomFields(_cf),
    warehouse: wh.get(warehouseId) ?? '',
    locationGroup: locationGroupId ? (names.get(locationGroupId) ?? '') : '',
    locationZone: locationZoneId ? (names.get(locationZoneId) ?? '') : '',
    dedicatedClient: dedicatedClientId ? (cl.get(dedicatedClientId) ?? '') : '',
  };
}

export async function createLocation(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: LocationSave,
): Promise<{ id: string; code: string }> {
  assertWarehouseInScope(auth, input.info.warehouseId);
  await assertCodeFree(tx, input.info.warehouseId, input.info.code.trim());
  await assertLookup(
    tx,
    input.info.locationGroupId,
    'location_group',
    input.info.warehouseId,
    'info.locationGroupId',
  );
  const zoneName = await assertLookup(
    tx,
    input.info.locationZoneId,
    'location_zone',
    input.info.warehouseId,
    'info.locationZoneId',
  );
  const row = (
    await tx
      .insert(l)
      .values({ ...writeColumns(input, zoneName), createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: l.id, code: l.code })
  )[0];
  await writeCapacities(tx, auth, row.id, input);
  await logCreate(tx, domainCtxOf(actor, auth), {
    entityType: 'location',
    entityId: row.id,
    entityCode: row.code,
  });
  await logCapacities(
    tx,
    auth,
    actor,
    { entityId: row.id, entityCode: row.code },
    { product: [], lp: [] },
    await capacityLines(tx, row.id),
  );
  return row;
}

export async function updateLocation(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  id: string,
  input: LocationSave,
): Promise<{ id: string; code: string; version: number }> {
  const before = await loadLocation(tx, auth, id);
  assertVersion(before.version, input.version);
  if (input.info.warehouseId !== before.warehouseId) {
    throw new AppError('VALIDATION', "A location can't move to another warehouse", {
      fieldErrors: { 'info.warehouseId': ["A location can't move to another warehouse"] },
    });
  }
  await assertCodeFree(tx, before.warehouseId, input.info.code.trim(), id);
  await assertLookup(
    tx,
    input.info.locationGroupId,
    'location_group',
    before.warehouseId,
    'info.locationGroupId',
  );
  const zoneName = await assertLookup(
    tx,
    input.info.locationZoneId,
    'location_zone',
    before.warehouseId,
    'info.locationZoneId',
  );
  const capsBefore = await capacityLines(tx, id);
  const snapshotBefore = await display(tx, before);
  const after = (
    await tx
      .update(l)
      .set({ ...writeColumns(input, zoneName), updatedBy: actor.userId, version: sql`${l.version} + 1` })
      .where(eq(l.id, id))
      .returning()
  )[0];
  await writeCapacities(tx, auth, id, input);
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: 'location', entityId: id, entityCode: after.code },
    snapshotBefore,
    await display(tx, after),
  );
  await logCapacities(
    tx,
    auth,
    actor,
    { entityId: id, entityCode: after.code },
    capsBefore,
    await capacityLines(tx, id),
  );
  return { id, code: after.code, version: after.version };
}

/** Why a location can't be deleted, or null. */
export async function deleteBlocker(db: AppDb, id: string): Promise<string | null> {
  const stock = (
    await db
      .select({ onHand: sql<number>`COALESCE(SUM(${s.inventory.onHand}), 0)`, rows: sql<number>`COUNT(*)` })
      .from(s.inventory)
      .where(eq(s.inventory.locationId, id))
      .limit(1)
  )[0];
  if ((stock?.onHand ?? 0) > 0) return `holds ${stock?.onHand} units of inventory`;
  const tasks =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(s.tasks)
        .where(
          and(
            sql`(${s.tasks.sourceLocationId} = ${id} OR ${s.tasks.targetLocationId} = ${id})`,
            inArray(s.tasks.status, ['Pending', 'Started']),
          ),
        )
        .limit(1)
    )[0]?.n ?? 0;
  if (tasks > 0) return `has ${tasks} open ${tasks === 1 ? 'task' : 'tasks'}`;
  if ((stock?.rows ?? 0) > 0) return 'has inventory history buckets; lock it instead';
  const lps =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(s.licensePlates)
        .where(eq(s.licensePlates.locationId, id))
        .limit(1)
    )[0]?.n ?? 0;
  if (lps > 0) return `has ${lps} license ${lps === 1 ? 'plate' : 'plates'} assigned`;
  const asDefault = (
    await db
      .select({ code: s.warehouses.code })
      .from(s.warehouses)
      .where(
        sql`${s.warehouses.defaultReceivingLocationId} = ${id} OR ${s.warehouses.defaultShipLocationId} = ${id} OR ${s.warehouses.defaultReturnLocationId} = ${id}`,
      )
      .limit(1)
  )[0];
  if (asDefault) return `is a default location of warehouse ${asDefault.code}`;
  const pkg = (
    await db
      .select({ code: s.shipmentPackages.code })
      .from(s.shipmentPackages)
      .where(eq(s.shipmentPackages.reductionLocationId, id))
      .limit(1)
  )[0];
  if (pkg) return `is the reduction location of package ${pkg.code}`;
  return null;
}

export async function deleteLocations(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadLocation(inner, auth, id);
    const reason = await deleteBlocker(inner, id);
    if (reason) throw new AppError('INVALID_STATE', `${row.code} ${reason}`);
    await inner.delete(l).where(eq(l.id, id));
    await logDelete(inner, ctx, {
      entityType: 'location',
      entityId: id,
      entityCode: row.code,
      warehouseId: row.warehouseId,
    });
  });
}

export async function setLocationsLocked(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
  locked: boolean,
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadLocation(inner, auth, id);
    if (row.isLocked === locked)
      throw new AppError('INVALID_STATE', `${row.code} is already ${locked ? 'locked' : 'unlocked'}`);
    await inner
      .update(l)
      .set({ isLocked: locked, updatedBy: actor.userId, version: sql`${l.version} + 1` })
      .where(eq(l.id, id));
    await logUpdate(
      inner,
      ctx,
      { entityType: 'location', entityId: id, entityCode: row.code },
      { isLocked: row.isLocked },
      { isLocked: locked },
    );
  });
}

/** Label records for the shared print endpoint (`location-label`). */
export async function locationLabelRecords(db: AppDb, auth: AuthContext, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: l.id,
      code: l.code,
      barcode: sql<string>`${LOCATION_SQL.barcode}`,
      warehouseId: l.warehouseId,
      warehouseCode: sql<string>`${LOCATION_SQL.warehouseCode}`,
      zone: sql<string | null>`${LOCATION_SQL.locationZone}`,
      aisle: l.aisle,
      level: l.level,
      locationType: l.locationType,
    })
    .from(l)
    .where(and(inArray(l.id, [...ids]), listScope(l, auth)))
    .orderBy(asc(l.walkingPathPriority), asc(l.code));
  return rows.map((r) => ({
    code: r.code,
    barcode: r.barcode,
    warehouseCode: r.warehouseCode,
    ...(r.zone ? { zone: r.zone } : {}),
    ...(r.aisle ? { aisle: r.aisle } : {}),
    ...(r.level && r.level !== '0' ? { level: r.level } : {}),
    ...(r.locationType ? { locationType: r.locationType.replace(/([a-z])([A-Z])/g, '$1 $2') } : {}),
  }));
}

/**
 * The product's own pack types (Logiwa UOM model) for the capacity modal, smallest first.
 * Falls back to the product's base pack type when it has none defined.
 */
export async function productPackTypesFor(
  db: AppDb,
  productId: string,
): Promise<{ packType: string; kind: string; uomQty: number }[]> {
  const product = assertFound(
    (await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.id, productId)).limit(1))[0],
    'Product',
  );
  const rows = await db
    .select({
      packType: s.productPackTypes.packType,
      kind: s.productPackTypes.kind,
      uomQty: s.productPackTypes.uomQty,
    })
    .from(s.productPackTypes)
    .where(eq(s.productPackTypes.productId, product.id))
    .orderBy(asc(s.productPackTypes.uomQty), asc(s.productPackTypes.packType));
  return rows.length ? rows : [{ packType: 'Each', kind: 'Primary', uomQty: 1 }];
}
