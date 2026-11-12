/**
 * Kit reports and kit lookups (M08): `kit_inventory_stats` recalculation, Kit Inventory,
 * Kit Component Inventory Availability, kit detail (BOM + live free stock), component
 * source buckets and kit stock buckets. Every read is filtered to the caller's scope.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import { hasClient, hasWarehouse, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { countLockFor } from "@/server/domain/ledger/count-locks";
import type { GridQuery } from "@/server/query/grid-query";
import { applyLocalGridQuery } from "@/lib/local-grid-query";
import { netKittingCapacity, reorderQty, requiredKittingQty } from "@/lib/grid-defs/work-orders/work-order-model";
import {
  KIT_COMPONENT_FIELDS, KIT_COMPONENT_SORT_FIELDS, KIT_INVENTORY_FIELDS, KIT_INVENTORY_SORT_FIELDS, KIT_SEARCH_FIELDS,
  type KitComponentRow, type KitInventoryRow,
} from "@/lib/grid-defs/work-orders/kits";
import { assertGridFields } from "./work-orders-grid";
import { availabilityByKey, availabilityKey, componentAvailability, type ComponentAvailability } from "./work-orders-availability";
import type { Tx } from "@/server/domain/types";
import { withWriteTx } from "@/server/db/sql";

const CLOSED_SO_STATUSES = ["Shipped", "Delivered", "Cancelled"] as const;

type Key3 = string;
const key3 = availabilityKey;

interface StockAgg { readonly free: number; readonly onHand: number; readonly usable: number }

/**
 * Free (Stock, undamaged, unallocated) and undamaged on-hand per warehouse/client/product, plus
 * `usable`: free stock that allocation can take. `usable` comes from `availabilityByKey`, the same
 * function the wizard kit card, the WO detail and the Create Kit guard use, so Kit Inventory's
 * Net Kitting Capacity always equals the kit card's "can build N".
 */
async function stockByKey(db: AppDb): Promise<Map<Key3, StockAgg>> {
  const i = schema.inventory;
  const ok = sql`${i.status} = 'Stock' AND ${i.damageReason} IS NULL`;
  const rows = await db.select({
    warehouseId: i.warehouseId, clientId: i.clientId, productId: i.productId,
    free: sql<number>`COALESCE(SUM(CASE WHEN ${ok} THEN ${i.onHand} - ${i.allocated} ELSE 0 END), 0)`,
    onHand: sql<number>`COALESCE(SUM(CASE WHEN ${ok} THEN ${i.onHand} ELSE 0 END), 0)`,
  }).from(i).groupBy(i.warehouseId, i.clientId, i.productId);
  const usable = await availabilityByKey(db as unknown as Tx);
  return new Map(rows.map((r) => {
    const k = key3(r.warehouseId, r.clientId, r.productId);
    return [k, { free: Number(r.free), onHand: Number(r.onHand), usable: usable.get(k)?.usableQty ?? 0 }];
  }));
}

/** Open shipment order demand per warehouse/client/product. */
async function pendingByKey(db: AppDb): Promise<Map<Key3, number>> {
  const so = schema.shipmentOrders;
  const ol = schema.orderLines;
  const rows = await db.select({
    warehouseId: so.warehouseId, clientId: so.clientId, productId: ol.productId,
    qty: sql<number>`COALESCE(SUM(GREATEST(${ol.quantity} - ${ol.cancelledQuantity} - ${ol.shippedQuantity}, 0)), 0)`,
  }).from(ol).innerJoin(so, eq(so.id, ol.orderId))
    .where(and(sql`${so.status} NOT IN ('Shipped','Delivered','Cancelled')`, sql`${so.deletedAt} IS NULL`))
    .groupBy(so.warehouseId, so.clientId, ol.productId);
  return new Map(rows.map((r) => [key3(r.warehouseId, r.clientId, r.productId), Number(r.qty)]));
}

/** Remaining component demand of open work orders (not yet allocated or consumed). */
async function workOrderDemandByKey(db: AppDb): Promise<Map<Key3, number>> {
  const wo = schema.workOrders;
  const c = schema.workOrderComponents;
  const rows = await db.select({
    warehouseId: wo.warehouseId, clientId: wo.clientId, productId: c.componentProductId,
    qty: sql<number>`COALESCE(SUM(GREATEST(${c.totalQty} - ${c.consumedQty} - ${c.allocatedQty}, 0)), 0)`,
  }).from(c).innerJoin(wo, eq(wo.id, c.workOrderId))
    .where(inArray(wo.status, ["Open", "Shortage", "In Process"]))
    .groupBy(wo.warehouseId, wo.clientId, c.componentProductId);
  return new Map(rows.map((r) => [key3(r.warehouseId, r.clientId, r.productId), Number(r.qty)]));
}

