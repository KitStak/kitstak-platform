/** M09 catalog: derived product listing exceptions (Missing product / SKU difference / Multi listing). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { Scope } from '@/server/auth/scope';
import { EMPTY_GRID_QUERY, type GridQuery } from '@/server/query/grid-query';
import { linkListing, listListingExceptions, listListings } from '@/server/repositories/listings';
import { LISTING_GRID_FIELDS } from '@/lib/grid-defs/products/listings-grid';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let scope: Scope;

beforeEach(async () => {
  w = await createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: 'all' };
});
afterEach(() => w.close());

const ctx = () => ({ ...w.ctx, scope });
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 100, ...extra });

async function seed(sellerSku: string, channelProductId: string, channelId?: string) {
  const conn =
    channelId ??
    (
      await w.db
        .insert(schema.channelConnections)
        .values({ provider: 'shopify', storeName: 'Acme Shop', clientId: w.clientId, settings: {} as never })
        .returning()
    )[0].id;
  const id = (
    await w.db
      .insert(schema.productListings)
      .values({
        channelConnectionId: conn,
        clientId: w.clientId,
        sellerSku,
        channelProductId,
        name: sellerSku,
      })
      .returning()
  )[0].id;
  return { id, conn };
}

describe('listing exceptions', () => {
  it('flags an unlinked listing and clears it once linked to the matching SKU', async () => {
    const { id } = await seed('MLT-WIDGET-01', 'gid-1');
    const before = await listListingExceptions(w.db, scope);
    expect(before.counts).toEqual({ unlinked: 1, sku_difference: 0, multi_listing: 0 });
    expect(before.rows[0]).toMatchObject({ id, exception: 'unlinked', exceptionLabel: 'Missing product' });

    await linkListing(w.db, ctx(), id, w.productId);
    const after = await listListingExceptions(w.db, scope);
    expect(after.rows).toEqual([]);
    expect((await listListings(w.db, scope, q(), 'linked')).rows[0]).toMatchObject({
      sellerSku: 'MLT-WIDGET-01',
      exception: null,
      exceptionLabel: null,
    });
  });

  it('reports a SKU difference when the seller SKU differs from the linked product', async () => {
    const { id } = await seed('SHOP-WIDGET', 'gid-2');
    await linkListing(w.db, ctx(), id, w.productId);
    const { rows, counts } = await listListingExceptions(w.db, scope, 'sku_difference');
    expect(counts.sku_difference).toBe(1);
    expect(rows.map((r) => [r.sellerSku, r.exception, r.productSku])).toEqual([
      ['SHOP-WIDGET', 'sku_difference', 'MLT-WIDGET-01'],
    ]);
  });

  it('reports multi listing when two listings of one store link the same product', async () => {
    const a = await seed('mlt-widget-01', 'gid-a');
    const b = await seed('MLT-WIDGET-01', 'gid-b', a.conn);
    await linkListing(w.db, ctx(), a.id, w.productId);
    await linkListing(w.db, ctx(), b.id, w.productId);
    expect((await listListingExceptions(w.db, scope)).counts).toEqual({
      unlinked: 0,
      sku_difference: 0,
      multi_listing: 2,
    });
  });

  it('filters the grid by exception through the Exception filter', async () => {
    await seed('MLT-WIDGET-01', 'gid-1');
    const linked = await seed('OTHER', 'gid-2');
    await linkListing(w.db, ctx(), linked.id, w.productId);
    const filtered = await listListings(
      w.db,
      scope,
      q({ filters: [{ field: 'exception', op: 'in', values: ['sku_difference'] }] } as Partial<GridQuery>),
      undefined,
    );
    expect(filtered.rows.map((r) => r.sellerSku)).toEqual(['OTHER']);
    expect(LISTING_GRID_FIELDS.find((f) => f.field === 'exception')?.options?.map((o) => o.value)).toEqual([
      'unlinked',
      'sku_difference',
      'multi_listing',
    ]);
  });

  it('suggests the same-client product whose SKU matches the seller SKU (Logiwa Suggested state)', async () => {
    await seed('mlt-widget-01', 'gid-s');
    await seed('NO-SUCH-SKU', 'gid-n');
    const rows = (await listListings(w.db, scope, q(), 'unlinked')).rows;
    const bySku = Object.fromEntries(rows.map((r) => [r.sellerSku, r]));
    expect(bySku['mlt-widget-01']).toMatchObject({
      suggestedProductId: w.productId,
      suggestedProductSku: 'MLT-WIDGET-01',
    });
    expect(bySku['NO-SUCH-SKU']).toMatchObject({ suggestedProductId: null, suggestedProductSku: null });
    await linkListing(w.db, ctx(), bySku['mlt-widget-01']!.id, w.productId);
    expect((await listListings(w.db, scope, q(), 'linked')).rows[0]).toMatchObject({
      suggestedProductId: null,
    });
  });

  it('respects client scope', async () => {
    await seed('MLT-WIDGET-01', 'gid-1');
    expect(
      (await listListingExceptions(w.db, { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] }))
        .rows,
    ).toEqual([]);
  });
});
