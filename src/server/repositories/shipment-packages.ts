/**
 * Shipment Packages repository (M10): grid, detail (client access matrix + inventory tracking),
 * create/update across the 4 wizard steps, and guarded delete (blocked once a package has been
 * used by shipments, orders or products, so history keeps resolving).
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { createProduct } from "@/server/domain/products";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { round } from "@/lib/grid-defs/facility/common";
import { SHIPMENT_PACKAGE_FIELDS, SHIPMENT_PACKAGE_SEARCH_FIELDS, SHIPMENT_PACKAGE_SORT_FIELDS, type ShipmentPackageSave } from "@/lib/grid-defs/facility/shipment-packages";
import { assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, listScope, logCreate, logDelete, logUpdate, resolveIds, type Actor, type GridBinding, qc } from "./locations-shared";

const t = s.shipmentPackages;
const ENTITY = "shipment_package";

const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(t.warehouseId)})`;
const clientCountSql = sql<number>`(SELECT COUNT(*) FROM shipment_package_clients pc WHERE pc.package_id = ${qc(t.id)} AND pc.has_access = 1)`;
const skuSql = sql<string | null>`(SELECT p.sku FROM products p WHERE p.id = ${qc(t.inventoryProductId)})`;
const ownerSql = sql<string | null>`(SELECT c.code FROM clients c WHERE c.id = ${qc(t.inventoryClientId)})`;
const reductionLocationSql = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${qc(t.reductionLocationId)})`;

export const SHIPMENT_PACKAGE_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${t.code}`,
  description: sql`${t.description}`,
  warehouseId: sql`${t.warehouseId}`,
  warehouseCode: warehouseCodeSql,
  trackInventory: sql`${t.trackInventory}`,
  reductionRule: sql`${t.reductionRule}`,
  length: sql`${t.length}`,
  width: sql`${t.width}`,
  height: sql`${t.height}`,
  dimensionUnit: sql`${t.dimensionUnit}`,
  emptyWeight: sql`${t.emptyWeight}`,
  maxWeight: sql`${t.maxWeight}`,
  weightUnit: sql`${t.weightUnit}`,
  maxVolume: sql`${t.maxVolume}`,
  volumeUnit: sql`${t.volumeUnit}`,
  purchasePrice: sql`${t.purchasePrice}`,
  isActive: sql`${t.isActive}`,
  allClients: sql`${t.allClients}`,
  createdAt: sql`${t.createdAt}`,
};

const BINDING: GridBinding = {
  exprs: SHIPMENT_PACKAGE_SQL, fields: SHIPMENT_PACKAGE_FIELDS, sortable: SHIPMENT_PACKAGE_SORT_FIELDS, search: SHIPMENT_PACKAGE_SEARCH_FIELDS,
  defaultSort: [{ field: "code", dir: "asc" }], tiebreaker: t.id,
};

export interface ShipmentPackageRow {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly trackInventory: boolean;
  readonly reductionRule: string | null;
  readonly inventorySku: string | null;
  readonly inventoryOwner: string | null;
  readonly reductionLocationCode: string | null;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly dimensionUnit: string;
  readonly emptyWeight: number;
  readonly maxWeight: number | null;
  readonly weightUnit: string;
  readonly maxVolume: number | null;
  readonly volumeUnit: string;
  readonly currency: string;
  readonly purchasePrice: number;
  readonly isActive: boolean;
  readonly allClients: boolean;
  readonly clientCount: number;
  /** Usage counts that block delete (see `packageDeleteBlocker`). */
  readonly shipmentCount: number;
  readonly orderCount: number;
  readonly productCount: number;
  readonly createdAt: string;
  readonly version: number;
}

