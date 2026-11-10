/**
 * Product Listings (M09, spec 05 §2 — rows/actions KitStaks-designed). Reads
 * `product_listings` (no synthesized rows). Commands: link to a product, unlink,
 * Never Sync, and create-product-from-listing. Every write logs to `change_log`.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, conflictError, notFoundError } from "@/server/api/errors";
import { assertInScope, hasClient, scopedWhere, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { recordUpdate } from "@/server/domain/change-log";
import { ensureProductForListing } from "@/server/domain/products";
import type { DomainCtx } from "@/server/domain/types";
import { compileFilters, escapeLike, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery } from "@/server/query/grid-query";
import { compileSort, type SortableMap } from "@/server/query/sort";
import {
  LISTING_EXCEPTION_LABELS, LISTING_EXCEPTIONS, LISTING_GRID_FIELDS, LISTING_SORT_FIELDS, type ListingException, type ListingLinkState,
} from "@/lib/grid-defs/products/listings-grid";

const l = schema.productListings;
const ENTITY = "listing";

export type ScopedCtx = DomainCtx & { readonly scope: Scope };

export interface ListingRow {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly storeName: string;
  readonly provider: string;
  readonly channelConnectionId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly sellerSku: string;
  readonly channelProductId: string;
  readonly description: string | null;
  readonly storePrice: number | null;
  readonly tagNames: string;
  readonly tags: readonly { id: string; name: string; color: string }[];
  readonly productId: string | null;
  readonly productSku: string | null;
  readonly productName: string | null;
  readonly neverSync: boolean;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly linkedAt: string | null;
  readonly exception: ListingException | null;
  readonly exceptionLabel: string | null;
  readonly createdAt: string;
  readonly version: number;
}

/** Derived exception (see `LISTING_EXCEPTIONS`): first match wins. */
export function listingExceptionSql(): SQL {
  return sql`(CASE
    WHEN ${l.productId} IS NULL THEN 'unlinked'
    WHEN lower(${l.sellerSku}) <> lower((SELECT p.sku FROM products p WHERE p.id = ${l.productId})) THEN 'sku_difference'
    WHEN EXISTS (SELECT 1 FROM product_listings o WHERE o.product_id = ${l.productId} AND o.channel_connection_id = ${l.channelConnectionId} AND o.id <> ${l.id}) THEN 'multi_listing'
    ELSE NULL END)`;
}

function asException(value: unknown): ListingException | null {
  return (LISTING_EXCEPTIONS as readonly unknown[]).includes(value) ? (value as ListingException) : null;
}