interface KitDef {
  readonly id: string;
  readonly clientId: string;
  readonly components: readonly { readonly productId: string; readonly qty: number }[];
}

async function kitDefs(db: AppDb): Promise<KitDef[]> {
  const kits = await db.select({ id: schema.products.id, clientId: schema.products.clientId }).from(schema.products).where(eq(schema.products.isKit, true));
  const bom = await db.select().from(schema.kitComponents);
  return kits.map((k) => ({ ...k, components: bom.filter((b) => b.kitProductId === k.id).map((b) => ({ productId: b.componentProductId, qty: b.quantity })) }));
}

export interface KitStatsRow {
  readonly kitProductId: string;
  readonly warehouseId: string;
  readonly pendingOrderQty: number;
  readonly netKittingCapacity: number;
  readonly totalInventoryCapacity: number;
  readonly currentInventoryQty: number;
  readonly requiredKittingQty: number;
}

/** Pure-ish computation over the live tables (no writes). */
export async function computeKitStats(db: AppDb): Promise<KitStatsRow[]> {
  const stock = await stockByKey(db);
  const pending = await pendingByKey(db);
  const warehouses = await db.select({ id: schema.warehouses.id }).from(schema.warehouses);
  const out: KitStatsRow[] = [];
  for (const kit of await kitDefs(db)) {
    for (const wh of warehouses) {
      const kitStock = stock.get(key3(wh.id, kit.clientId, kit.id));
      const pend = pending.get(key3(wh.id, kit.clientId, kit.id)) ?? 0;
      const lines = kit.components.map((c) => ({ bomQty: c.qty, freeQty: stock.get(key3(wh.id, kit.clientId, c.productId))?.usable ?? 0 }));
      const present = Boolean(kitStock) || pend > 0 || kit.components.some((c) => stock.has(key3(wh.id, kit.clientId, c.productId)));
      if (!present) continue;
      const current = kitStock?.onHand ?? 0;
      const net = netKittingCapacity(lines);
      out.push({
        kitProductId: kit.id, warehouseId: wh.id, pendingOrderQty: pend, netKittingCapacity: net,
        totalInventoryCapacity: net + current, currentInventoryQty: current, requiredKittingQty: requiredKittingQty(pend, current),
      });
    }
  }
  return out;
}

/** Rewrites `kit_inventory_stats` (M08 owns the table). Returns the row count and stamp. */
export async function recalcKitInventory(db: AppDb, now: Date = new Date()): Promise<{ readonly rows: number; readonly updatedAt: string }> {
  const updatedAt = now.toISOString();
  const rows = await computeKitStats(db);
  await withWriteTx(db, async (tx) => {
    await tx.delete(schema.kitInventoryStats);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, updatedAt }));
      if (chunk.length > 0) await tx.insert(schema.kitInventoryStats).values(chunk);
    }
  });
  return { rows: rows.length, updatedAt };
}

export async function lastKitRecalcAt(db: AppDb): Promise<string | null> {
  return (await db.select({ at: sql<string | null>`MAX(${schema.kitInventoryStats.updatedAt})` }).from(schema.kitInventoryStats).limit(1))[0]?.at ?? null;
}

async function lookupNames(db: AppDb): Promise<Map<string, string>> {
  return new Map((await db.select({ id: schema.lookupValues.id, name: schema.lookupValues.name }).from(schema.lookupValues)).map((l) => [l.id, l.name]));
}

const inScope = (scope: Scope, warehouseId: string, clientId: string | null): boolean => hasWarehouse(scope, warehouseId) && (!clientId || hasClient(scope, clientId));

const getField = <T extends object>(row: T, field: string) => (row as Record<string, string | number | boolean | null | undefined>)[field];

export interface KitListResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly updatedAt: string | null;
}

/**
 * A snapshot older than this is refreshed when the report is read, so Net Kitting Capacity never
 * contradicts the live kit card for long (e.g. a count plan locked component bins after the last
 * scheduled run). The scheduler and Recalculate Now still refresh it on their own.
 */
