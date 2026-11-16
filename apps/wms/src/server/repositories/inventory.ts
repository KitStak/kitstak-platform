/**
 * LEGACY read models kept for the pre-foundation inventory-snapshot / verify-data callers
 * (`reports.ts`, `scripts/verify-data.ts`). The inventory pages use the scoped grid
 * repositories (`inventory-total.ts`, `inventory-by-location.ts`, `inventory-atp.ts`).
 */
import { and, count, countDistinct, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { asc, desc } from '@/server/db/order';
import { schema } from '@/server/db';
import { getAppDb, type AppDb } from '@/server/api/db';
import { likePattern, offsetOf, type ListResult } from './shared';

const { inventory, products, clients, locations, purchaseOrders, purchaseOrderLines } = schema;

export type InventoryView = 'total' | 'by-location' | 'atp';

export interface InventoryListParams {
  page: number;
  pageSize: number;
  search?: string;
  clientId?: string;
  zone?: string;
}

/* ============ total inventory (per product) ============ */

export interface TotalInventoryRow {
  productId: string;
  sku: string;
  productName: string;
  clientName: string;
  category: string;
  isKit: boolean;
  onHand: number;
  allocated: number;
  available: number;
  damaged: number;
  locationCount: number;
}

function productConditions(params: InventoryListParams): SQL | undefined {
  const conds: Array<SQL | undefined> = [];
  if (params.clientId) conds.push(eq(products.clientId, params.clientId));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(ilike(products.sku, p), ilike(products.name, p)));
  }
  return and(...conds);
}

function invAggregate(db: AppDb) {
  return db
    .select({
      productId: inventory.productId,
      onHand: sql<number>`coalesce(sum(${inventory.onHand}), 0)`.as('agg_on_hand'),
      allocated: sql<number>`coalesce(sum(${inventory.allocated}), 0)`.as('agg_allocated'),
      damaged: sql<number>`coalesce(sum(${inventory.damaged}), 0)`.as('agg_damaged'),
      locationCount: countDistinct(inventory.locationId).as('agg_locations'),
    })
    .from(inventory)
    .groupBy(inventory.productId)
    .as('inv_agg');
}

export async function listTotalInventory(
  params: InventoryListParams,
): Promise<ListResult<TotalInventoryRow>> {
  const db = await getAppDb();
  const where = productConditions(params);
  const inv = await invAggregate(db);
  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      productName: products.name,
      clientName: clients.name,
      category: products.category,
      isKit: products.isKit,
      onHand: sql<number>`coalesce(${inv.onHand}, 0)`,
      allocated: sql<number>`coalesce(${inv.allocated}, 0)`,
      available: sql<number>`coalesce(${inv.onHand}, 0) - coalesce(${inv.allocated}, 0)`,
      damaged: sql<number>`coalesce(${inv.damaged}, 0)`,
      locationCount: sql<number>`coalesce(${inv.locationCount}, 0)`,
    })
    .from(products)
    .innerJoin(clients, eq(products.clientId, clients.id))
    .leftJoin(inv, eq(inv.productId, products.id))
    .where(where)
    .orderBy(asc(products.sku))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize));
  const total =
    (
      await db
        .select({ n: count() })
        .from(products)
        .innerJoin(clients, eq(products.clientId, clients.id))
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  return { rows, total };
}

/* ============ by location ============ */

export interface LocationInventoryRow {
  id: string;
  sku: string;
  productName: string;
  clientName: string;
  locationCode: string;
  zone: string;
  locationType: string;
  lotNumber: string | null;
  onHand: number;
  allocated: number;
  available: number;
  damaged: number;
  receivedAt: string;
}

export async function listInventoryByLocation(
  params: InventoryListParams,
): Promise<ListResult<LocationInventoryRow>> {
  const db = await getAppDb();
  const conds: Array<SQL | undefined> = [];
  if (params.clientId) conds.push(eq(products.clientId, params.clientId));
  if (params.zone) conds.push(eq(locations.zone, params.zone));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(ilike(products.sku, p), ilike(products.name, p), ilike(locations.code, p)));
  }
  const where = and(...conds);
  const base = db
    .select({
      id: inventory.id,
      sku: products.sku,
      productName: products.name,
      clientName: clients.name,
      locationCode: locations.code,
      zone: locations.zone,
      locationType: locations.type,
      lotNumber: inventory.lotNumber,
      onHand: inventory.onHand,
      allocated: inventory.allocated,
      available: sql<number>`${inventory.onHand} - ${inventory.allocated}`,
      damaged: inventory.damaged,
      receivedAt: inventory.receivedAt,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .innerJoin(clients, eq(products.clientId, clients.id))
    .innerJoin(locations, eq(inventory.locationId, locations.id));
  const rows = await base
    .where(where)
    .orderBy(asc(locations.code), asc(products.sku))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize));
  const total =
    (
      await db
        .select({ n: count() })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .innerJoin(clients, eq(products.clientId, clients.id))
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  return { rows, total };
}

/* ============ available-to-promise ============ */

export interface AtpRow {
  productId: string;
  sku: string;
  productName: string;
  clientName: string;
  onHand: number;
  allocated: number;
  available: number;
  incoming: number;
  atp: number;
}

export async function listAtp(params: InventoryListParams): Promise<ListResult<AtpRow>> {
  const db = await getAppDb();
  const where = productConditions(params);
  const inv = await invAggregate(db);
  const incoming = db
    .select({
      productId: purchaseOrderLines.productId,
      incoming:
        sql<number>`coalesce(sum(${purchaseOrderLines.orderedQuantity} - ${purchaseOrderLines.receivedQuantity}), 0)`.as(
          'agg_incoming',
        ),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(inArray(purchaseOrders.status, ['Pending', 'Started', 'Receiving']))
    .groupBy(purchaseOrderLines.productId)
    .as('po_agg');
  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      productName: products.name,
      clientName: clients.name,
      onHand: sql<number>`coalesce(${inv.onHand}, 0)`,
      allocated: sql<number>`coalesce(${inv.allocated}, 0)`,
      available: sql<number>`coalesce(${inv.onHand}, 0) - coalesce(${inv.allocated}, 0)`,
      incoming: sql<number>`coalesce(${incoming.incoming}, 0)`,
      atp: sql<number>`coalesce(${inv.onHand}, 0) - coalesce(${inv.allocated}, 0) + coalesce(${incoming.incoming}, 0)`,
    })
    .from(products)
    .innerJoin(clients, eq(products.clientId, clients.id))
    .leftJoin(inv, eq(inv.productId, products.id))
    .leftJoin(incoming, eq(incoming.productId, products.id))
    .where(where)
    .orderBy(desc(sql`coalesce(${incoming.incoming}, 0)`), asc(products.sku))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize));
  const total =
    (
      await db
        .select({ n: count() })
        .from(products)
        .innerJoin(clients, eq(products.clientId, clients.id))
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  return { rows, total };
}
