/**
 * Product Listings (M09, spec 05 §2 — rows/actions KitStaks-designed). Reads
 * `product_listings` (no synthesized rows). Commands: link to a product, unlink,
 * Never Sync, and create-product-from-listing. Every write logs to `change_log`.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError, conflictError, notFoundError } from '@/server/api/errors';
import { assertInScope, hasClient, scopedWhere, type Scope } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { recordUpdate } from '@/server/domain/change-log';
import { ensureProductForListing } from '@/server/domain/products';
import { createProductFromWizard } from '@/server/repositories/products-commands';
import {
  listingQuickProductSchema,
  quickProductToInput,
  type ListingQuickProductInput,
} from '@/lib/grid-defs/products/listing-quick-product';
import type { DomainCtx } from '@/server/domain/types';
import { compileFilters, escapeLike, type FilterFieldDef } from '@/server/query/filters';
import type { GridQuery } from '@/server/query/grid-query';
import { compileSort, type SortableMap } from '@/server/query/sort';
import {
  LISTING_EXCEPTION_LABELS,
  LISTING_EXCEPTIONS,
  LISTING_GRID_FIELDS,
  LISTING_SORT_FIELDS,
  type ListingException,
  type ListingLinkState,
} from '@/lib/grid-defs/products/listings-grid';
import { dbAll, dbGet } from '@/server/db/sql';

const l = schema.productListings;
const ENTITY = 'listing';

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
  /** Logiwa "Suggested" state: unlinked listing whose seller SKU equals a product SKU of the same client. */
  readonly suggestedProductId: string | null;
  readonly suggestedProductSku: string | null;
  readonly suggestedProductName: string | null;
  readonly suggestedProductImageUrl: string | null;
  readonly suggestedProductDescription: string | null;
  readonly productImageUrl: string | null;
  readonly productDescription: string | null;
  readonly productStatus: string | null;
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

/** Change-log field that records "Don't match these products" (audited, newest entry wins). */
export const DISMISSED_SUGGESTION_FIELD = 'dismissedSuggestion';

/** SKU whose suggestion was last dismissed for the listing (null when none / cleared). */
function dismissedSkuSql(): SQL {
  return sql`(SELECT cl.to_value FROM change_log cl WHERE cl.entity_type = ${ENTITY} AND cl.entity_id = ${l.id} AND cl.field = ${DISMISSED_SUGGESTION_FIELD} ORDER BY cl.at DESC, cl.rowid DESC LIMIT 1)`;
}

/**
 * Suggested product for unlinked listings: same client, active, case-insensitive SKU equality,
 * unless the user dismissed that suggestion ("Don't match these products").
 */
export function suggestionSql(col: 'id' | 'sku' | 'name' | 'image_url' | 'description'): SQL {
  return sql`(CASE WHEN ${l.productId} IS NULL THEN (SELECT ${sql.raw(`p.${col}`)} FROM products p WHERE p.client_id = ${l.clientId} AND lower(p.sku) = lower(${l.sellerSku})
    AND lower(p.sku) IS DISTINCT FROM lower(COALESCE(${dismissedSkuSql()}, '')) LIMIT 1) ELSE NULL END)`;
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
  return LISTING_GRID_FIELDS.map((f) => ({
    key: f.field,
    label: f.label,
    type: f.type,
    nullable: true,
    sql: e[f.field] as SQL,
  }));
}

/** Tag filter must match any tag on the listing, not just the first. */
function tagFilter(query: GridQuery): { filters: GridQuery['filters']; extra: SQL | undefined } {
  const tagFilters = query.filters.filter((f) => f.field === 'tagId');
  const rest = query.filters.filter((f) => f.field !== 'tagId');
  const parts = tagFilters.map((f) => {
    if (f.op === 'in' || f.op === 'nin') {
      const list = sql.join(
        f.values.map((v) => sql`${v}`),
        sql`, `,
      );
      const exists = sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'listing' AND et.entity_id = ${l.id} AND et.tag_id IN (${list}))`;
      return f.op === 'in' ? exists : sql`NOT ${exists}`;
    }
    const any = sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'listing' AND et.entity_id = ${l.id})`;
    return f.op === 'empty' ? sql`NOT ${any}` : any;
  });
  return { filters: rest, extra: parts.length ? and(...parts) : undefined };
}