export const KIT_STATS_MAX_AGE_MS = 2 * 60_000;

export function kitStatsStale(updatedAt: string | null, now: number = Date.now()): boolean {
  if (!updatedAt) return true;
  const at = Date.parse(updatedAt);
  return !Number.isFinite(at) || now - at > KIT_STATS_MAX_AGE_MS;
}

/** Kit Inventory report rows (recalculates when the stats table is empty or stale). */
export async function listKitInventory(db: AppDb, scope: Scope, query: GridQuery): Promise<KitListResult<KitInventoryRow>> {
  assertGridFields(query, KIT_INVENTORY_FIELDS.map((f) => f.field), KIT_INVENTORY_SORT_FIELDS);
  if (kitStatsStale(await lastKitRecalcAt(db))) await recalcKitInventory(db);
  const s = schema.kitInventoryStats;
  const p = schema.products;
  const names = await lookupNames(db);
  const raw = await db.select({ s, p, warehouseCode: schema.warehouses.code, warehouseTimeZone: schema.warehouses.timezone, clientName: schema.clients.name })
    .from(s).innerJoin(p, eq(p.id, s.kitProductId))
    .innerJoin(schema.warehouses, eq(schema.warehouses.id, s.warehouseId))
    .innerJoin(schema.clients, eq(schema.clients.id, p.clientId));
  const bomCount = new Map((await db.select({ id: schema.kitComponents.kitProductId, n: sql<number>`COUNT(*)` }).from(schema.kitComponents).groupBy(schema.kitComponents.kitProductId)).map((r) => [r.id, Number(r.n)]));
  const rows: KitInventoryRow[] = raw.filter((r) => inScope(scope, r.s.warehouseId, r.p.clientId)).map((r) => ({
    id: `${r.s.kitProductId}:${r.s.warehouseId}`, kitProductId: r.s.kitProductId, warehouseId: r.s.warehouseId, warehouseCode: r.warehouseCode, warehouseTimeZone: r.warehouseTimeZone ?? null,
    clientId: r.p.clientId, clientName: r.clientName, sku: r.p.sku, kitType: r.p.kitType, barcode: r.p.barcode, name: r.p.name, packType: r.p.uom,
    productType: r.p.productTypeId ? names.get(r.p.productTypeId) ?? null : null, productGroup: r.p.productGroupId ? names.get(r.p.productGroupId) ?? null : null,
    pendingOrderQty: r.s.pendingOrderQty, netKittingCapacity: r.s.netKittingCapacity, totalInventoryCapacity: r.s.totalInventoryCapacity,
    currentInventoryQty: r.s.currentInventoryQty, requiredKittingQty: r.s.requiredKittingQty, componentCount: bomCount.get(r.s.kitProductId) ?? 0, updatedAt: r.s.updatedAt,
  }));
  const sorted = query.sort.length ? query : { ...query, sort: [{ field: "warehouseCode", dir: "asc" as const }, { field: "sku", dir: "asc" as const }] };
  const result = applyLocalGridQuery(rows, sorted, { get: getField, searchFields: KIT_SEARCH_FIELDS });
  return { ...result, updatedAt: await lastKitRecalcAt(db) };
}

