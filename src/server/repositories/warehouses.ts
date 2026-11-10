/**
 * Warehouses repository (M10): grid, detail, create/update (Information + Settings), Set as
 * default, Activate/Deactivate (blocked while the warehouse has open work) and the module
 * change-log reader. Reads are limited to the user's warehouse scope (cross-scope = 404).
 */
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { from24h, STARTER_LOCATION_SUFFIXES, to24h, WAREHOUSE_FIELDS, WAREHOUSE_SEARCH_FIELDS, WAREHOUSE_SORT_FIELDS, type WarehouseSave } from "@/lib/grid-defs/facility/warehouses";
import { LOCATION_INFO_DEFAULTS, locationSaveSchema } from "@/lib/grid-defs/facility/locations";
import { createLocation } from "./locations";
import { assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, logCreate, logUpdate, resolveIds, type Actor, type GridBinding, qc } from "./locations-shared";

const w = s.warehouses;
const ENTITY = "warehouse";

const addressSql = sql<string>`TRIM(${w.addressLine} || COALESCE(', ' || NULLIF(${w.addressLine2}, ''), '') || ', ' || ${w.city} || ', ' || ${w.state} || COALESCE(' ' || NULLIF(${w.postalCode}, ''), ''))`;
const locationCountSql = sql<number>`(SELECT COUNT(*) FROM locations l WHERE l.warehouse_id = ${qc(w.id)})`;

export const WAREHOUSE_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${w.code}`,
  name: sql`${w.name}`,
  address: addressSql,
  city: sql`${w.city}`,
  state: sql`${w.state}`,
  contactName: sql`${w.contactName}`,
  type: sql`${w.type}`,
  isDefault: sql`${w.isDefault}`,
  isActive: sql`${w.isActive}`,
  locationCount: locationCountSql,
  createdAt: sql`${w.createdAt}`,
};

const BINDING: GridBinding = {
  exprs: WAREHOUSE_SQL,
  fields: WAREHOUSE_FIELDS,
  sortable: WAREHOUSE_SORT_FIELDS,
  search: WAREHOUSE_SEARCH_FIELDS,
  defaultSort: [{ field: "code", dir: "asc" }],
  tiebreaker: w.id,
};

export interface WarehouseRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly prefix: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly email: string | null;
  readonly type: "Internal" | "External";
  readonly timezone: string;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly locationCount: number;
  readonly openWork: number;
  readonly version: number;
  readonly createdAt: string;
}

const scopeOf = (auth: AuthContext): SQL => (auth.scope.warehouseIds.length ? inArray(w.id, [...auth.scope.warehouseIds]) : sql`0`);

const OPEN_ORDER = sql.raw(`('Shipped','Cancelled','Delivered')`);
const openOrdersSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.warehouse_id = ${qc(w.id)} AND so.status NOT IN ${OPEN_ORDER})`;
const openPosSql = sql<number>`(SELECT COUNT(*) FROM purchase_orders po WHERE po.warehouse_id = ${qc(w.id)} AND po.status IN ('Pending','Started','Receiving'))`;
const openJobsSql = sql<number>`(SELECT COUNT(*) FROM jobs j WHERE j.warehouse_id = ${qc(w.id)} AND j.status IN ('Pending','Started','In Progress'))`;

export function listWarehouses(db: AppDb, auth: AuthContext, query: GridQuery): { rows: WarehouseRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [scopeOf(auth)]);
  const result = paginate(
    db.select({
      id: w.id, code: w.code, name: w.name, prefix: w.prefix, address: addressSql, city: w.city, state: w.state, country: w.country,
      contactName: w.contactName, contactPhone: w.contactPhone, email: w.email, type: w.type, timezone: w.timezone,
      isDefault: w.isDefault, isActive: w.isActive, locationCount: locationCountSql,
      openWork: sql<number>`${openOrdersSql} + ${openPosSql} + ${openJobsSql}`, version: w.version, createdAt: w.createdAt,
    }).from(w).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(w).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: result.rows.map((r) => ({ ...r, isDefault: Boolean(r.isDefault), isActive: Boolean(r.isActive) })) as WarehouseRow[], total: result.total };
}

export function loadWarehouse(db: AppDb, auth: AuthContext, id: string): typeof w.$inferSelect {
  const row = assertFound(db.select().from(w).where(eq(w.id, id)).get(), "Warehouse");
  assertWarehouseInScope(auth, row.id, "Warehouse");
  return row;
}

export interface OpenWork {
  readonly orders: number;
  readonly purchaseOrders: number;
  readonly jobs: number;
}

