/**
 * Option sources and inline validators for the product wizard and grid filters (M09):
 * clients, client-scoped product types/groups, pack-type master, shipment packages,
 * sales channels, warehouses, SKU / barcode uniqueness and kit component search.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { hasClient, scopedWhere, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { escapeLike } from "@/server/query/filters";
import { DEFAULT_PACK_TYPES } from "@/lib/grid-defs/products/catalog-options";
import { dbAll } from "@/server/db/sql";

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

/**
 * "Use this shipping box only" options. Packages are per warehouse, so the same code exists
 * once per warehouse: a code that repeats is labelled with its warehouse ("BOX-L-1612 · MLT1"),
 * a unique code stays bare. The description keeps the box description / L×W×H.
 */
export function shipmentPackageOptions(rows: readonly { id: string; code: string; description: string | null; l: number; w: number; h: number; warehouse: string | null }[]): Option[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.code, (count.get(r.code) ?? 0) + 1);
  return rows.map((s) => ({
    value: s.id,
    label: (count.get(s.code) ?? 0) > 1 && s.warehouse ? `${s.code} · ${s.warehouse}` : s.code,
    description: s.description ?? `${s.l}×${s.w}×${s.h}`,
  }));
}

async function clientOptions(db: AppDb, scope: Scope): Promise<Option[]> {
  return (await db.select({ id: clients.id, code: clients.code, name: clients.name }).from(clients)
    .where(scope.clientIds === "all" ? undefined : inArray(clients.id, [...scope.clientIds, "__none__"]))
    .orderBy(asc(clients.name)))
    .map((c) => ({ value: c.id, label: c.name, description: c.code }));
}

function lookupScope(scope: Scope) {
  return scope.clientIds === "all" ? undefined : or(isNull(lv.clientId), inArray(lv.clientId, [...scope.clientIds, "__none__"]));
}

export async function packTypeNames(db: AppDb): Promise<string[]> {
  const rows = (await db.select({ name: lv.name }).from(lv).where(and(eq(lv.type, "pack_type"), eq(lv.isActive, true)))
    .orderBy(asc(lv.sortOrder), asc(lv.name))).map((r) => r.name);
  return rows.length ? [...new Set(rows)] : [...DEFAULT_PACK_TYPES];
}