function expressions(): Readonly<Record<string, SQL>> {
  return {
    name: sql`${l.name}`,
    storeName: sql`(SELECT c.store_name FROM channel_connections c WHERE c.id = ${l.channelConnectionId})`,
    channelConnectionId: sql`${l.channelConnectionId}`,
    clientId: sql`${l.clientId}`,
    clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${l.clientId})`,
    sellerSku: sql`${l.sellerSku}`,
    channelProductId: sql`${l.channelProductId}`,
    description: sql`${l.description}`,
    storePrice: sql`${l.storePrice}`,
    neverSync: sql`${l.neverSync}`,
    productSku: sql`(SELECT p.sku FROM products p WHERE p.id = ${l.productId})`,
    productType: sql`(SELECT lv.name FROM products p JOIN lookup_values lv ON lv.id = p.product_type_id WHERE p.id = ${l.productId})`,
    productGroup: sql`(SELECT lv.name FROM products p JOIN lookup_values lv ON lv.id = p.product_group_id WHERE p.id = ${l.productId})`,
    createdAt: sql`${l.createdAt}`,
    linkedAt: sql`${l.linkedAt}`,
    tagId: sql`(SELECT et.tag_id FROM entity_tags et WHERE et.entity_type = 'listing' AND et.entity_id = ${l.id} LIMIT 1)`,
    exception: listingExceptionSql(),
  };
}

export function listingFilterDefs(): readonly FilterFieldDef[] {
  const e = expressions();
  return LISTING_GRID_FIELDS.map((f) => ({ key: f.field, label: f.label, type: f.type, nullable: true, sql: e[f.field] as SQL }));
}

/** Tag filter must match any tag on the listing, not just the first. */
function tagFilter(query: GridQuery): { filters: GridQuery["filters"]; extra: SQL | undefined } {
  const tagFilters = query.filters.filter((f) => f.field === "tagId");
  const rest = query.filters.filter((f) => f.field !== "tagId");
  const parts = tagFilters.map((f) => {
    if (f.op === "in" || f.op === "nin") {
      const list = sql.join(f.values.map((v) => sql`${v}`), sql`, `);
      const exists = sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'listing' AND et.entity_id = ${l.id} AND et.tag_id IN (${list}))`;
      return f.op === "in" ? exists : sql`NOT ${exists}`;
    }
    const any = sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'listing' AND et.entity_id = ${l.id})`;
    return f.op === "empty" ? sql`NOT ${any}` : any;
  });
  return { filters: rest, extra: parts.length ? and(...parts) : undefined };
}

export function listingWhere(scope: Scope, query: GridQuery, link: ListingLinkState | undefined): SQL | undefined {
  const text = query.q?.trim();
  const match = (expr: SQL): SQL => (query.qm === "eq" ? sql`lower(${expr}) = lower(${text})` : sql`${expr} LIKE ${`${escapeLike(text ?? "")}%`} ESCAPE '\\'`);
  const search = text ? sql`(${match(sql`${l.sellerSku}`)} OR ${match(sql`${l.name}`)} OR ${match(sql`${l.channelProductId}`)})` : undefined;
  const { filters, extra } = tagFilter(query);
  const parts = [
    scopedWhere(l, scope),
    link === "linked" ? sql`${l.productId} IS NOT NULL` : link === "unlinked" ? sql`${l.productId} IS NULL` : undefined,
    search,
    compileFilters(listingFilterDefs(), filters),
    extra,
  ].filter((x): x is SQL => x !== undefined);
  return parts.length ? and(...parts) : undefined;
}

type Raw = Record<string, unknown>;

export function listListings(db: AppDb, scope: Scope, query: GridQuery, link: ListingLinkState | undefined): { rows: ListingRow[]; total: number; counts: { linked: number; unlinked: number } } {
  const e = expressions();
  const where = listingWhere(scope, query, link);
  const whereSql = where ? sql`WHERE ${where}` : sql``;
  const sortable: SortableMap = Object.fromEntries(LISTING_SORT_FIELDS.map((f) => [f, e[f] as SQL]));
  const order = compileSort(sortable, query.sort, { defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: l.id });
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  const raw = db.all<Raw>(sql`
    SELECT ${l.id} AS id, ${l.name} AS name, ${l.imageUrl} AS imageUrl, ${e.storeName} AS storeName,
      (SELECT c.provider FROM channel_connections c WHERE c.id = ${l.channelConnectionId}) AS provider,
      ${l.channelConnectionId} AS channelConnectionId, ${l.clientId} AS clientId, ${e.clientName} AS clientName,
      ${l.sellerSku} AS sellerSku, ${l.channelProductId} AS channelProductId, ${l.description} AS description,
      ${l.storePrice} AS storePrice, ${l.productId} AS productId, ${e.productSku} AS productSku,
      (SELECT p.name FROM products p WHERE p.id = ${l.productId}) AS productName, ${l.neverSync} AS neverSync,
      ${e.productType} AS productType, ${e.productGroup} AS productGroup, ${l.linkedAt} AS linkedAt,
      ${e.exception} AS exception, ${l.createdAt} AS createdAt, ${l.version} AS version
    FROM ${l} ${whereSql} ORDER BY ${sql.join(order, sql`, `)} LIMIT ${query.pageSize} OFFSET ${offset}`);
  const ids = raw.map((r) => String(r.id));
  const tagRows = ids.length
    ? db.select({ entityId: schema.entityTags.entityId, id: schema.tags.id, name: schema.tags.name, color: schema.tags.color }).from(schema.entityTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
      .where(and(eq(schema.entityTags.entityType, ENTITY), inArray(schema.entityTags.entityId, ids))).orderBy(asc(schema.tags.name)).all()
    : [];
  const rows = raw.map((r): ListingRow => {
    const tags = tagRows.filter((t) => t.entityId === r.id).map((t) => ({ id: t.id, name: t.name, color: t.color }));
    return {
      id: String(r.id), name: String(r.name), imageUrl: (r.imageUrl as string | null) ?? null, storeName: String(r.storeName ?? ""),
      provider: String(r.provider ?? ""), channelConnectionId: String(r.channelConnectionId), clientId: String(r.clientId), clientName: String(r.clientName ?? ""),
      sellerSku: String(r.sellerSku), channelProductId: String(r.channelProductId), description: (r.description as string | null) ?? null,
      storePrice: r.storePrice === null || r.storePrice === undefined ? null : Number(r.storePrice), tagNames: tags.map((t) => t.name).join(", "), tags,
      productId: (r.productId as string | null) ?? null, productSku: (r.productSku as string | null) ?? null, productName: (r.productName as string | null) ?? null,
      neverSync: r.neverSync === 1 || r.neverSync === true, productType: (r.productType as string | null) ?? null, productGroup: (r.productGroup as string | null) ?? null,
      linkedAt: (r.linkedAt as string | null) ?? null, createdAt: String(r.createdAt), version: Number(r.version),
      exception: asException(r.exception), exceptionLabel: asException(r.exception) ? LISTING_EXCEPTION_LABELS[asException(r.exception) as ListingException] : null,
    };
  });
  const total = Number(db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${l} ${whereSql}`)?.n ?? 0);
  const scopeWhere = scopedWhere(l, scope);
  const countSql = (linked: boolean) => sql`SELECT COUNT(*) AS n FROM ${l} WHERE ${linked ? sql`${l.productId} IS NOT NULL` : sql`${l.productId} IS NULL`}${scopeWhere ? sql` AND ${scopeWhere}` : sql``}`;
  const counts = { linked: Number(db.get<{ n: number }>(countSql(true))?.n ?? 0), unlinked: Number(db.get<{ n: number }>(countSql(false))?.n ?? 0) };
  return { rows, total, counts };
}

