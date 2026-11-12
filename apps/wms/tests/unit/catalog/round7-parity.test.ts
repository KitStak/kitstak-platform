/** Blind-judge repair round 2: own-box enforcement at packing, listing Initial quantity rules, two-phase paging order. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { Scope } from '@/server/auth/scope';
import { EMPTY_GRID_QUERY, type GridQuery } from '@/server/query/grid-query';
import { validatePackages, type PackLine } from '@/server/repositories/packing';
import { listProducts } from '@/server/repositories/products';
import { listListings } from '@/server/repositories/listings';
import { initialQuantityErrors } from '@/components/products/listing-link-drawer';
import { createWorld, type World } from '../foundation/domain/fixtures';

const line = (over: Partial<PackLine>): PackLine => ({
  orderLineId: 'l1',
  productId: 'p1',
  sku: 'BOXED',
  name: 'n',
  imageUrl: null,
  packType: 'Each',
  ordered: 2,
  toPack: 2,
  packed: 0,
  weightOz: 8,
  scanCodes: ['boxed'],
  trackSerial: false,
  captureLot: false,
  captureExpiry: false,
  lotNumber: null,
  expiryDate: null,
  pickedSerials: [],
  packingInstructions: null,
  ...over,
});
const pkg = (items: { orderLineId: string; qty: number }[]) => ({
  shipmentPackageId: null,
  length: 10,
  width: 8,
  height: 4,
  weightOz: 20,
  items,
});

describe('use_own_box at packing', () => {
  const own = [line({ useOwnBox: true }), line({ orderLineId: 'l2', sku: 'OTHER', toPack: 1, ordered: 1 })];
  it('blocks two own-box units in one package', () => {
    expect(() =>
      validatePackages(own, {
        packages: [pkg([{ orderLineId: 'l1', qty: 2 }]), pkg([{ orderLineId: 'l2', qty: 1 }])],
        captures: [],
      }),
    ).toThrow(/ships in its own box/);
  });
  it('blocks mixing an own-box unit with other items', () => {
    expect(() =>
      validatePackages(own, {
        packages: [
          pkg([
            { orderLineId: 'l1', qty: 1 },
            { orderLineId: 'l2', qty: 1 },
          ]),
          pkg([{ orderLineId: 'l1', qty: 1 }]),
        ],
        captures: [],
      }),
    ).toThrow(/ships in its own box/);
  });
  it('accepts one unit per package', () => {
    expect(() =>
      validatePackages(own, {
        packages: [
          pkg([{ orderLineId: 'l1', qty: 1 }]),
          pkg([{ orderLineId: 'l1', qty: 1 }]),
          pkg([{ orderLineId: 'l2', qty: 1 }]),
        ],
        captures: [],
      }),
    ).not.toThrow();
  });
  it('leaves normal pack types alone', () => {
    expect(() =>
      validatePackages([line({})], { packages: [pkg([{ orderLineId: 'l1', qty: 2 }])], captures: [] }),
    ).not.toThrow();
  });
});

describe('listing Create new: Initial quantity', () => {
  it('is optional', () => {
    expect(initialQuantityErrors({ qty: null, warehouseId: null, locationId: null })).toEqual({});
    expect(initialQuantityErrors({ qty: 0, warehouseId: null, locationId: null })).toEqual({});
  });
  it('needs a warehouse and location once a quantity is entered', () => {
    expect(initialQuantityErrors({ qty: 5, warehouseId: null, locationId: null })).toEqual({
      initialWarehouse: 'Select a warehouse',
      initialLocation: 'Select a location',
    });
    expect(initialQuantityErrors({ qty: 5, warehouseId: 'w', locationId: 'l' })).toEqual({});
    expect(initialQuantityErrors({ qty: -1, warehouseId: 'w', locationId: 'l' }).initialQty).toMatch(
      /whole number/,
    );
    expect(
      initialQuantityErrors({ qty: 2, warehouseId: 'w', locationId: 'l', reasonId: null }, true)
        .initialReason,
    ).toMatch(/requires an adjustment reason/);
    expect(initialQuantityErrors({ qty: 2, warehouseId: 'w', locationId: 'l', reasonId: 'r' }, true)).toEqual(
      {},
    );
  });
});

describe('two-phase paging keeps the sort order', () => {
  let w: World;
  let scope: Scope;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: 'all' } as unknown as Scope;
  });
  afterEach(() => w.close());
  const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 3, ...extra });

  it('products sorted by SKU desc, page 2', async () => {
    for (const s of ['A1', 'A2', 'A3', 'A4', 'A5'])
      await w.db
        .insert(schema.products)
        .values({
          clientId: w.clientId,
          sku: s,
          barcode: s,
          name: s,
          category: 'General',
          weightOz: 1,
          lengthIn: 1,
          widthIn: 1,
          heightIn: 1,
          price: 1,
          status: 'Active',
        });
    const all = (
      await listProducts(w.db, scope, q({ pageSize: 100, sort: [{ field: 'sku', dir: 'desc' }] }))
    ).rows.map((r) => r.sku);
    const p2 = await listProducts(w.db, scope, q({ page: 2, sort: [{ field: 'sku', dir: 'desc' }] }));
    expect(p2.rows.map((r) => r.sku)).toEqual(all.slice(3, 6));
    expect(p2.total).toBe(all.length);
  });

  it('listings keep order and suggestion details', async () => {
    const ch = (
      await w.db
        .insert(schema.channelConnections)
        .values({ provider: 'shopify', storeName: 'S', clientId: w.clientId, settings: {} as never })
        .returning()
    )[0].id;
    const sku = (await w.db.select().from(schema.products))[0]?.sku ?? '';
    for (const [i, s] of [sku, 'X2', 'X3'].entries())
      await w.db
        .insert(schema.productListings)
        .values({
          channelConnectionId: ch,
          clientId: w.clientId,
          sellerSku: s,
          channelProductId: `g${i}`,
          name: `L${i}`,
        });
    const res = await listListings(
      w.db,
      scope,
      q({ sort: [{ field: 'sellerSku', dir: 'asc' }] }),
      'unlinked',
    );
    expect(res.rows.map((r) => r.sellerSku)).toEqual([sku, 'X2', 'X3'].sort());
    const hit = res.rows.find((r) => r.sellerSku === sku);
    expect(hit?.suggestedProductSku).toBe(sku);
    expect(hit?.suggestedProductName).toBeTruthy();
  });
});