export function openWorkOf(db: AppDb, id: string): OpenWork {
  const row = db.select({ orders: openOrdersSql, purchaseOrders: openPosSql, jobs: openJobsSql }).from(w).where(eq(w.id, id)).get();
  return { orders: row?.orders ?? 0, purchaseOrders: row?.purchaseOrders ?? 0, jobs: row?.jobs ?? 0 };
}

export function getWarehouse(db: AppDb, auth: AuthContext, id: string) {
  const row = loadWarehouse(db, auth, id);
  const locs = resolveIds(db, "locations", [row.defaultReceivingLocationId, row.defaultShipLocationId, row.defaultReturnLocationId]);
  const start = from24h(row.dayShiftStart);
  const end = from24h(row.dayShiftEnd);
  const stats = db.select({
    locations: locationCountSql,
    zones: sql<number>`(SELECT COUNT(DISTINCT COALESCE(l.location_zone_id, l.zone)) FROM locations l WHERE l.warehouse_id = ${qc(w.id)})`,
    lpTypes: sql<number>`(SELECT COUNT(*) FROM lp_types t WHERE t.warehouse_id = ${qc(w.id)})`,
    carts: sql<number>`(SELECT COUNT(*) FROM mobile_carts c WHERE c.warehouse_id = ${qc(w.id)})`,
    packages: sql<number>`(SELECT COUNT(*) FROM shipment_packages p WHERE p.warehouse_id = ${qc(w.id)})`,
    onHand: sql<number>`(SELECT COALESCE(SUM(i.on_hand), 0) FROM inventory i WHERE i.warehouse_id = ${qc(w.id)})`,
  }).from(w).where(eq(w.id, id)).get();
  return {
    ...row,
    shiftStart: start.time, shiftStartZone: start.zone, shiftEnd: end.time, shiftEndZone: end.zone,
    mobileAutoLogout: row.mobileAutoLogoutMinutes !== null && row.mobileAutoLogoutMinutes > 0,
    defaultReceivingLocationCode: row.defaultReceivingLocationId ? locs.get(row.defaultReceivingLocationId) ?? null : null,
    defaultShipLocationCode: row.defaultShipLocationId ? locs.get(row.defaultShipLocationId) ?? null : null,
    defaultReturnLocationCode: row.defaultReturnLocationId ? locs.get(row.defaultReturnLocationId) ?? null : null,
    stats: { locations: stats?.locations ?? 0, zones: stats?.zones ?? 0, lpTypes: stats?.lpTypes ?? 0, carts: stats?.carts ?? 0, packages: stats?.packages ?? 0, onHand: stats?.onHand ?? 0 },
    openWork: openWorkOf(db, id),
  };
}

export type WarehouseDetail = ReturnType<typeof getWarehouse>;

/** Locations of one area type for the default-location pickers. */
export function warehouseLocationOptions(db: AppDb, auth: AuthContext, id: string, areaTypes: readonly string[]) {
  loadWarehouse(db, auth, id);
  return db.select({ id: s.locations.id, code: s.locations.code, areaType: s.locations.areaType })
    .from(s.locations)
    .where(and(eq(s.locations.warehouseId, id), areaTypes.length ? inArray(s.locations.areaType, areaTypes as never[]) : undefined))
    .orderBy(s.locations.code)
    .limit(500)
    .all();
}

/* ---------------- writes ---------------- */

const AREA_FOR: Readonly<Record<"defaultReceivingLocationId" | "defaultShipLocationId" | "defaultReturnLocationId", readonly string[]>> = {
  defaultReceivingLocationId: ["Receiving"],
  defaultShipLocationId: ["Shipment", "Loading", "Packing"],
  defaultReturnLocationId: ["Returns", "Receiving"],
};

function assertDefaultLocations(db: AppDb, warehouseId: string | null, input: WarehouseSave): void {
  for (const key of Object.keys(AREA_FOR) as (keyof typeof AREA_FOR)[]) {
    const id = input[key];
    if (!id) continue;
    const loc = db.select({ warehouseId: s.locations.warehouseId, areaType: s.locations.areaType, code: s.locations.code }).from(s.locations).where(eq(s.locations.id, id)).get();
    const message = !warehouseId ? "Save the warehouse before choosing its locations"
      : !loc || loc.warehouseId !== warehouseId ? "Pick a location of this warehouse"
      : !AREA_FOR[key].includes(loc.areaType ?? "") ? `${loc.code} is a ${loc.areaType ?? "untyped"} location; pick a ${AREA_FOR[key].join(" or ")} location`
      : null;
    if (message) throw new AppError("VALIDATION", message, { fieldErrors: { [key]: [message] } });
  }
}

