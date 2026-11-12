/** M09 catalog, critic round 4 (parity loop): demo-data hygiene and the detail header barcode. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { Scope } from '@/server/auth/scope';
import { headerBarcode } from '@/lib/grid-defs/products/header-barcode';
import { emptyProductForm, newPackType, type ProductInput } from '@/lib/grid-defs/products/product-form';
import { createProductFromWizard } from '@/server/repositories/products-commands';
import { isTestSku, planTestDataPurge, purgeTestCatalogData } from '@/server/repositories/products-test-data';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('headerBarcode', () => {
  const packs = [
    { kind: 'Hierarchical', packType: 'Case', barcodes: ['CASE-1'] },
    { kind: 'Primary', packType: 'Each', barcodes: ['0001', '0002'] },
  ];
  it('prefers the product barcode', () => {
    expect(headerBarcode('PB-1', packs)).toEqual({ value: 'PB-1', source: null });
  });
  it("falls back to the primary pack type's first barcode, then any pack barcode", () => {
    expect(headerBarcode('', packs)).toEqual({ value: '0001', source: 'Each' });
    expect(headerBarcode(null, [packs[0]!])).toEqual({ value: 'CASE-1', source: 'Case' });
  });
  it('returns no value when nothing has a barcode', () => {
    expect(headerBarcode('  ', [{ kind: 'Primary', packType: 'Each', barcodes: [] }])).toEqual({
      value: null,
      source: null,
    });
  });
});

describe('test-data purge (REQ-25)', () => {
  let w: World;
  let scope: Scope;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: 'all' };
  });
  afterEach(() => w.close());
  const ctx = () => ({ ...w.ctx, scope });
  const make = async (sku: string, extra: Partial<ProductInput> = {}) =>
    await createProductFromWizard(w.db, ctx(), {
      ...emptyProductForm('Product', w.clientId),
      sku,
      name: sku,
      packTypes: [
        {
          ...newPackType('Primary', []),
          key: 'u',
          packType: 'Each',
          length: 1,
          width: 1,
          height: 1,
          barcodes: [],
        },
      ],
      ...extra,
    } as unknown as ProductInput);

  it('recognises only the test prefixes', () => {
    expect(isTestSku('KS-CRIT-R3-1')).toBe(true);
    expect(isTestSku('ks-e2e-lst')).toBe(true);
    expect(isTestSku('MLT-WIDGET')).toBe(false);
    expect(isTestSku('APX-KS-CRIT')).toBe(false);
  });

  it('deletes clean test products and listings, deactivates ones with stock, leaves real SKUs alone', async () => {
    const clean = await make('KS-CRIT-CLEAN');
    const stocked = await make('KS-E2E-STOCK');
    const real = await make('APX-REAL-1');
    await w.db
      .insert(schema.inventory)
      .values({
        warehouseId: w.warehouseId,
        locationId: w.loc.storageA,
        clientId: w.clientId,
        productId: stocked.id,
        onHand: 3,
        receivedAt: '2026-01-01',
      });
    const conn = (
      await w.db
        .insert(schema.channelConnections)
        .values({ provider: 'shopify', storeName: 'Shop', clientId: w.clientId, settings: {} as never })
        .returning()
    )[0].id;
    const testListing = (
      await w.db
        .insert(schema.productListings)
        .values({
          channelConnectionId: conn,
          clientId: w.clientId,
          sellerSku: 'KS-E2E-LST-1',
          channelProductId: 'g1',
          name: 't',
          productId: clean.id,
        })
        .returning()
    )[0];
    const realListing = (
      await w.db
        .insert(schema.productListings)
        .values({
          channelConnectionId: conn,
          clientId: w.clientId,
          sellerSku: 'APX-REAL-1',
          channelProductId: 'g2',
          name: 'r',
          productId: real.id,
        })
        .returning()
    )[0];

    const plan = await planTestDataPurge(w.db);
    expect(plan.deletable.map((r) => r.sku)).toEqual(['KS-CRIT-CLEAN']);
    expect(plan.deactivate.map((r) => r.sku)).toEqual(['KS-E2E-STOCK']);
    expect(plan.listingIds).toEqual([testListing.id]);

    await purgeTestCatalogData(w.db, ctx());
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, clean.id)).limit(1))[0],
    ).toBeUndefined();
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, stocked.id)).limit(1))[0]
        ?.status,
    ).toBe('Inactive');
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, real.id)).limit(1))[0]?.status,
    ).toBe('Active');
    expect(
      (
        await w.db
          .select()
          .from(schema.productListings)
          .where(eq(schema.productListings.id, testListing.id))
          .limit(1)
      )[0],
    ).toBeUndefined();
    expect(
      (
        await w.db
          .select()
          .from(schema.productListings)
          .where(eq(schema.productListings.id, realListing.id))
          .limit(1)
      )[0]?.productId,
    ).toBe(real.id);
    // Idempotent: a second run has nothing left to do except the already-inactive stocked SKU.
    const again = await planTestDataPurge(w.db);
    expect(again.deletable).toEqual([]);
    expect(again.deactivate).toEqual([]);
    expect(again.keptInactive.map((r) => r.sku)).toEqual(['KS-E2E-STOCK']);
  });

  it('deletes a test kit and then its test component', async () => {
    const comp = await make('KS-CRIT-COMP');
    await createProductFromWizard(w.db, ctx(), {
      ...emptyProductForm('Kit', w.clientId),
      sku: 'KS-CRIT-KIT',
      name: 'kit',
      kitType: 'Kit to Order',
      components: [{ productId: comp.id, sku: comp.sku, name: comp.name, imageUrl: null, quantity: 2 }],
    } as unknown as ProductInput);
    const plan = await planTestDataPurge(w.db);
    expect(plan.deletable.map((r) => r.sku).sort()).toEqual(['KS-CRIT-COMP', 'KS-CRIT-KIT']);
    await purgeTestCatalogData(w.db, ctx());
    expect((await w.db.select().from(schema.products)).filter((r) => r.sku.startsWith('KS-CRIT-'))).toEqual(
      [],
    );
  });
});