export function listingWhere(
  scope: Scope,
  query: GridQuery,
  link: ListingLinkState | undefined,
): SQL | undefined {
  const text = query.q?.trim();
  const match = (expr: SQL): SQL =>
    query.qm === 'eq'
      ? sql`lower(${expr}) = lower(${text})`
      : sql`${expr} ILIKE ${`${escapeLike(text ?? '')}%`} ESCAPE '\\'`;
  const search = text
    ? sql`(${match(sql`${l.sellerSku}`)} OR ${match(sql`${l.name}`)} OR ${match(sql`${l.channelProductId}`)})`
    : undefined;
  const { filters, extra } = tagFilter(query);
  const parts = [
    scopedWhere(l, scope),
    link === 'linked'
      ? sql`${l.productId} IS NOT NULL`
      : link === 'unlinked'
        ? sql`${l.productId} IS NULL`
        : undefined,
    search,
    compileFilters(listingFilterDefs(), filters),
    extra,
  ].filter((x): x is SQL => x !== undefined);
  return parts.length ? and(...parts) : undefined;
}

type Raw = Record<string, unknown>;

export async function listListings(
  db: AppDb,
  scope: Scope,
  query: GridQuery,
  link: ListingLinkState | undefined,
): Promise<{ rows: ListingRow[]; total: number; counts: { linked: number; unlinked: number } }> {
  const e = expressions();
  const where = listingWhere(scope, query, link);
  const whereSql = where ? sql`WHERE ${where}` : sql``;
  const sortable: SortableMap = Object.fromEntries(LISTING_SORT_FIELDS.map((f) => [f, e[f] as SQL]));
  const order = compileSort(sortable, query.sort, {
    defaultSort: [{ field: 'createdAt', dir: 'desc' }],
    tiebreaker: l.id,
  });
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  // Two phases (see listProducts): page the ids with only the sort expressions, then build the
  // visible rows. The suggestion lookup (lower(sku) match) no longer runs for every listing.
  const pageIds = (
    await dbAll<{ id: string }>(
      db,
      sql`SELECT ${l.id} AS id FROM ${l} ${whereSql} ORDER BY ${sql.join(order, sql`, `)} LIMIT ${query.pageSize} OFFSET ${offset}`,
    )
  ).map((r) => r.id);
  const position = new Map(pageIds.map((id, i) => [id, i]));
  const raw =
    pageIds.length === 0
      ? []
      : (
          await dbAll<Raw>(
            db,
            sql`
    SELECT ${l.id} AS id, ${l.name} AS name, ${l.imageUrl} AS "imageUrl", ${e.storeName} AS "storeName",
      (SELECT c.provider FROM channel_connections c WHERE c.id = ${l.channelConnectionId}) AS provider,
      ${l.channelConnectionId} AS "channelConnectionId", ${l.clientId} AS "clientId", ${e.clientName} AS "clientName",
      ${l.sellerSku} AS "sellerSku", ${l.channelProductId} AS "channelProductId", ${l.description} AS description,
      ${l.storePrice} AS "storePrice", ${l.productId} AS "productId", ${e.productSku} AS "productSku",
      (SELECT p.name FROM products p WHERE p.id = ${l.productId}) AS "productName", ${l.neverSync} AS "neverSync",
      ${e.productType} AS "productType", ${e.productGroup} AS "productGroup", ${l.linkedAt} AS "linkedAt",
      ${e.exception} AS exception, ${l.createdAt} AS "createdAt", ${l.version} AS version,
      (SELECT p.image_url FROM products p WHERE p.id = ${l.productId}) AS "productImageUrl",
      (SELECT p.description FROM products p WHERE p.id = ${l.productId}) AS "productDescription",
      (SELECT p.status FROM products p WHERE p.id = ${l.productId}) AS "productStatus"
    FROM ${l} WHERE ${l.id} IN (${sql.join(
      pageIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
          )
        ).sort((a, b) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
  const ids = raw.map((r) => String(r.id));
  // Suggestions for the page's unlinked rows in one set-based join (same rule as `suggestionSql`).
  // As a per-row subquery the lower(sku) match scanned the client's whole catalog once per
  // visible row; joined, the catalog is read once for the page.
  const unlinkedIds = raw.filter((r) => r.productId === null).map((r) => String(r.id));
  const suggestionByListing = new Map(
    unlinkedIds.length === 0
      ? []
      : (
          await dbAll<{ id: string; productId: string }>(
            db,
            sql`SELECT DISTINCT ON (${l.id}) ${l.id} AS id, p.id AS "productId"
    FROM ${l} JOIN products p ON p.client_id = ${l.clientId} AND lower(p.sku) = lower(${l.sellerSku})
    WHERE ${l.id} IN (${sql.join(
      unlinkedIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND ${l.productId} IS NULL
      AND lower(p.sku) IS DISTINCT FROM lower(COALESCE(${dismissedSkuSql()}, ''))
    ORDER BY ${l.id}, p.sku`,
          )
        ).map((x) => [String(x.id), x.productId] as const),
  );
  for (const r of raw) r.suggestedProductId = suggestionByListing.get(String(r.id)) ?? null;
  const suggestedIds = [
    ...new Set(raw.map((r) => r.suggestedProductId).filter((v): v is string => typeof v === 'string')),
  ];
  const suggested = new Map(
    suggestedIds.length
      ? (
          await db
            .select({
              id: schema.products.id,
              sku: schema.products.sku,
              name: schema.products.name,
              imageUrl: schema.products.imageUrl,
              description: schema.products.description,
            })
            .from(schema.products)
            .where(inArray(schema.products.id, suggestedIds))
        ).map((x) => [x.id, x] as const)
      : [],
  );
  for (const r of raw) {
    const sp = typeof r.suggestedProductId === 'string' ? suggested.get(r.suggestedProductId) : undefined;
    r.suggestedProductSku = sp?.sku ?? null;
    r.suggestedProductName = sp?.name ?? null;
    r.suggestedProductImageUrl = sp?.imageUrl ?? null;
    r.suggestedProductDescription = sp?.description ?? null;
  }
  const tagRows = ids.length
    ? await db
        .select({
          entityId: schema.entityTags.entityId,
          id: schema.tags.id,
          name: schema.tags.name,
          color: schema.tags.color,
        })
        .from(schema.entityTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
        .where(and(eq(schema.entityTags.entityType, ENTITY), inArray(schema.entityTags.entityId, ids)))
        .orderBy(asc(schema.tags.name))
    : [];
  const rows = raw.map((r): ListingRow => {
    const tags = tagRows
      .filter((t) => t.entityId === r.id)
      .map((t) => ({ id: t.id, name: t.name, color: t.color }));
    return {
      id: String(r.id),
      name: String(r.name),
      imageUrl: (r.imageUrl as string | null) ?? null,
      storeName: String(r.storeName ?? ''),
      provider: String(r.provider ?? ''),
      channelConnectionId: String(r.channelConnectionId),
      clientId: String(r.clientId),
      clientName: String(r.clientName ?? ''),
      sellerSku: String(r.sellerSku),
      channelProductId: String(r.channelProductId),
      description: (r.description as string | null) ?? null,
      storePrice: r.storePrice === null || r.storePrice === undefined ? null : Number(r.storePrice),
      tagNames: tags.map((t) => t.name).join(', '),
      tags,
      productId: (r.productId as string | null) ?? null,
      productSku: (r.productSku as string | null) ?? null,
      productName: (r.productName as string | null) ?? null,
      suggestedProductId: (r.suggestedProductId as string | null) ?? null,
      suggestedProductSku: (r.suggestedProductSku as string | null) ?? null,
      suggestedProductName: (r.suggestedProductName as string | null) ?? null,
      suggestedProductImageUrl: (r.suggestedProductImageUrl as string | null) ?? null,
      suggestedProductDescription: (r.suggestedProductDescription as string | null) ?? null,
      productImageUrl: (r.productImageUrl as string | null) ?? null,
      productDescription: (r.productDescription as string | null) ?? null,
      productStatus: (r.productStatus as string | null) ?? null,
      neverSync: r.neverSync === 1 || r.neverSync === true,
      productType: (r.productType as string | null) ?? null,
      productGroup: (r.productGroup as string | null) ?? null,
      linkedAt: (r.linkedAt as string | null) ?? null,
      createdAt: String(r.createdAt),
      version: Number(r.version),
      exception: asException(r.exception),
      exceptionLabel: asException(r.exception)
        ? LISTING_EXCEPTION_LABELS[asException(r.exception) as ListingException]
        : null,
    };
  });
  const total = Number(
    (await dbGet<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM ${l} ${whereSql}`))?.n ?? 0,
  );
  const scopeWhere = scopedWhere(l, scope);
  const countSql = (linked: boolean) =>
    sql`SELECT COUNT(*) AS n FROM ${l} WHERE ${linked ? sql`${l.productId} IS NOT NULL` : sql`${l.productId} IS NULL`}${scopeWhere ? sql` AND ${scopeWhere}` : sql``}`;
  const counts = {
    linked: Number((await dbGet<{ n: number }>(db, countSql(true)))?.n ?? 0),
    unlinked: Number((await dbGet<{ n: number }>(db, countSql(false)))?.n ?? 0),
  };
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
export async function listListingExceptions(
  db: AppDb,
  scope: Scope,
  kind?: ListingException,
): Promise<{ rows: ListingExceptionRow[]; counts: Record<ListingException, number> }> {
  const ex = listingExceptionSql();
  const scopeWhere = scopedWhere(l, scope);
  const raw = await dbAll<Raw>(
    db,
    sql`
    SELECT * FROM (
      SELECT ${l.id} AS id, ${ex} AS exception, ${l.sellerSku} AS "sellerSku", ${l.name} AS name,
        (SELECT c.store_name FROM channel_connections c WHERE c.id = ${l.channelConnectionId}) AS "storeName",
        (SELECT c.name FROM clients c WHERE c.id = ${l.clientId}) AS "clientName",
        ${l.productId} AS "productId", (SELECT p.sku FROM products p WHERE p.id = ${l.productId}) AS "productSku", ${l.createdAt} AS "createdAt"
      FROM ${l} ${scopeWhere ? sql`WHERE ${scopeWhere}` : sql``}
    ) x WHERE x.exception IS NOT NULL ORDER BY x."createdAt" DESC, x.id`,
  );
  const all = raw.map((r): ListingExceptionRow => {
    const exception = asException(r.exception) as ListingException;
    return {
      id: String(r.id),
      exception,
      exceptionLabel: LISTING_EXCEPTION_LABELS[exception],
      sellerSku: String(r.sellerSku),
      name: String(r.name),
      storeName: String(r.storeName ?? ''),
      clientName: String(r.clientName ?? ''),
      productId: (r.productId as string | null) ?? null,
      productSku: (r.productSku as string | null) ?? null,
      createdAt: String(r.createdAt),
    };
  });
  const counts = Object.fromEntries(
    LISTING_EXCEPTIONS.map((k) => [k, all.filter((r) => r.exception === k).length]),
  ) as Record<ListingException, number>;
  return { rows: kind ? all.filter((r) => r.exception === kind) : all, counts };
}

export interface ListingOptions {
  readonly clients: readonly { value: string; label: string }[];
  readonly stores: readonly { value: string; label: string; description: string }[];
  readonly tags: readonly { value: string; label: string }[];
}

export async function getListingOptions(db: AppDb, scope: Scope): Promise<ListingOptions> {
  const cc = schema.channelConnections;
  const stores = (
    await db
      .select({ id: cc.id, store: cc.storeName, provider: cc.provider })
      .from(cc)
      .where(scopedWhere(cc, scope))
      .orderBy(asc(cc.storeName))
  ).map((s) => ({ value: s.id, label: s.store, description: s.provider }));
  const clients = (
    await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        scope.clientIds === 'all' ? undefined : inArray(schema.clients.id, [...scope.clientIds, '__none__']),
      )
      .orderBy(asc(schema.clients.name))
  ).map((c) => ({ value: c.id, label: c.name }));
  const tags = (
    await db
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(inArray(schema.tags.scope, ['listing', 'any']))
      .orderBy(asc(schema.tags.name))
  ).map((t) => ({ value: t.id, label: t.name }));
  return { clients, stores, tags };
}

async function loadListing(tx: AppDb, ctx: ScopedCtx, id: string): Promise<typeof l.$inferSelect> {
  const row = (await tx.select().from(l).where(eq(l.id, id)).limit(1))[0];
  assertInScope(ctx.scope, row ? { clientId: row.clientId } : null, 'Listing');
  return row as typeof l.$inferSelect;
}

async function skuOf(tx: AppDb, productId: string | null): Promise<string | null> {
  return productId
    ? ((
        await tx
          .select({ sku: schema.products.sku })
          .from(schema.products)
          .where(eq(schema.products.id, productId))
          .limit(1)
      )[0]?.sku ?? null)
    : null;
}

export async function linkListing(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
  productId: string,
  version?: number,
): Promise<typeof l.$inferSelect> {
  const row = await loadListing(tx, ctx, id);
  if (version !== undefined && version !== row.version) throw conflictError();
  const product = (
    await tx
      .select({ id: schema.products.id, clientId: schema.products.clientId, sku: schema.products.sku })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1)
  )[0];
  if (!product || !hasClient(ctx.scope, product.clientId)) throw notFoundError('Product');
  if (product.clientId !== row.clientId) {
    throw new AppError('VALIDATION', 'The product belongs to a different client than the listing', {
      fieldErrors: { productId: ["Pick a product of the listing's client"] },
    });
  }
  if (row.productId === productId) return row;
  const linkedAt = new Date().toISOString();
  await tx
    .update(l)
    .set({ productId, linkedAt, updatedBy: ctx.userId, version: row.version + 1 })
    .where(eq(l.id, id));
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: row.sellerSku,
    before: { linkedProduct: await skuOf(tx, row.productId) },
    after: { linkedProduct: product.sku },
  });
  // Linking the product whose suggestion was dismissed earlier withdraws the dismissal.
  const dismissed = await dismissedSku(tx, id);
  if (dismissed && dismissed.toLowerCase() === product.sku.toLowerCase()) {
    await recordUpdate(tx, ctx, {
      entityType: ENTITY,
      entityId: id,
      entityCode: row.sellerSku,
      before: { [DISMISSED_SUGGESTION_FIELD]: dismissed },
      after: { [DISMISSED_SUGGESTION_FIELD]: null },
    });
  }
  return { ...row, productId, linkedAt, version: row.version + 1 };
}

