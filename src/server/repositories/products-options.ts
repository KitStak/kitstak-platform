/**
 * Option sources and inline validators for the product wizard and grid filters (M09):
 * clients, client-scoped product types/groups, pack-type master, shipment packages,
 * sales channels, warehouses, SKU / barcode uniqueness and kit component search.
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { hasClient, scopedWhere, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { escapeLike } from "@/server/query/filters";
import { DEFAULT_PACK_TYPES } from "@/lib/grid-defs/products/catalog-options";

const { products: p, clients, lookupValues: lv, shipmentPackages, channelConnections, warehouses, productBarcodes, kitComponents } = schema;

export interface Option {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface ProductGridOptions {
  readonly clients: readonly Option[];
  readonly productTypes: readonly Option[];
  readonly productGroups: readonly Option[];
  readonly packTypes: readonly Option[];
}

function clientOptions(db: AppDb, scope: Scope): Option[] {
  return db.select({ id: clients.id, code: clients.code, name: clients.name }).from(clients)
    .where(scope.clientIds === "all" ? undefined : inArray(clients.id, [...scope.clientIds, "__none__"]))
    .orderBy(asc(clients.name)).all()
    .map((c) => ({ value: c.id, label: c.name, description: c.code }));
}

function lookupScope(scope: Scope) {
  return scope.clientIds === "all" ? undefined : or(isNull(lv.clientId), inArray(lv.clientId, [...scope.clientIds, "__none__"]));
}

export function packTypeNames(db: AppDb): string[] {
  const rows = db.select({ name: lv.name }).from(lv).where(and(eq(lv.type, "pack_type"), eq(lv.isActive, true)))
    .orderBy(asc(lv.sortOrder), asc(lv.name)).all().map((r) => r.name);
  return rows.length ? [...new Set(rows)] : [...DEFAULT_PACK_TYPES];
}

/** Grid filter options (names dedupe across clients: filters match on lookup name). */
export function getGridOptions(db: AppDb, scope: Scope): ProductGridOptions {
  const names = (type: "product_type" | "product_group"): Option[] =>
    [...new Set(db.select({ name: lv.name }).from(lv).where(and(eq(lv.type, type), lookupScope(scope))).all().map((r) => r.name))]
      .sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  return {
    clients: clientOptions(db, scope),
    productTypes: names("product_type"),
    productGroups: names("product_group"),
    packTypes: packTypeNames(db).map((n) => ({ value: n, label: n })),
  };
}

export interface WizardOptions {
  readonly clients: readonly Option[];
  readonly productTypes: readonly Option[];
  readonly productGroups: readonly Option[];
  readonly packTypes: readonly Option[];
  readonly shipmentPackages: readonly Option[];
  readonly channels: readonly Option[];
  readonly warehouses: readonly Option[];
}

/** Everything the wizard needs for one client (client-scoped lists are empty without one). */
export function getWizardOptions(db: AppDb, scope: Scope, clientId: string | null): WizardOptions {
  const forClient = clientId && hasClient(scope, clientId) ? clientId : null;
  const lookup = (type: "product_type" | "product_group"): Option[] => forClient
    ? db.select({ id: lv.id, name: lv.name }).from(lv)
      .where(and(eq(lv.type, type), eq(lv.isActive, true), or(eq(lv.clientId, forClient), isNull(lv.clientId))))
      .orderBy(asc(lv.name)).all().map((r) => ({ value: r.id, label: r.name }))
    : [];
  const packages = db.select({ id: shipmentPackages.id, code: shipmentPackages.code, description: shipmentPackages.description, l: shipmentPackages.length, w: shipmentPackages.width, h: shipmentPackages.height })
    .from(shipmentPackages)
    .where(and(eq(shipmentPackages.isActive, true), scopedWhere(shipmentPackages, scope)))
    .orderBy(asc(shipmentPackages.code)).all()
    .map((s) => ({ value: s.id, label: s.code, description: s.description ?? `${s.l}×${s.w}×${s.h}` }));
  const channels = forClient
    ? db.select({ id: channelConnections.id, store: channelConnections.storeName, provider: channelConnections.provider }).from(channelConnections)
      .where(and(eq(channelConnections.clientId, forClient), eq(channelConnections.isActive, true)))
      .orderBy(asc(channelConnections.storeName)).all().map((c) => ({ value: c.id, label: c.store, description: c.provider }))
    : [];
  const whs = db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses)
    .where(inArray(warehouses.id, [...scope.warehouseIds, "__none__"])).orderBy(asc(warehouses.code)).all()
    .map((w) => ({ value: w.id, label: w.name, description: w.code }));
  return {
    clients: clientOptions(db, scope),
    productTypes: lookup("product_type"),
    productGroups: lookup("product_group"),
    packTypes: packTypeNames(db).map((n) => ({ value: n, label: n })),
    shipmentPackages: packages,
    channels,
    warehouses: whs,
  };
}