/** Grid filter options (names dedupe across clients: filters match on lookup name). */
export async function getGridOptions(db: AppDb, scope: Scope): Promise<ProductGridOptions> {
  const names = async (type: "product_type" | "product_group"): Promise<Option[]> =>
    [...new Set((await db.select({ name: lv.name }).from(lv).where(and(eq(lv.type, type), lookupScope(scope)))).map((r) => r.name))]
      .sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  return {
    clients: await clientOptions(db, scope),
    productTypes: await names("product_type"),
    productGroups: await names("product_group"),
    packTypes: (await packTypeNames(db)).map((n) => ({ value: n, label: n })),
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
export async function getWizardOptions(db: AppDb, scope: Scope, clientId: string | null): Promise<WizardOptions> {
  const forClient = clientId && hasClient(scope, clientId) ? clientId : null;
  const lookup = async (type: "product_type" | "product_group"): Promise<Option[]> => forClient
    ? (await db.select({ id: lv.id, name: lv.name }).from(lv)
      .where(and(eq(lv.type, type), eq(lv.isActive, true), or(eq(lv.clientId, forClient), isNull(lv.clientId))))
      .orderBy(asc(lv.name))).map((r) => ({ value: r.id, label: r.name }))
    : [];
  const packageRows = await db.select({ id: shipmentPackages.id, code: shipmentPackages.code, description: shipmentPackages.description, l: shipmentPackages.length, w: shipmentPackages.width, h: shipmentPackages.height, warehouse: warehouses.code })
    .from(shipmentPackages)
    .leftJoin(warehouses, eq(warehouses.id, shipmentPackages.warehouseId))
    .where(and(eq(shipmentPackages.isActive, true), scopedWhere(shipmentPackages, scope)))
    .orderBy(asc(shipmentPackages.code), asc(warehouses.code));
  const packages = shipmentPackageOptions(packageRows);
  const channels = forClient
    ? (await db.select({ id: channelConnections.id, store: channelConnections.storeName, provider: channelConnections.provider }).from(channelConnections)
      .where(and(eq(channelConnections.clientId, forClient), eq(channelConnections.isActive, true)))
      .orderBy(asc(channelConnections.storeName))).map((c) => ({ value: c.id, label: c.store, description: c.provider }))
    : [];
  const whs = (await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses)
    .where(inArray(warehouses.id, [...scope.warehouseIds, "__none__"])).orderBy(asc(warehouses.code)))
    .map((w) => ({ value: w.id, label: w.name, description: w.code }));
  return {
    clients: await clientOptions(db, scope),
    productTypes: await lookup("product_type"),
    productGroups: await lookup("product_group"),
    packTypes: (await packTypeNames(db)).map((n) => ({ value: n, label: n })),
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
export async function checkSku(db: AppDb, scope: Scope, input: z.output<typeof skuCheckSchema>): Promise<{ available: boolean; productId: string | null }> {
  if (!hasClient(scope, input.clientId)) return { available: true, productId: null };
  const row = (await db.select({ id: p.id }).from(p)
    .where(and(eq(p.clientId, input.clientId), sql`lower(${p.sku}) = lower(${input.sku})`, input.excludeId ? ne(p.id, input.excludeId) : undefined)).limit(1))[0];
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
export async function checkBarcodes(db: AppDb, scope: Scope, input: z.output<typeof barcodeCheckSchema>): Promise<BarcodeUse[]> {
  const codes = [...new Set(input.barcodes.split(",").map((b) => b.trim()).filter(Boolean))].slice(0, 100);
  if (codes.length === 0) return [];
  const pt = schema.productPackTypes;
  return await db.select({ barcode: productBarcodes.barcode, productId: p.id, sku: p.sku, clientId: p.clientId, clientName: clients.name, packType: pt.packType })
    .from(productBarcodes)
    .innerJoin(p, eq(p.id, productBarcodes.productId))
    .innerJoin(clients, eq(clients.id, p.clientId))
    .innerJoin(pt, eq(pt.id, productBarcodes.packTypeId))
    .where(and(inArray(productBarcodes.barcode, codes), scopedWhere(p, scope), input.excludeProductId ? ne(p.id, input.excludeProductId) : undefined))
    .limit(100);
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
export async function searchComponents(db: AppDb, scope: Scope, input: z.output<typeof componentSearchSchema>): Promise<ComponentOption[]> {
  if (!hasClient(scope, input.clientId)) return [];
  const pattern = `%${escapeLike(input.q)}%`;
  const wh = scope.warehouseIds.length ? sql.join(scope.warehouseIds.map((w) => sql`${w}`), sql`, `) : sql`NULL`;
  return (await dbAll<ComponentOption>(db, sql`
    SELECT p.id, p.sku, p.name, p.image_url AS "imageUrl", p.uom, p.product_category AS category, p.kit_type AS "kitType",
      COALESCE((SELECT SUM(i.on_hand - i.allocated - i.damaged) FROM inventory i WHERE i.product_id = p.id AND i.warehouse_id IN (${wh})), 0) AS available
    FROM products p
    WHERE p.client_id = ${input.clientId} AND p.status = 'Active' AND p.product_category <> 'Packaging Material'
      AND (p.product_category <> 'Kit' OR p.kit_type = 'Kit to Stock')
      ${input.excludeId ? sql`AND p.id <> ${input.excludeId}` : sql``}
      AND (p.sku ILIKE ${pattern} ESCAPE '\\' OR p.name ILIKE ${pattern} ESCAPE '\\' OR p.barcode ILIKE ${pattern} ESCAPE '\\')
    ORDER BY p.sku LIMIT 25`)).map((r) => ({ ...r, available: Number(r.available) }));
}

/** Kits that contain `productId` (for the delete guard and "Used in kits"). */
export async function kitsUsing(db: AppDb, productId: string): Promise<{ id: string; sku: string; name: string; quantity: number }[]> {
  return await db.select({ id: p.id, sku: p.sku, name: p.name, quantity: kitComponents.quantity }).from(kitComponents)
    .innerJoin(p, eq(p.id, kitComponents.kitProductId))
    .where(eq(kitComponents.componentProductId, productId)).orderBy(asc(p.sku));
}

export const linkSearchSchema = z.object({
  /** Optional: omitted → every client the caller can see. */
  clientId: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(100).default(""),
});

export interface LinkSearchOption {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly status: string;
}

/**
 * Listing "Search Product Name & SKU": one client's products whose SKU, name or any barcode
 * contains the text, ranked exact SKU/barcode > SKU prefix > name prefix > contains. Max 50.
 */
export async function searchLinkProducts(db: AppDb, scope: Scope, input: z.output<typeof linkSearchSchema>): Promise<LinkSearchOption[]> {
  if (input.clientId && !hasClient(scope, input.clientId)) return [];
  const clientCond = input.clientId
    ? sql`p.client_id = ${input.clientId}`
    : scope.clientIds === "all"
      ? sql`1 = 1`
      : sql`p.client_id IN (${sql.join([...scope.clientIds, "__none__"].map((id) => sql`${id}`), sql`, `)})`;
  const q = input.q;
  if (!q) {
    return await dbAll<LinkSearchOption>(db, sql`SELECT p.id, p.sku, p.name, p.image_url AS "imageUrl", p.status FROM products p
      WHERE ${clientCond} ORDER BY p.status = 'Active' DESC, lower(p.sku), p.sku LIMIT 50`);
  }
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  return await dbAll<LinkSearchOption>(db, sql`
    SELECT p.id, p.sku, p.name, p.image_url AS "imageUrl", p.status FROM products p
    WHERE ${clientCond} AND (
      p.sku ILIKE ${contains} ESCAPE '\\' OR p.name ILIKE ${contains} ESCAPE '\\' OR p.barcode ILIKE ${contains} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode ILIKE ${contains} ESCAPE '\\'))
    ORDER BY CASE
      WHEN lower(p.sku) = lower(${q}) OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ${q}) THEN 0
      WHEN p.sku ILIKE ${prefix} ESCAPE '\\' THEN 1
      WHEN p.name ILIKE ${prefix} ESCAPE '\\' THEN 2
      ELSE 3 END,
      p.status = 'Active' DESC, lower(p.sku), p.sku
    LIMIT 50`);
}
