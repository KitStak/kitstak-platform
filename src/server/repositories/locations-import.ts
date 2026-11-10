/**
 * Import appliers for the six M10 location import keys (locations, locations-update,
 * product-capacity(-update), lp-capacity(-update)). Every row goes through the same
 * `createLocation` / `updateLocation` commands as the wizard, so imports get identical
 * validation (zod `locationSaveSchema`), code-uniqueness, capacity checks and field-level
 * change_log rows. Template cells are mapped to the wizard's enums by `normalize*` (PURE).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import type { ImportApplyContext, ImportApplyResult, ImportRowValues } from "@/server/imports/types";
import { AREA_TYPES, LOCATION_TYPES } from "@/lib/enums";
import { LOCATION_INFO_DEFAULTS, locationSaveSchema, type LocationInfoInput, type LocationSaveInput } from "@/lib/grid-defs/facility/locations";
import { createLocation, getLocation, updateLocation, type LocationDetail } from "./locations";
import { type Actor } from "./locations-shared";

/* ---------------- pure cell helpers ---------------- */

export const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const has = (v: unknown): boolean => cell(v) !== "";
const squash = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, "");

const LOCATION_TYPE_ALIASES: Readonly<Record<string, (typeof LOCATION_TYPES)[number]>> = {
  rack: "Racks", racks: "Racks", shelf: "Shelves", shelves: "Shelves", shelving: "Shelves", bin: "Bins", bins: "Bins",
  virtual: "Virtual", businessstation: "BusinessStation", station: "BusinessStation", ramp: "Ramps", ramps: "Ramps",
};

const AREA_TYPE_ALIASES: Readonly<Record<string, (typeof AREA_TYPES)[number]>> = {
  pick: "Picking", picking: "Picking", storage: "Storage", reserve: "Storage", bulk: "Storage", receiving: "Receiving", receive: "Receiving",
  dock: "Receiving", returns: "Returns", return: "Returns", packing: "Packing", pack: "Packing", shipment: "Shipment", shipping: "Shipment",
  ship: "Shipment", kitting: "Kitting", kit: "Kitting", loading: "Loading", load: "Loading",
};

/** Maps a template "Location Type" cell to the wizard enum; throws a row error when unknown. */
export function normalizeLocationType(raw: string): (typeof LOCATION_TYPES)[number] {
  const hit = LOCATION_TYPE_ALIASES[squash(raw)];
  if (!hit) throw new AppError("VALIDATION", `Location type "${raw}" is not valid. Use one of: ${LOCATION_TYPES.join(", ")}`);
  return hit;
}

/** Maps a template "Area Type" cell to the wizard enum; throws a row error when unknown. */
export function normalizeAreaType(raw: string): (typeof AREA_TYPES)[number] {
  const hit = AREA_TYPE_ALIASES[squash(raw)];
  if (!hit) throw new AppError("VALIDATION", `Area type "${raw}" is not valid. Use one of: ${AREA_TYPES.join(", ")}`);
  return hit;
}

/** Template Column / Level are text ("01"); the wizard stores whole numbers. */
export function wholeNumber(raw: unknown, label: string): number {
  const text = cell(raw);
  if (!text) return 0;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) throw new AppError("VALIDATION", `${label} must be a whole number (got "${text}")`);
  return n;
}

const truthy = (v: unknown): boolean => v === true || ["yes", "true", "1", "y"].includes(cell(v).toLowerCase());

/** First zod issue of a failed save as a row error ("info.code: message"). */
function parseSave(input: LocationSaveInput) {
  const parsed = locationSaveSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.filter((p) => p !== "info").join(".") ?? "";
  throw new AppError("VALIDATION", field ? `${field}: ${issue?.message}` : issue?.message ?? "Invalid row");
}

/* ---------------- lookups ---------------- */

const actorOf = (ctx: ImportApplyContext): Actor => ({ userId: ctx.actor.userId, source: ctx.actor.source });