export interface ListingExceptionRow {
  readonly id: string;
  readonly exception: ListingException;
  readonly exceptionLabel: string;
  readonly sellerSku: string;
  readonly name: string;
  readonly storeName: string;
  readonly clientName: string;
  readonly productId: string | null;
  readonly productSku: string | null;
  readonly createdAt: string;
}

/**
 * Open listing exceptions for M12 monitoring ("Product Listing Exceptions"). Derived,
 * so linking a listing (or fixing its SKU) clears it with no extra bookkeeping.
 */
export function listListingExceptions(db: AppDb, scope: Scope, kind?: ListingException): { rows: ListingExceptionRow[]; counts: Record<ListingException, number> } {
  const ex = listingExceptionSql();
  const scopeWhere = scopedWhere(l, scope);
  const raw = db.all<Raw>(sql`
    SELECT * FROM (
      SELECT ${l.id} AS id, ${ex} AS exception, ${l.sellerSku} AS sellerSku, ${l.name} AS name,
        (SELECT c.store_name FROM channel_connections c WHERE c.id = ${l.channelConnectionId}) AS storeName,
        (SELECT c.name FROM clients c WHERE c.id = ${l.clientId}) AS clientName,
        ${l.productId} AS productId, (SELECT p.sku FROM products p WHERE p.id = ${l.productId}) AS productSku, ${l.createdAt} AS createdAt
      FROM ${l} ${scopeWhere ? sql`WHERE ${scopeWhere}` : sql``}
    ) x WHERE x.exception IS NOT NULL ORDER BY x.createdAt DESC, x.id`);
  const all = raw.map((r): ListingExceptionRow => {
    const exception = asException(r.exception) as ListingException;
    return {
      id: String(r.id), exception, exceptionLabel: LISTING_EXCEPTION_LABELS[exception], sellerSku: String(r.sellerSku), name: String(r.name),
      storeName: String(r.storeName ?? ""), clientName: String(r.clientName ?? ""), productId: (r.productId as string | null) ?? null,
      productSku: (r.productSku as string | null) ?? null, createdAt: String(r.createdAt),
    };
  });
  const counts = Object.fromEntries(LISTING_EXCEPTIONS.map((k) => [k, all.filter((r) => r.exception === k).length])) as Record<ListingException, number>;
  return { rows: kind ? all.filter((r) => r.exception === kind) : all, counts };
}

export interface ListingOptions {
  readonly clients: readonly { value: string; label: string }[];
  readonly stores: readonly { value: string; label: string; description: string }[];
  readonly tags: readonly { value: string; label: string }[];
}