export async function unlinkListing(tx: AppDb, ctx: ScopedCtx, id: string): Promise<typeof l.$inferSelect> {
  const row = await loadListing(tx, ctx, id);
  if (!row.productId) throw new AppError('INVALID_STATE', 'This listing is not linked to a product');
  await tx
    .update(l)
    .set({ productId: null, linkedAt: null, updatedBy: ctx.userId, version: row.version + 1 })
    .where(eq(l.id, id));
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: row.sellerSku,
    before: { linkedProduct: await skuOf(tx, row.productId) },
    after: { linkedProduct: null },
  });
  return { ...row, productId: null, linkedAt: null, version: row.version + 1 };
}

export async function setNeverSync(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
  neverSync: boolean,
): Promise<typeof l.$inferSelect> {
  const row = await loadListing(tx, ctx, id);
  if (row.neverSync === neverSync) return row;
  await tx
    .update(l)
    .set({ neverSync, updatedBy: ctx.userId, version: row.version + 1 })
    .where(eq(l.id, id));
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: row.sellerSku,
    before: { neverSync: row.neverSync },
    after: { neverSync },
  });
  return { ...row, neverSync, version: row.version + 1 };
}

async function dismissedSku(tx: AppDb, id: string): Promise<string | null> {
  const row = await dbGet<{ v: string | null }>(
    tx,
    sql`SELECT cl.to_value AS v FROM change_log cl WHERE cl.entity_type = ${ENTITY} AND cl.entity_id = ${id} AND cl.field = ${DISMISSED_SUGGESTION_FIELD} ORDER BY cl.at DESC, cl.rowid DESC LIMIT 1`,
  );
  return row?.v ? row.v : null;
}