export const skuCheckSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  sku: z.string().trim().min(1).max(100),
  excludeId: z.string().trim().max(64).optional(),
});

/** Inline uniqueness: a SKU is unique per client. */
export function checkSku(db: AppDb, scope: Scope, input: z.output<typeof skuCheckSchema>): { available: boolean; productId: string | null } {
  if (!hasClient(scope, input.clientId)) return { available: true, productId: null };
  const row = db.select({ id: p.id }).from(p)
    .where(and(eq(p.clientId, input.clientId), sql`lower(${p.sku}) = lower(${input.sku})`, input.excludeId ? ne(p.id, input.excludeId) : undefined)).get();
  return { available: !row, productId: row?.id ?? null };
}

export const barcodeCheckSchema = z.object({
  barcodes: z.string().trim().min(1).max(4000),
  excludeProductId: z.string().trim().max(64).optional(),
});

export interface BarcodeUse {
  readonly barcode: string;
  readonly productId: string;
  readonly sku: string;
  readonly clientName: string;
  readonly packType: string;
}

/** Where each barcode is already used (in scope), so the chip input can warn. */
export function checkBarcodes(db: AppDb, scope: Scope, input: z.output<typeof barcodeCheckSchema>): BarcodeUse[] {
  const codes = [...new Set(input.barcodes.split(",").map((b) => b.trim()).filter(Boolean))].slice(0, 100);
  if (codes.length === 0) return [];
  const pt = schema.productPackTypes;
  return db.select({ barcode: productBarcodes.barcode, productId: p.id, sku: p.sku, clientName: clients.name, packType: pt.packType })
    .from(productBarcodes)
    .innerJoin(p, eq(p.id, productBarcodes.productId))
    .innerJoin(clients, eq(clients.id, p.clientId))
    .innerJoin(pt, eq(pt.id, productBarcodes.packTypeId))
    .where(and(inArray(productBarcodes.barcode, codes), scopedWhere(p, scope), input.excludeProductId ? ne(p.id, input.excludeProductId) : undefined))
    .limit(100).all();
}

export const componentSearchSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  q: z.string().trim().max(100).default(""),
  excludeId: z.string().trim().max(64).optional(),
});

export interface ComponentOption {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly category: string;
  readonly kitType: string | null;
  readonly available: number;
}

/** Kit component search: the kit's client only; standard products and kit-to-stock kits. */
export function searchComponents(db: AppDb, scope: Scope, input: z.output<typeof componentSearchSchema>): ComponentOption[] {
  if (!hasClient(scope, input.clientId)) return [];
  const pattern = `%${escapeLike(input.q)}%`;
  const wh = scope.warehouseIds.length ? sql.join(scope.warehouseIds.map((w) => sql`${w}`), sql`, `) : sql`NULL`;
  return db.all<ComponentOption>(sql`
    SELECT p.id, p.sku, p.name, p.image_url AS imageUrl, p.uom, p.product_category AS category, p.kit_type AS kitType,
      COALESCE((SELECT SUM(i.on_hand - i.allocated - i.damaged) FROM inventory i WHERE i.product_id = p.id AND i.warehouse_id IN (${wh})), 0) AS available
    FROM products p
    WHERE p.client_id = ${input.clientId} AND p.status = 'Active' AND p.product_category <> 'Packaging Material'
      AND (p.product_category <> 'Kit' OR p.kit_type = 'Kit to Stock')
      ${input.excludeId ? sql`AND p.id <> ${input.excludeId}` : sql``}
      AND (p.sku LIKE ${pattern} ESCAPE '\\' OR p.name LIKE ${pattern} ESCAPE '\\' OR p.barcode LIKE ${pattern} ESCAPE '\\')
    ORDER BY p.sku LIMIT 25`).map((r) => ({ ...r, available: Number(r.available) }));
}

/** Kits that contain `productId` (for the delete guard and "Used in kits"). */
export function kitsUsing(db: AppDb, productId: string): { id: string; sku: string; name: string; quantity: number }[] {
  return db.select({ id: p.id, sku: p.sku, name: p.name, quantity: kitComponents.quantity }).from(kitComponents)
    .innerJoin(p, eq(p.id, kitComponents.kitProductId))
    .where(eq(kitComponents.componentProductId, productId)).orderBy(asc(p.sku)).all();
}