/** Kit Component Inventory Availability rows (live). */
export async function listKitComponents(db: AppDb, scope: Scope, query: GridQuery): Promise<KitListResult<KitComponentRow>> {
  assertGridFields(query, KIT_COMPONENT_FIELDS.map((f) => f.field), KIT_COMPONENT_SORT_FIELDS);
  const stock = await stockByKey(db);
  const pending = await pendingByKey(db);
  const woDemand = await workOrderDemandByKey(db);
  const kits = await kitDefs(db);
  const products = new Map((await db.select().from(schema.products)).map((p) => [p.id, p]));
  const warehouses = await db.select({ id: schema.warehouses.id, code: schema.warehouses.code }).from(schema.warehouses);
  const clients = new Map((await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients)).map((c) => [c.id, c.name]));
  const names = await lookupNames(db);
  const usage = new Map<string, { kitId: string; qty: number }[]>();
  for (const kit of kits) for (const c of kit.components) usage.set(c.productId, [...(usage.get(c.productId) ?? []), { kitId: kit.id, qty: c.qty }]);
  const rows: KitComponentRow[] = [];
  for (const [componentId, uses] of usage) {
    const product = products.get(componentId);
    if (!product) continue;
    for (const wh of warehouses) {
      if (!inScope(scope, wh.id, product.clientId)) continue;
      const k = key3(wh.id, product.clientId, componentId);
      const own = stock.get(k);
      const kitDemand = uses.reduce((s, u) => s + (pending.get(key3(wh.id, product.clientId, u.kitId)) ?? 0) * u.qty, 0);
      const totalOrderQty = (pending.get(k) ?? 0) + kitDemand + (woDemand.get(k) ?? 0);
      if (!own && totalOrderQty === 0) continue;
      const kitSkus = uses.map((u) => products.get(u.kitId)?.sku).filter((s): s is string => Boolean(s)).sort();
      const available = own?.free ?? 0;
      rows.push({
        id: `${componentId}:${wh.id}`, componentProductId: componentId, warehouseId: wh.id, warehouseCode: wh.code,
        clientName: clients.get(product.clientId) ?? "", sku: product.sku, name: product.name,
        productType: product.productTypeId ? names.get(product.productTypeId) ?? null : null,
        productGroup: product.productGroupId ? names.get(product.productGroupId) ?? null : null,
        includedKits: kitSkus, includedKitsText: kitSkus.join(","), totalOrderQty, totalInventoryQty: own?.onHand ?? 0,
        totalAvailableQty: available, reorderQty: reorderQty(totalOrderQty, available),
      });
    }
  }
  const sorted = query.sort.length ? query : { ...query, sort: [{ field: "reorderQty", dir: "desc" as const }, { field: "sku", dir: "asc" as const }] };
  const result = applyLocalGridQuery(rows, sorted, { get: getField, searchFields: KIT_SEARCH_FIELDS });
  return { ...result, updatedAt: null };
}

/* ------------------------------------------------------------- lookups */

export interface KitComponentDetail {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly packType: string;
  readonly bomQty: number;
  /** Product barcode/UPC (labels print it; SKU only when none). */
  readonly barcode: string | null;
  /** Usable free stock (lock-aware, same rule as FEFO allocation). */
  readonly freeQty: number;
  /** Free stock in count-locked locations, and the plans locking it. */
  readonly lockedQty: number;
  readonly lockedBy: readonly string[];
  readonly onHandQty: number;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

export interface KitDetail {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly clientId: string;
  readonly kitType: string | null;
  readonly packType: string;
  readonly imageUrl: string | null;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
  readonly onHandQty: number;
  readonly netKittingCapacity: number;
  readonly components: readonly KitComponentDetail[];
}

/** Kit card + BOM with live free stock in `warehouseId`. Cross-scope → 404. */
export async function getKitDetail(db: AppDb, scope: Scope, kitProductId: string, warehouseId: string | null): Promise<KitDetail> {
  const kit = (await db.select().from(schema.products).where(eq(schema.products.id, kitProductId)).limit(1))[0];
  if (!kit || !kit.isKit || !hasClient(scope, kit.clientId)) throw notFoundError("Kit");
  if (warehouseId && !hasWarehouse(scope, warehouseId)) throw notFoundError("Warehouse");
  const stock = await stockByKey(db);
  const bom = await db.select({ c: schema.kitComponents, p: schema.products }).from(schema.kitComponents)
    .innerJoin(schema.products, eq(schema.products.id, schema.kitComponents.componentProductId))
    .where(eq(schema.kitComponents.kitProductId, kit.id)).orderBy(asc(schema.products.sku));
  const at = (productId: string) => (warehouseId ? stock.get(key3(warehouseId, kit.clientId, productId)) : undefined);
  const avail = warehouseId ? await componentAvailability(db as unknown as Tx, { warehouseId, clientId: kit.clientId, productIds: bom.map((b) => b.p.id) }) : new Map<string, ComponentAvailability>();
  const components = bom.map(({ c, p }) => ({
    productId: p.id, sku: p.sku, barcode: p.barcode ?? null, name: p.name, packType: c.packType || p.uom, bomQty: c.quantity, freeQty: avail.get(p.id)?.usableQty ?? 0,
    lockedQty: avail.get(p.id)?.lockedQty ?? 0, lockedBy: avail.get(p.id)?.lockedBy ?? [],
    onHandQty: at(p.id)?.onHand ?? 0, trackLot: p.trackLot, trackExpiry: p.trackExpiry, trackProductionDate: p.trackProductionDate,
  }));
  return {
    id: kit.id, sku: kit.sku, name: kit.name, clientId: kit.clientId, kitType: kit.kitType, packType: kit.uom, imageUrl: kit.imageUrl,
    trackLot: kit.trackLot, trackExpiry: kit.trackExpiry, trackProductionDate: kit.trackProductionDate, onHandQty: at(kit.id)?.onHand ?? 0,
    netKittingCapacity: netKittingCapacity(components.map((c) => ({ bomQty: c.bomQty, freeQty: c.freeQty }))), components,
  };
}

export interface KitPickerItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly sku: string;
  readonly kitType: string | null;
}