export function getListingOptions(db: AppDb, scope: Scope): ListingOptions {
  const cc = schema.channelConnections;
  const stores = db.select({ id: cc.id, store: cc.storeName, provider: cc.provider }).from(cc).where(scopedWhere(cc, scope)).orderBy(asc(cc.storeName)).all()
    .map((s) => ({ value: s.id, label: s.store, description: s.provider }));
  const clients = db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients)
    .where(scope.clientIds === "all" ? undefined : inArray(schema.clients.id, [...scope.clientIds, "__none__"])).orderBy(asc(schema.clients.name)).all()
    .map((c) => ({ value: c.id, label: c.name }));
  const tags = db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags)
    .where(inArray(schema.tags.scope, ["listing", "any"])).orderBy(asc(schema.tags.name)).all().map((t) => ({ value: t.id, label: t.name }));
  return { clients, stores, tags };
}

function loadListing(tx: AppDb, ctx: ScopedCtx, id: string): typeof l.$inferSelect {
  const row = tx.select().from(l).where(eq(l.id, id)).get();
  assertInScope(ctx.scope, row ? { clientId: row.clientId } : null, "Listing");
  return row as typeof l.$inferSelect;
}

function skuOf(tx: AppDb, productId: string | null): string | null {
  return productId ? tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get()?.sku ?? null : null;
}

export function linkListing(tx: AppDb, ctx: ScopedCtx, id: string, productId: string, version?: number): typeof l.$inferSelect {
  const row = loadListing(tx, ctx, id);
  if (version !== undefined && version !== row.version) throw conflictError();
  const product = tx.select({ id: schema.products.id, clientId: schema.products.clientId, sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get();
  if (!product || !hasClient(ctx.scope, product.clientId)) throw notFoundError("Product");
  if (product.clientId !== row.clientId) {
    throw new AppError("VALIDATION", "The product belongs to a different client than the listing", { fieldErrors: { productId: ["Pick a product of the listing's client"] } });
  }
  if (row.productId === productId) return row;
  const linkedAt = new Date().toISOString();
  tx.update(l).set({ productId, linkedAt, updatedBy: ctx.userId, version: row.version + 1 }).where(eq(l.id, id)).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: row.sellerSku, before: { linkedProduct: skuOf(tx, row.productId) }, after: { linkedProduct: product.sku } });
  return { ...row, productId, linkedAt, version: row.version + 1 };
}

export function unlinkListing(tx: AppDb, ctx: ScopedCtx, id: string): typeof l.$inferSelect {
  const row = loadListing(tx, ctx, id);
  if (!row.productId) throw new AppError("INVALID_STATE", "This listing is not linked to a product");
  tx.update(l).set({ productId: null, linkedAt: null, updatedBy: ctx.userId, version: row.version + 1 }).where(eq(l.id, id)).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: row.sellerSku, before: { linkedProduct: skuOf(tx, row.productId) }, after: { linkedProduct: null } });
  return { ...row, productId: null, linkedAt: null, version: row.version + 1 };
}

export function setNeverSync(tx: AppDb, ctx: ScopedCtx, id: string, neverSync: boolean): typeof l.$inferSelect {
  const row = loadListing(tx, ctx, id);
  if (row.neverSync === neverSync) return row;
  tx.update(l).set({ neverSync, updatedBy: ctx.userId, version: row.version + 1 }).where(eq(l.id, id)).run();
  recordUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: row.sellerSku, before: { neverSync: row.neverSync }, after: { neverSync } });
  return { ...row, neverSync, version: row.version + 1 };
}

/** Creates (or finds) the client's product with the seller SKU and links it. Beyond Logiwa. */
export function createProductFromListing(tx: AppDb, ctx: ScopedCtx, id: string): { listing: typeof l.$inferSelect; productId: string; created: boolean } {
  const row = loadListing(tx, ctx, id);
  if (row.productId) throw new AppError("INVALID_STATE", "This listing is already linked to a product");
  const { product, created } = ensureProductForListing(tx, ctx, { clientId: row.clientId, sellerSku: row.sellerSku, name: row.name, price: row.storePrice ?? 0 });
  if (row.imageUrl && created) tx.update(schema.products).set({ imageUrl: row.imageUrl, description: row.description }).where(eq(schema.products.id, product.id)).run();
  const listing = linkListing(tx, ctx, id, product.id);
  return { listing, productId: product.id, created };
}