export function findWarehouseByCode(db: AppDb, auth: AuthContext, code: string): { id: string; code: string } {
  const row = db.select({ id: s.warehouses.id, code: s.warehouses.code }).from(s.warehouses).where(sql`lower(${s.warehouses.code}) = lower(${code})`).get();
  if (!row || !auth.scope.warehouseIds.includes(row.id)) throw new AppError("VALIDATION", `Warehouse "${code}" not found`);
  return row;
}

function findLocationId(db: AppDb, warehouseId: string, code: string): string | null {
  return db.select({ id: s.locations.id }).from(s.locations).where(and(eq(s.locations.warehouseId, warehouseId), sql`lower(${s.locations.code}) = lower(${code})`)).get()?.id ?? null;
}

function requireLocationId(db: AppDb, warehouseId: string, warehouseCode: string, code: string): string {
  const id = findLocationId(db, warehouseId, code);
  if (!id) throw new AppError("VALIDATION", `Location "${code}" not found in ${warehouseCode}`);
  return id;
}

function findClientId(db: AppDb, auth: AuthContext, code: string): string {
  const row = db.select({ id: s.clients.id }).from(s.clients).where(sql`lower(${s.clients.code}) = lower(${code})`).get();
  if (!row || !hasClient(auth.scope, row.id)) throw new AppError("VALIDATION", `Client "${code}" not found`);
  return row.id;
}

/** Warehouse-scoped location group / zone lookup by name; created when missing (same as the wizard's "+ Create"). */
function lookupId(db: AppDb, actor: Actor, type: "location_group" | "location_zone", warehouseId: string, name: string): string | null {
  if (!name) return null;
  const lv = s.lookupValues;
  const row = db.select({ id: lv.id }).from(lv)
    .where(and(eq(lv.type, type), sql`lower(${lv.name}) = lower(${name})`, sql`(${lv.warehouseId} = ${warehouseId} OR ${lv.warehouseId} IS NULL)`)).get();
  if (row) return row.id;
  return db.insert(lv).values({ type, name, warehouseId, isActive: true, sortOrder: 0, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: lv.id }).get().id;
}

/* ---------------- detail → save input ---------------- */

/** Server-side twin of the wizard's `detailToForm`: the current saved state as a save input. */
export function saveInputOf(d: LocationDetail): LocationSaveInput {
  return {
    info: {
      code: d.code, warehouseId: d.warehouseId, locationGroupId: d.locationGroupId, locationZoneId: d.locationZoneId,
      locationType: d.locationType ?? "Shelves", areaType: d.areaType ?? "Storage", replenishmentType: d.replenishmentType,
      walkingPathPriority: d.walkingPathPriority, capacityType: d.capacityType, maxCapacityQty: d.maxCapacityQty, maxSkuQty: d.maxSkuQty,
      mezzanine: d.mezzanine ?? "", aisle: d.aisle ?? "", rack: d.rack ?? d.bay ?? "", column: d.column, level: Number(d.level) || null, position: d.position ?? "",
      dimensionUnit: (d.dimensionUnit as LocationInfoInput["dimensionUnit"]) ?? "Inch", height: d.height, width: d.width, length: d.length,
      volumeUnit: (d.volumeUnit as LocationInfoInput["volumeUnit"]) ?? "Cubic Inch", volume: d.volume,
      displayMember: d.displayMember ?? "", barcode: d.barcode ?? "", abcCode: d.abcCode, singleClient: d.singleClient, isLocked: d.isLocked,
      dedicatedClientId: d.dedicatedClientId, printApplyOnPacking: d.printApplyOnPacking, colorCode: d.colorCode ?? "",
      preventAllocation: d.preventAllocation, preventInventorySync: d.preventInventorySync, onlyOneLot: d.onlyOneLot, onlyDamaged: d.onlyDamaged,
      onlyOneExpiry: d.onlyOneExpiry, onlyOneSku: d.onlyOneSku, onlyOneLp: d.onlyOneLp, onlyOneProductionDate: d.onlyOneProductionDate,
      autoRemoveLpAfterReplenishment: d.autoRemoveLpAfterReplenishment, autoRemoveLpAfterTransfer: d.autoRemoveLpAfterTransfer,
    },
    productCapacities: d.productCapacities.map((c) => ({ clientId: c.clientId, productId: c.productId, packType: c.packType, minQty: c.minQty, maxQty: c.maxQty })),
    lpCapacities: d.lpCapacities.map((c) => ({ lpTypeId: c.lpTypeId, minQty: c.minQty, maxQty: c.maxQty, assignProduct: Boolean(c.productId), clientId: c.clientId, productId: c.productId })),
    version: d.version,
  };
}