/**
 * "Don't match these products" (Logiwa's reject icon): hides the SKU suggestion for this
 * listing so it shows as No match. Audited in the change log; linking that product later
 * withdraws the dismissal.
 */
export async function dismissSuggestion(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
): Promise<{ listing: typeof l.$inferSelect; dismissedSku: string }> {
  const row = await loadListing(tx, ctx, id);
  if (row.productId) throw new AppError('INVALID_STATE', 'This listing is already linked to a product');
  const suggested =
    (
      await dbGet<{ sku: string | null }>(
        tx,
        sql`SELECT ${suggestionSql('sku')} AS sku FROM ${l} WHERE ${l.id} = ${id}`,
      )
    )?.sku ?? null;
  if (!suggested) throw new AppError('INVALID_STATE', 'This listing has no suggested product');
  await recordUpdate(tx, ctx, {
    entityType: ENTITY,
    entityId: id,
    entityCode: row.sellerSku,
    before: { [DISMISSED_SUGGESTION_FIELD]: null },
    after: { [DISMISSED_SUGGESTION_FIELD]: suggested },
  });
  await tx
    .update(l)
    .set({ updatedBy: ctx.userId, version: row.version + 1 })
    .where(eq(l.id, id));
  return { listing: { ...row, version: row.version + 1 }, dismissedSku: suggested };
}