const ROW_SELECT = {
  id: t.id, code: t.code, description: t.description, warehouseId: t.warehouseId, warehouseCode: warehouseCodeSql, trackInventory: t.trackInventory,
  reductionRule: t.reductionRule, inventorySku: skuSql, inventoryOwner: ownerSql, reductionLocationCode: reductionLocationSql,
  length: t.length, width: t.width, height: t.height, dimensionUnit: t.dimensionUnit, emptyWeight: t.emptyWeight, maxWeight: t.maxWeight,
  weightUnit: t.weightUnit, maxVolume: t.maxVolume, volumeUnit: t.volumeUnit, currency: t.currency, purchasePrice: t.purchasePrice,
  isActive: t.isActive, allClients: t.allClients, clientCount: clientCountSql,
  shipmentCount: sql<number>`(SELECT COUNT(*) FROM shipments sh WHERE sh.shipment_package_id = ${qc(t.id)})`,
  orderCount: sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.shipment_package_id = ${qc(t.id)})`,
  productCount: sql<number>`((SELECT COUNT(*) FROM products p WHERE p.use_ship_package_id = ${qc(t.id)}) + (SELECT COUNT(*) FROM product_pack_types ppt WHERE ppt.use_ship_package_id = ${qc(t.id)}))`,
  createdAt: t.createdAt, version: t.version,
};

const normalize = (r: Record<string, unknown>): ShipmentPackageRow =>
  ({ ...r, trackInventory: Boolean(r.trackInventory), isActive: Boolean(r.isActive), allClients: Boolean(r.allClients) }) as unknown as ShipmentPackageRow;

export function listShipmentPackages(db: AppDb, auth: AuthContext, query: GridQuery): { rows: ShipmentPackageRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [listScope(t, auth)]);
  const result = paginate(
    db.select(ROW_SELECT).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as unknown as Record<string, unknown>[]).map(normalize), total: result.total };
}

export function loadShipmentPackage(db: AppDb, auth: AuthContext, id: string): typeof t.$inferSelect {
  const row = assertFound(db.select().from(t).where(eq(t.id, id)).get(), "Shipment package");
  assertWarehouseInScope(auth, row.warehouseId, "Shipment package");
  return row;
}

export function packageUsage(db: AppDb, id: string): { shipments: number; orders: number; products: number } {
  const n = (q: SQL) => db.get<{ n: number }>(q)?.n ?? 0;
  return {
    shipments: n(sql`SELECT COUNT(*) AS n FROM shipments WHERE shipment_package_id = ${id}`),
    orders: n(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE shipment_package_id = ${id}`),
    products: n(sql`SELECT (SELECT COUNT(*) FROM products WHERE use_ship_package_id = ${id}) + (SELECT COUNT(*) FROM product_pack_types WHERE use_ship_package_id = ${id}) AS n`),
  };
}

export function getShipmentPackage(db: AppDb, auth: AuthContext, id: string) {
  const base = loadShipmentPackage(db, auth, id);
  const row = normalize(db.select(ROW_SELECT).from(t).where(eq(t.id, id)).get() as unknown as Record<string, unknown>);
  const access = db.select({ clientId: s.shipmentPackageClients.clientId, hasAccess: s.shipmentPackageClients.hasAccess, code: s.clients.code, name: s.clients.name })
    .from(s.shipmentPackageClients).innerJoin(s.clients, eq(s.clients.id, s.shipmentPackageClients.clientId))
    .where(eq(s.shipmentPackageClients.packageId, id)).orderBy(asc(s.clients.code)).all()
    .map((a) => ({ ...a, hasAccess: Boolean(a.hasAccess) }));
  const productName = base.inventoryProductId ? db.select({ name: s.products.name }).from(s.products).where(eq(s.products.id, base.inventoryProductId)).get()?.name ?? null : null;
  return {
    ...row, inventoryClientId: base.inventoryClientId, inventoryProductId: base.inventoryProductId, inventoryProductName: productName,
    reductionLocationId: base.reductionLocationId, customFields: base.customFields, access, usage: packageUsage(db, id),
  };
}

export type ShipmentPackageDetail = ReturnType<typeof getShipmentPackage>;