function columnsFor(input: WarehouseSave) {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name,
    prefix: input.prefix.toUpperCase(),
    type: input.type,
    addressLine: input.addressLine,
    addressLine2: input.addressLine2,
    postalCode: input.postalCode,
    city: input.city,
    state: input.state,
    country: input.country,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    email: input.email,
    dayShiftStart: to24h(input.shiftStart, input.shiftStartZone),
    dayShiftEnd: to24h(input.shiftEnd, input.shiftEndZone),
    timezone: input.timezone,
    defaultDimensionUnit: input.defaultDimensionUnit,
    defaultWeightUnit: input.defaultWeightUnit,
    useLpDimsForPutaway: input.useLpDimsForPutaway,
    defaultReceivingLocationId: input.defaultReceivingLocationId,
    defaultShipLocationId: input.defaultShipLocationId,
    defaultReturnLocationId: input.defaultReturnLocationId,
    mandatoryAdjustmentReason: input.mandatoryAdjustmentReason,
    mandatoryCountReason: input.mandatoryCountReason,
    mobileAutoLogoutMinutes: input.mobileAutoLogout ? input.mobileAutoLogoutMinutes ?? 30 : null,
  };
}

function assertCodeFree(db: AppDb, code: string, exceptId?: string): void {
  const clash = db.select({ id: w.id }).from(w).where(sql`lower(${w.code}) = lower(${code})`).get();
  if (clash && clash.id !== exceptId) throw duplicateError("code", `Warehouse ${code} already exists`);
}

function display(db: AppDb, row: typeof w.$inferSelect): Record<string, unknown> {
  const locs = resolveIds(db, "locations", [row.defaultReceivingLocationId, row.defaultShipLocationId, row.defaultReturnLocationId]);
  const { id: _id, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, version: _v, defaultReceivingLocationId, defaultShipLocationId, defaultReturnLocationId, ...rest } = row;
  void _id; void _c; void _cb; void _u; void _ub; void _v;
  return {
    ...rest,
    defaultReceivingLocation: defaultReceivingLocationId ? locs.get(defaultReceivingLocationId) ?? "" : "",
    defaultShipLocation: defaultShipLocationId ? locs.get(defaultShipLocationId) ?? "" : "",
    defaultReturnLocation: defaultReturnLocationId ? locs.get(defaultReturnLocationId) ?? "" : "",
  };
}

/**
 * Operational locations a new warehouse needs before it can receive, pack, ship or take returns
 * (Logiwa ships with MLT1-RECV / MLT1-PACK / MLT1-SHIP but leaves creating them to the user).
 */
export const STARTER_LOCATIONS: readonly { readonly suffix: (typeof STARTER_LOCATION_SUFFIXES)[number]; readonly areaType: string; readonly locationType: string; readonly defaultKey: "defaultReceivingLocationId" | "defaultShipLocationId" | "defaultReturnLocationId" | null }[] = [
  { suffix: "RECV", areaType: "Receiving", locationType: "BusinessStation", defaultKey: "defaultReceivingLocationId" },
  { suffix: "PACK", areaType: "Packing", locationType: "BusinessStation", defaultKey: null },
  { suffix: "SHIP", areaType: "Shipment", locationType: "BusinessStation", defaultKey: "defaultShipLocationId" },
  { suffix: "RET", areaType: "Returns", locationType: "BusinessStation", defaultKey: "defaultReturnLocationId" },
];

/** "MLT2" + "RECV" -> "MLT2-RECV". */
export function starterLocationCode(prefix: string, suffix: string): string {
  return `${prefix.trim().toUpperCase()}-${suffix}`;
}