/** Overlays the non-empty template cells of a location row onto `info`. */
function overlayInfo(db: AppDb, ctx: ImportApplyContext, warehouseId: string, info: LocationInfoInput, row: ImportRowValues): LocationInfoInput {
  const actor = actorOf(ctx);
  const next: Record<string, unknown> = { ...info };
  if (has(row.zone)) next.locationZoneId = lookupId(db, actor, "location_zone", warehouseId, cell(row.zone));
  if (has(row.locationGroup)) next.locationGroupId = lookupId(db, actor, "location_group", warehouseId, cell(row.locationGroup));
  if (has(row.aisle)) next.aisle = cell(row.aisle);
  if (has(row.column)) next.column = wholeNumber(row.column, "Column");
  if (has(row.level)) next.level = wholeNumber(row.level, "Level");
  if (has(row.position)) next.position = cell(row.position);
  if (has(row.locationType)) next.locationType = normalizeLocationType(cell(row.locationType));
  if (has(row.areaType)) next.areaType = normalizeAreaType(cell(row.areaType));
  if (has(row.walkingPathPriority)) next.walkingPathPriority = Number(row.walkingPathPriority);
  if (has(row.clientCode)) {
    next.singleClient = true;
    next.dedicatedClientId = findClientId(db, ctx.auth, cell(row.clientCode));
  }
  if (has(row.isPickable)) next.preventAllocation = !truthy(row.isPickable);
  if (has(row.status)) next.isLocked = cell(row.status).toLowerCase() === "inactive";
  return next as LocationInfoInput;
}

/* ---------------- location rows ---------------- */

export function applyLocationImport(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const { db, auth } = ctx;
  const wh = findWarehouseByCode(db, auth, cell(row.warehouseCode));
  const code = cell(row.code);
  if (findLocationId(db, wh.id, code)) throw new AppError("VALIDATION", `Location ${code} already exists in ${wh.code}; use Bulk Update to change it`);
  const info = overlayInfo(db, ctx, wh.id, { ...LOCATION_INFO_DEFAULTS, code, warehouseId: wh.id, areaType: "Storage" }, row);
  const created = createLocation(db, auth, actorOf(ctx), parseSave({ info, productCapacities: [], lpCapacities: [] }));
  return { entityId: created.id, message: `Created location ${created.code}` };
}

export function applyLocationUpdateImport(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const { db, auth } = ctx;
  const wh = findWarehouseByCode(db, auth, cell(row.warehouseCode));
  const id = requireLocationId(db, wh.id, wh.code, cell(row.code));
  const current = saveInputOf(getLocation(db, auth, id));
  const info = overlayInfo(db, ctx, wh.id, current.info, row);
  const saved = updateLocation(db, auth, actorOf(ctx), id, parseSave({ ...current, info }));
  return { entityId: id, message: `Updated location ${saved.code}` };
}

/* ---------------- product capacity rows ---------------- */

function primaryPackType(db: AppDb, productId: string): string {
  const pt = s.productPackTypes;
  return db.select({ packType: pt.packType }).from(pt).where(eq(pt.productId, productId)).orderBy(sql`CASE WHEN ${pt.kind} = 'Primary' THEN 0 ELSE 1 END`, asc(pt.uomQty)).get()?.packType ?? "Each";
}