/** Kit-to-stock kits of a client (wizard picker). */
export async function searchKits(db: AppDb, scope: Scope, input: { clientId: string; q?: string; limit?: number; includeKitToOrder?: boolean }): Promise<KitPickerItem[]> {
  if (!hasClient(scope, input.clientId)) return [];
  const p = schema.products;
  const q = input.q?.trim();
  const rows = await db.select().from(p).where(and(
    eq(p.isKit, true), eq(p.clientId, input.clientId),
    input.includeKitToOrder ? undefined : eq(p.kitType, "Kit to Stock"),
    q ? sql`(lower(${p.sku}) ILIKE ${`%${q.toLowerCase()}%`} ESCAPE '' OR lower(${p.name}) ILIKE ${`%${q.toLowerCase()}%`} ESCAPE '')` : undefined,
  )).orderBy(asc(p.sku)).limit(Math.min(input.limit ?? 50, 200));
  return rows.map((r) => ({ id: r.id, label: r.sku, description: r.name, sku: r.sku, kitType: r.kitType }));
}

export interface StockBucket {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly onHand: number;
  readonly freeQty: number;
  readonly status: string;
  /** Code of the open count plan that locks the bucket's location (stock can't move out), or null. */
  readonly lockedBy: string | null;
}

export const MAX_SOURCE_PRODUCTS = 50;

/** Free Stock buckets of several products in a warehouse, keyed by product id (one query). */
export async function listStockBucketsFor(db: AppDb, scope: Scope, input: { productIds: readonly string[]; warehouseId: string; clientId?: string | null }): Promise<Record<string, StockBucket[]>> {
  if (!hasWarehouse(scope, input.warehouseId)) throw notFoundError("Warehouse");
  if (input.clientId && !hasClient(scope, input.clientId)) throw notFoundError("Client");
  const ids = [...new Set(input.productIds)].slice(0, MAX_SOURCE_PRODUCTS);
  const out: Record<string, StockBucket[]> = Object.fromEntries(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const i = schema.inventory;
  const rows = await db.select({ i, code: schema.locations.code, lp: schema.licensePlates.number })
    .from(i).innerJoin(schema.locations, eq(schema.locations.id, i.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, i.lpId))
    .where(and(inArray(i.productId, ids), eq(i.warehouseId, input.warehouseId), eq(i.status, "Stock"), sql`${i.damageReason} IS NULL`,
      gt(i.onHand, 0), input.clientId ? eq(i.clientId, input.clientId) : undefined))
    .orderBy(asc(i.expiryDate), asc(i.receivedAt));
  // One lock lookup per distinct location (count plans lock whole locations).
  const locks = new Map<string, string | null>();
  for (const r of rows) if (!locks.has(r.i.locationId)) locks.set(r.i.locationId, await countLockFor(db, r.i.locationId));
  for (const r of rows) {
    (out[r.i.productId] ??= []).push({
      id: r.i.id, locationId: r.i.locationId, locationCode: r.code, lpId: r.i.lpId, lpNumber: r.lp ?? null, lotNumber: r.i.lotNumber,
      expiryDate: r.i.expiryDate, productionDate: r.i.productionDate, onHand: r.i.onHand, freeQty: r.i.onHand - r.i.allocated, status: r.i.status,
      lockedBy: locks.get(r.i.locationId) ?? null,
    });
  }
  return out;
}

/** Free Stock buckets of a product in a warehouse (component sources, kit stock). */
export async function listStockBuckets(db: AppDb, scope: Scope, input: { productId: string; warehouseId: string; clientId?: string | null }): Promise<StockBucket[]> {
  return (await listStockBucketsFor(db, scope, { productIds: [input.productId], warehouseId: input.warehouseId, clientId: input.clientId }))[input.productId] ?? [];
}

export { CLOSED_SO_STATUSES };
