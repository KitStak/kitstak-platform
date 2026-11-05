import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { products, clients, inventory, locations } = schema;

export type ProductStatus = (typeof products.$inferSelect)["status"];

export const PRODUCT_CATEGORIES = ["Apparel", "Electronics", "Coffee"] as const;

export interface ProductListParams {
  page: number;
  pageSize: number;
  search?: string;
  clientId?: string;
  category?: string;
  status?: ProductStatus;
}

export interface ProductListRow {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  clientId: string;
  clientName: string;
  price: number;
  weightOz: number;
  isKit: boolean;
  status: ProductStatus;
  reorderPoint: number;
  onHand: number;
  allocated: number;
  available: number;
}

function invAggregate() {
  return db
    .select({
      productId: inventory.productId,
      onHand: sql<number>`coalesce(sum(${inventory.onHand}), 0)`.as("inv_on_hand"),
      allocated: sql<number>`coalesce(sum(${inventory.allocated}), 0)`.as("inv_allocated"),
      damaged: sql<number>`coalesce(sum(${inventory.damaged}), 0)`.as("inv_damaged"),
    })
    .from(inventory)
    .groupBy(inventory.productId)
    .as("inv_agg");
}

export function listProducts(params: ProductListParams): ListResult<ProductListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.clientId) conds.push(eq(products.clientId, params.clientId));
  if (params.category) conds.push(eq(products.category, params.category));
  if (params.status) conds.push(eq(products.status, params.status));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(products.sku, p), like(products.name, p), like(products.barcode, p)));
  }
  const where = and(...conds);
  const inv = invAggregate();
  const rows = db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      category: products.category,
      clientId: products.clientId,
      clientName: clients.name,
      price: products.price,
      weightOz: products.weightOz,
      isKit: products.isKit,
      status: products.status,
      reorderPoint: products.reorderPoint,
      onHand: sql<number>`coalesce(${inv.onHand}, 0)`,
      allocated: sql<number>`coalesce(${inv.allocated}, 0)`,
      available: sql<number>`coalesce(${inv.onHand}, 0) - coalesce(${inv.allocated}, 0)`,
    })
    .from(products)
    .innerJoin(clients, eq(products.clientId, clients.id))
    .leftJoin(inv, eq(inv.productId, products.id))
    .where(where)
    .orderBy(asc(products.sku))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(products).where(where).get()?.n ?? 0;
  return { rows, total };
}

/* ============ detail ============ */

export interface ProductInventoryRow {
  locationId: string;
  locationCode: string;
  zone: string;
  locationType: string;
  lotNumber: string | null;
  onHand: number;
  allocated: number;
  damaged: number;
  receivedAt: string;
}

export interface ProductDetail {
  product: typeof products.$inferSelect & { clientName: string; clientCode: string };
  totals: { onHand: number; allocated: number; available: number; damaged: number };
  inventory: ProductInventoryRow[];
}

export function getProductDetail(id: string): ProductDetail | null {
  const row = db
    .select()
    .from(products)
    .innerJoin(clients, eq(products.clientId, clients.id))
    .where(eq(products.id, id))
    .get();
  if (!row) return null;
  const invRows = db
    .select({
      locationId: inventory.locationId,
      locationCode: locations.code,
      zone: locations.zone,
      locationType: locations.type,
      lotNumber: inventory.lotNumber,
      onHand: inventory.onHand,
      allocated: inventory.allocated,
      damaged: inventory.damaged,
      receivedAt: inventory.receivedAt,
    })
    .from(inventory)
    .innerJoin(locations, eq(inventory.locationId, locations.id))
    .where(eq(inventory.productId, id))
    .orderBy(asc(locations.code))
    .all();
  const totals = invRows.reduce(
    (acc, r) => ({
      onHand: acc.onHand + r.onHand,
      allocated: acc.allocated + r.allocated,
      available: acc.available + (r.onHand - r.allocated),
      damaged: acc.damaged + r.damaged,
    }),
    { onHand: 0, allocated: 0, available: 0, damaged: 0 }
  );
  return {
    product: { ...row.products, clientName: row.clients.name, clientCode: row.clients.code },
    totals,
    inventory: invRows,
  };
}