function productCapacityRow(ctx: ImportApplyContext, row: ImportRowValues, mode: "add" | "update"): ImportApplyResult {
  const { db, auth } = ctx;
  const wh = findWarehouseByCode(db, auth, cell(row.warehouseCode));
  const id = requireLocationId(db, wh.id, wh.code, cell(row.locationCode));
  const clientCode = cell(row.clientCode);
  const clientId = findClientId(db, auth, clientCode);
  const sku = cell(row.sku);
  const product = db.select({ id: s.products.id }).from(s.products).where(and(eq(s.products.clientId, clientId), sql`lower(${s.products.sku}) = lower(${sku})`)).get();
  if (!product) throw new AppError("VALIDATION", `SKU "${sku}" not found for client ${clientCode}`);
  const current = saveInputOf(getLocation(db, auth, id));
  const caps = current.productCapacities ?? [];
  const index = caps.findIndex((c) => c.productId === product.id);
  const maxQty = Number(row.maxQty);
  if (mode === "add" && index >= 0) throw new AppError("VALIDATION", `${sku} already has a capacity in ${cell(row.locationCode)}; use Bulk Update Product Capacity`);
  if (mode === "update" && index < 0) throw new AppError("VALIDATION", `${sku} has no capacity in ${cell(row.locationCode)} yet; use Bulk Import Product Capacity`);
  const existing = index >= 0 ? caps[index] : undefined;
  const minQty = has(row.minQty) ? Number(row.minQty) : existing?.minQty ?? 0;
  const entry = { clientId, productId: product.id, packType: existing?.packType ?? primaryPackType(db, product.id), minQty, maxQty };
  const productCapacities = index >= 0 ? caps.map((c, i) => (i === index ? entry : c)) : [...caps, entry];
  updateLocation(db, auth, actorOf(ctx), id, parseSave({ ...current, productCapacities }));
  return { entityId: id, message: `${mode === "add" ? "Added" : "Updated"} ${sku} capacity ${minQty}-${maxQty}` };
}

export const applyProductCapacityImport = (ctx: ImportApplyContext, row: ImportRowValues) => productCapacityRow(ctx, row, "add");
export const applyProductCapacityUpdateImport = (ctx: ImportApplyContext, row: ImportRowValues) => productCapacityRow(ctx, row, "update");

/* ---------------- LP capacity rows ---------------- */

function lpCapacityRow(ctx: ImportApplyContext, row: ImportRowValues, mode: "add" | "update"): ImportApplyResult {
  const { db, auth } = ctx;
  const wh = findWarehouseByCode(db, auth, cell(row.warehouseCode));
  const id = requireLocationId(db, wh.id, wh.code, cell(row.locationCode));
  const typeCode = cell(row.lpType);
  const type = db.select({ id: s.lpTypes.id, code: s.lpTypes.code }).from(s.lpTypes).where(and(eq(s.lpTypes.warehouseId, wh.id), sql`lower(${s.lpTypes.code}) = lower(${typeCode})`)).get();
  if (!type) throw new AppError("VALIDATION", `LP type "${typeCode}" not found in ${wh.code}`);
  const current = saveInputOf(getLocation(db, auth, id));
  const caps = current.lpCapacities ?? [];
  const index = caps.findIndex((c) => c.lpTypeId === type.id);
  if (mode === "add" && index >= 0) throw new AppError("VALIDATION", `${type.code} already has a capacity in ${cell(row.locationCode)}; use Bulk Update LP Capacity`);
  if (mode === "update" && index < 0) throw new AppError("VALIDATION", `${type.code} has no capacity in ${cell(row.locationCode)} yet; use Bulk Import LP Capacity`);
  const maxQty = Number(row.maxLps);
  const existing = index >= 0 ? caps[index] : undefined;
  const entry = { lpTypeId: type.id, minQty: Math.min(existing?.minQty ?? 0, maxQty), maxQty, assignProduct: existing?.assignProduct ?? false, clientId: existing?.clientId ?? null, productId: existing?.productId ?? null };
  const lpCapacities = index >= 0 ? caps.map((c, i) => (i === index ? entry : c)) : [...caps, entry];
  updateLocation(db, auth, actorOf(ctx), id, parseSave({ ...current, lpCapacities }));
  return { entityId: id, message: `${mode === "add" ? "Added" : "Updated"} ${type.code} capacity (max ${maxQty})` };
}

export const applyLpCapacityImport = (ctx: ImportApplyContext, row: ImportRowValues) => lpCapacityRow(ctx, row, "add");
export const applyLpCapacityUpdateImport = (ctx: ImportApplyContext, row: ImportRowValues) => lpCapacityRow(ctx, row, "update");