function assertCodeFree(db: AppDb, warehouseId: string, code: string, exceptId?: string): void {
  const clash = db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, warehouseId), sql`lower(${t.code}) = lower(${code})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("code", `Shipment package ${code} already exists in this warehouse`);
}

const fieldError = (field: string, message: string) => new AppError("VALIDATION", message, { fieldErrors: { [field]: [message] } });

/** Checks the client access list and the inventory-tracking references against scope and the warehouse. */
function assertReferences(db: AppDb, auth: AuthContext, input: ShipmentPackageSave): void {
  if (!input.allClients) {
    const ids = input.clientAccess.map((a) => a.clientId);
    const found = new Set(db.select({ id: s.clients.id }).from(s.clients).where(inArray(s.clients.id, ids)).all().map((c) => c.id));
    const bad = ids.find((id) => !found.has(id) || !hasClient(auth.scope, id));
    if (bad) throw fieldError("clientAccess", "One of the selected clients is not available to you");
  }
  if (!input.trackInventory) return;
  if (!input.inventoryClientId || !hasClient(auth.scope, input.inventoryClientId)) throw fieldError("inventoryClientId", "Inventory owner is not available to you");
  if (input.trackingMethod === "auto" && !input.inventoryProductId) return; // created by ensurePackagingSku
  const product = input.inventoryProductId ? db.select({ clientId: s.products.clientId, category: s.products.productCategory }).from(s.products).where(eq(s.products.id, input.inventoryProductId)).get() : undefined;
  if (!product || product.clientId !== input.inventoryClientId) throw fieldError("inventoryProductId", "Choose a SKU of the inventory owner");
  if (input.reductionRule === "Specific Location") {
    const loc = input.reductionLocationId ? db.select({ warehouseId: s.locations.warehouseId }).from(s.locations).where(eq(s.locations.id, input.reductionLocationId)).get() : undefined;
    if (!loc || loc.warehouseId !== input.warehouseId) throw fieldError("reductionLocationId", "Choose a location in this warehouse");
  }
}

function columnsFor(input: ShipmentPackageSave) {
  const tracked = input.trackInventory;
  return {
    warehouseId: input.warehouseId, code: input.code.trim().toUpperCase(), description: input.description,
    weightUnit: input.weightUnit, emptyWeight: round(input.emptyWeight), maxWeight: input.maxWeight === null ? null : round(input.maxWeight),
    dimensionUnit: input.dimensionUnit, length: round(input.length), width: round(input.width), height: round(input.height),
    volumeUnit: input.volumeUnit, maxVolume: input.maxVolume === null ? null : round(input.maxVolume, 3),
    currency: input.currency, purchasePrice: round(input.purchasePrice), isActive: input.isActive, allClients: input.allClients,
    trackInventory: tracked,
    inventoryClientId: tracked ? input.inventoryClientId : null,
    inventoryProductId: tracked ? input.inventoryProductId : null,
    reductionRule: tracked ? input.reductionRule : null,
    reductionLocationId: tracked && input.reductionRule === "Specific Location" ? input.reductionLocationId : null,
    customFields: input.customFields,
  };
}

function writeAccess(tx: AppDb, packageId: string, input: ShipmentPackageSave): void {
  tx.delete(s.shipmentPackageClients).where(eq(s.shipmentPackageClients.packageId, packageId)).run();
  if (input.allClients || input.clientAccess.length === 0) return;
  const unique = new Map(input.clientAccess.map((a) => [a.clientId, a.hasAccess]));
  tx.insert(s.shipmentPackageClients).values([...unique].map(([clientId, hasAccess]) => ({ packageId, clientId, hasAccess }))).run();
}

function display(db: AppDb, row: typeof t.$inferSelect): Record<string, unknown> {
  const wh = resolveIds(db, "warehouses", [row.warehouseId]);
  const cl = resolveIds(db, "clients", [row.inventoryClientId]);
  const pr = resolveIds(db, "products", [row.inventoryProductId]);
  const lo = resolveIds(db, "locations", [row.reductionLocationId]);
  const access = db.select({ code: s.clients.code }).from(s.shipmentPackageClients).innerJoin(s.clients, eq(s.clients.id, s.shipmentPackageClients.clientId))
    .where(and(eq(s.shipmentPackageClients.packageId, row.id), eq(s.shipmentPackageClients.hasAccess, true))).orderBy(asc(s.clients.code)).all().map((c) => c.code);
  return {
    code: row.code, description: row.description, warehouse: wh.get(row.warehouseId) ?? "",
    weightUnit: row.weightUnit, emptyWeight: row.emptyWeight, maxWeight: row.maxWeight, dimensionUnit: row.dimensionUnit,
    length: row.length, width: row.width, height: row.height, volumeUnit: row.volumeUnit, maxVolume: row.maxVolume,
    currency: row.currency, purchasePrice: row.purchasePrice, isActive: row.isActive,
    clientAccess: row.allClients ? "All clients" : access.join(", ") || "None",
    trackInventory: row.trackInventory, inventoryOwner: row.inventoryClientId ? cl.get(row.inventoryClientId) ?? "" : null,
    packagingSku: row.inventoryProductId ? pr.get(row.inventoryProductId) ?? "" : null, reductionRule: row.reductionRule,
    reductionLocation: row.reductionLocationId ? lo.get(row.reductionLocationId) ?? "" : null,
    ...Object.fromEntries(Object.entries(row.customFields ?? {}).map(([k, v]) => [`customField.${k}`, v])),
  };
}

/**
 * "Auto-create new SKU" (Logiwa's Inventory Tracking Method): the owner gets a Packaging Material
 * product named after the package (SKU = package code, box dimensions and empty weight). An
 * existing SKU with that code for the owner is matched instead of duplicated.
 */
export function ensurePackagingSku(tx: AppDb, auth: AuthContext, actor: Actor, input: ShipmentPackageSave): ShipmentPackageSave {
  if (!input.trackInventory || input.trackingMethod !== "auto" || input.inventoryProductId || !input.inventoryClientId) return input;
  const sku = input.code.trim().toUpperCase();
  const existing = tx.select({ id: s.products.id }).from(s.products).where(and(eq(s.products.clientId, input.inventoryClientId), sql`upper(${s.products.sku}) = ${sku}`)).get();
  if (existing) return { ...input, inventoryProductId: existing.id };
  const inch = ({ Inch: 1, Foot: 12, Centimeter: 1 / 2.54, Meter: 100 / 2.54 } as Record<string, number>)[input.dimensionUnit] ?? 1;
  const ounce = ({ Ounce: 1, Pound: 16, Gram: 1 / 28.3495, Kilogram: 35.274 } as Record<string, number>)[input.weightUnit] ?? 1;
  const product = createProduct(tx, domainCtxOf(actor, auth), {
    clientId: input.inventoryClientId, sku, name: input.description?.trim() || `Shipment package ${sku}`, category: "Packaging", productCategory: "Packaging Material",
    lengthIn: round(input.length * inch), widthIn: round(input.width * inch), heightIn: round(input.height * inch), weightOz: round(input.emptyWeight * ounce), purchasePrice: round(input.purchasePrice),
  });
  return { ...input, inventoryProductId: product.id };
}

export function createShipmentPackage(tx: AppDb, auth: AuthContext, actor: Actor, raw: ShipmentPackageSave): { id: string; code: string } {
  assertWarehouseInScope(auth, raw.warehouseId);
  assertCodeFree(tx, raw.warehouseId, raw.code.trim());
  assertReferences(tx, auth, raw);
  const input = ensurePackagingSku(tx, auth, actor, raw);
  const row = tx.insert(t).values({ ...columnsFor(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: t.id, code: t.code }).get();
  writeAccess(tx, row.id, input);
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.code });
  return row;
}

export function updateShipmentPackage(tx: AppDb, auth: AuthContext, actor: Actor, id: string, raw: ShipmentPackageSave): { id: string; code: string; version: number } {
  const before = loadShipmentPackage(tx, auth, id);
  assertVersion(before.version, raw.version);
  if (raw.warehouseId !== before.warehouseId) throw fieldError("warehouseId", "A shipment package can't move to another warehouse");
  assertCodeFree(tx, before.warehouseId, raw.code.trim(), id);
  assertReferences(tx, auth, raw);
  const input = ensurePackagingSku(tx, auth, actor, raw);
  const snapshot = display(tx, before);
  const after = tx.update(t).set({ ...columnsFor(input), updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).returning().get();
  writeAccess(tx, id, input);
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: after.code }, snapshot, display(tx, after));
  return { id, code: after.code, version: after.version };
}

/** Why a package can't be deleted, or null (used packages are deactivated instead). */
export function packageDeleteBlocker(db: AppDb, id: string): string | null {
  const u = packageUsage(db, id);
  if (u.shipments > 0) return `was used by ${u.shipments} ${u.shipments === 1 ? "shipment" : "shipments"}; set it inactive instead`;
  if (u.orders > 0) return `is set on ${u.orders} shipment ${u.orders === 1 ? "order" : "orders"}`;
  if (u.products > 0) return `is the required box of ${u.products} ${u.products === 1 ? "product" : "products"}`;
  return null;
}

export function deleteShipmentPackages(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadShipmentPackage(inner, auth, id);
    const reason = packageDeleteBlocker(inner, id);
    if (reason) throw new AppError("INVALID_STATE", `${row.code} ${reason}`);
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.code, warehouseId: row.warehouseId });
  });
}