export function createWarehouse(tx: AppDb, auth: AuthContext, actor: Actor, input: WarehouseSave): { id: string; code: string; starterLocations: string[] } {
  if (auth.user.role !== "admin") throw new AppError("FORBIDDEN", "Only administrators can add warehouses");
  assertCodeFree(tx, input.code.trim());
  assertDefaultLocations(tx, null, { ...input, defaultReceivingLocationId: null, defaultShipLocationId: null, defaultReturnLocationId: null });
  const first = (tx.select({ n: sql<number>`count(*)` }).from(w).get()?.n ?? 0) === 0;
  const row = tx.insert(w).values({ ...columnsFor(input), defaultReceivingLocationId: null, defaultShipLocationId: null, defaultReturnLocationId: null, isDefault: first, createdBy: actor.userId, updatedBy: actor.userId })
    .returning({ id: w.id, code: w.code }).get();
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.code });
  const starterLocations: string[] = [];
  if (input.createStarterLocations) {
    // The request's scope was resolved before the warehouse existed; widen it for this transaction only.
    const scoped: AuthContext = { ...auth, scope: { ...auth.scope, warehouseIds: [...auth.scope.warehouseIds, row.id] } };
    const defaults: Partial<Record<"defaultReceivingLocationId" | "defaultShipLocationId" | "defaultReturnLocationId", string>> = {};
    for (const s0 of STARTER_LOCATIONS) {
      const code = starterLocationCode(input.prefix, s0.suffix);
      const save = locationSaveSchema.parse({ info: { ...LOCATION_INFO_DEFAULTS, code, warehouseId: row.id, areaType: s0.areaType, locationType: s0.locationType, displayMember: code }, productCapacities: [], lpCapacities: [] });
      const loc = createLocation(tx, scoped, actor, save);
      starterLocations.push(loc.code);
      if (s0.defaultKey) defaults[s0.defaultKey] = loc.id;
    }
    tx.update(w).set(defaults).where(eq(w.id, row.id)).run();
  }
  return { ...row, starterLocations };
}

export function updateWarehouse(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: WarehouseSave): { id: string; code: string; version: number } {
  const before = loadWarehouse(tx, auth, id);
  assertVersion(before.version, input.version);
  assertCodeFree(tx, input.code.trim(), id);
  assertDefaultLocations(tx, id, input);
  const snapshot = display(tx, before);
  const after = tx.update(w).set({ ...columnsFor(input), updatedBy: actor.userId, version: sql`${w.version} + 1` }).where(eq(w.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: after.code }, snapshot, display(tx, after));
  return { id, code: after.code, version: after.version };
}

export function setDefaultWarehouse(tx: AppDb, auth: AuthContext, actor: Actor, id: string): { id: string; code: string } {
  const row = loadWarehouse(tx, auth, id);
  if (!row.isActive) throw new AppError("INVALID_STATE", `${row.code} is inactive; activate it before making it the default`);
  if (row.isDefault) throw new AppError("INVALID_STATE", `${row.code} is already the default warehouse`);
  const ctx = domainCtxOf(actor, auth);
  const previous = tx.select({ id: w.id, code: w.code }).from(w).where(and(eq(w.isDefault, true), ne(w.id, id))).all();
  for (const p of previous) {
    tx.update(w).set({ isDefault: false, updatedBy: actor.userId, version: sql`${w.version} + 1` }).where(eq(w.id, p.id)).run();
    logUpdate(tx, ctx, { entityType: ENTITY, entityId: p.id, entityCode: p.code }, { isDefault: true }, { isDefault: false });
  }
  tx.update(w).set({ isDefault: true, updatedBy: actor.userId, version: sql`${w.version} + 1` }).where(eq(w.id, id)).run();
  logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: row.code }, { isDefault: false }, { isDefault: true });
  return { id, code: row.code };
}

/** Why a warehouse can't be deactivated, or null. */
export function deactivateBlocker(db: AppDb, row: Pick<typeof w.$inferSelect, "id" | "code" | "isDefault">): string | null {
  if (row.isDefault) return `${row.code} is the default warehouse; make another warehouse the default first`;
  const work = openWorkOf(db, row.id);
  const parts = [
    work.orders ? `${work.orders} open ${work.orders === 1 ? "order" : "orders"}` : null,
    work.purchaseOrders ? `${work.purchaseOrders} open ${work.purchaseOrders === 1 ? "PO" : "POs"}` : null,
    work.jobs ? `${work.jobs} open ${work.jobs === 1 ? "job" : "jobs"}` : null,
  ].filter(Boolean);
  return parts.length ? `${row.code} has ${parts.join(", ")}` : null;
}

export function setWarehousesActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], active: boolean): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadWarehouse(inner, auth, id);
    if (row.isActive === active) throw new AppError("INVALID_STATE", `${row.code} is already ${active ? "active" : "inactive"}`);
    if (!active) {
      const reason = deactivateBlocker(inner, row);
      if (reason) throw new AppError("INVALID_STATE", reason);
    }
    inner.update(w).set({ isActive: active, updatedBy: actor.userId, version: sql`${w.version} + 1` }).where(eq(w.id, id)).run();
    logUpdate(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.code }, { isActive: row.isActive }, { isActive: active });
  });
}