/**
 * "Create New" tab of the Link Product drawer: creates the product through the full wizard
 * path (validation, SKU uniqueness, pack type, change log), links it and applies Never Sync,
 * all in the caller's transaction.
 */
export async function createQuickProductForListing(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
  raw: ListingQuickProductInput,
  version?: number,
): Promise<{ listing: typeof l.$inferSelect; productId: string; created: true }> {
  const row = await loadListing(tx, ctx, id);
  if (version !== undefined && version !== row.version) throw conflictError();
  if (row.productId) throw new AppError('INVALID_STATE', 'This listing is already linked to a product');
  const parsed = listingQuickProductSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.map(String).join('.') || '_';
      fieldErrors[k] = [...(fieldErrors[k] ?? []), i.message];
    }
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid product', { fieldErrors });
  }
  const product = await createProductFromWizard(tx, ctx, quickProductToInput(row.clientId, parsed.data));
  let listing = await linkListing(tx, ctx, id, product.id);
  if (parsed.data.neverSync !== listing.neverSync)
    listing = await setNeverSync(tx, ctx, id, parsed.data.neverSync);
  return { listing, productId: product.id, created: true };
}

/** Creates (or finds) the client's product with the seller SKU and links it. Beyond Logiwa. */
export async function createProductFromListing(
  tx: AppDb,
  ctx: ScopedCtx,
  id: string,
): Promise<{ listing: typeof l.$inferSelect; productId: string; created: boolean }> {
  const row = await loadListing(tx, ctx, id);
  if (row.productId) throw new AppError('INVALID_STATE', 'This listing is already linked to a product');
  const { product, created } = await ensureProductForListing(tx, ctx, {
    clientId: row.clientId,
    sellerSku: row.sellerSku,
    name: row.name,
    price: row.storePrice ?? 0,
  });
  if (row.imageUrl && created)
    await tx
      .update(schema.products)
      .set({ imageUrl: row.imageUrl, description: row.description })
      .where(eq(schema.products.id, product.id));
  const listing = await linkListing(tx, ctx, id, product.id);
  return { listing, productId: product.id, created };
}
