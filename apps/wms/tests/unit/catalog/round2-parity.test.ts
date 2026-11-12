/**
 * M09 round 2 (parity loop): image proxy SSRF guards + cache, catalog read permissions,
 * optional hazmat/customs on the API, partial PATCH, and kit-level barcode uniqueness.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { DEFAULT_ROLE_PERMISSIONS } from '@/server/auth/permission-catalog';
import {
  emptyProductForm,
  newPackType,
  productInputSchema,
  type ProductFormValues,
  type ProductInput,
} from '@/lib/grid-defs/products/product-form';
import { LISTING_READ_PERMISSIONS, PRODUCT_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { createProductFromWizard, updateProductFromWizard } from '@/server/repositories/products-commands';
import { getProductForm } from '@/server/repositories/products-detail';
import {
  ImageProxyError,
  clearProductImageCache,
  getProductImage,
  isBlockedAddress,
  parseImageUrl,
} from '@/server/repositories/products-image';
import { productImageSrc } from '@/components/products/catalog-shared';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('image proxy URL guard', () => {
  it('accepts public http(s) image URLs', () => {
    expect(parseImageUrl('https://cdn.shopify.com/s/files/1/x.jpg').hostname).toBe('cdn.shopify.com');
    expect(parseImageUrl('http://m.media-amazon.com/images/I/a.jpg').protocol).toBe('http:');
  });
  it.each([
    'ftp://example.com/a.png',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pw@example.com/a.png',
    'https://example.com:8443/a.png',
    'http://localhost/a.png',
    'http://127.0.0.1/a.png',
    'http://10.0.0.5/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/a.png',
    'http://192.168.1.10/a.png',
    'http://intranet.local/a.png',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => parseImageUrl(url)).toThrow(ImageProxyError);
  });
  it('blocks private, loopback, link-local, CGNAT, multicast and mapped addresses', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '2001:db8::1',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '151.101.1.69', '172.32.0.1', '2606:4700::6810:84e5'])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe('image proxy cache', () => {
  afterEach(() => clearProductImageCache());
  it('fetches once for concurrent and repeated requests', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { contentType: 'image/png', bytes: Buffer.from([1, 2, 3]) };
    };
    const [a, b] = await Promise.all([
      getProductImage('https://x.test/a.png', fetcher),
      getProductImage('https://x.test/a.png', fetcher),
    ]);
    await getProductImage('https://x.test/a.png', fetcher);
    expect(calls).toBe(1);
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });
  it('does not cache failures', async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new ImageProxyError(404, 'nope');
    };
    await expect(getProductImage('https://x.test/missing.png', failing)).rejects.toThrow('nope');
    await expect(getProductImage('https://x.test/missing.png', failing)).rejects.toThrow('nope');
    expect(calls).toBe(2);
  });
});

describe('productImageSrc', () => {
  it('routes remote URLs through the same-origin proxy and keeps local ones', () => {
    expect(productImageSrc('https://picsum.photos/200')).toBe(
      '/api/products/image?u=https%3A%2F%2Fpicsum.photos%2F200',
    );
    expect(productImageSrc('/api/files/abc?inline=1')).toBe('/api/files/abc?inline=1');
    expect(productImageSrc('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    expect(productImageSrc('javascript:alert(1)')).toBeNull();
    expect(productImageSrc('  ')).toBeNull();
    expect(productImageSrc(null)).toBeNull();
  });
});

describe('catalog read permissions', () => {
  it('default operator and viewer roles can read products and listings, but hold no catalog mutation', () => {
    for (const role of ['operator', 'viewer'] as const) {
      const granted = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
      expect(
        PRODUCT_READ_PERMISSIONS.some((k) => granted.has(k)),
        role,
      ).toBe(true);
      expect(
        LISTING_READ_PERMISSIONS.some((k) => granted.has(k)),
        role,
      ).toBe(true);
      expect(
        granted.has('settings.products.edit') ||
          granted.has('settings.products.create') ||
          granted.has('settings.products.delete'),
        role,
      ).toBe(false);
    }
  });
});

describe('API contract', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());
  const scope = () => ({ warehouseIds: [w.warehouseId], clientIds: 'all' as const });
  const ctx = () => ({ ...w.ctx, scope: scope() });
  const unit = (barcodes: string[] = []) => ({
    ...newPackType('Primary', []),
    key: 'u',
    packType: 'Unit',
    length: 1,
    width: 1,
    height: 1,
    weight: 1,
    barcodes,
  });
  const input = (sku: string, extra: Partial<ProductFormValues> = {}): ProductInput =>
    ({
      ...emptyProductForm('Product', w.clientId),
      sku,
      name: `${sku} name`,
      packTypes: [unit()],
      ...extra,
    }) as ProductInput;

  it('accepts a body without hazmat and customs objects', async () => {
    const { hazmat: _h, customs: _c, ...rest } = input('API-NO-SUB') as Record<string, unknown>;
    void _h;
    void _c;
    expect(productInputSchema.safeParse(rest).success).toBe(true);
    const row = await createProductFromWizard(w.db, ctx(), rest as ProductInput);
    expect((await getProductForm(w.db, scope(), row.id))?.hazmat.type).toBeNull();
  });

  it('validates tax rate with an inline message instead of clamping', () => {
    const r = productInputSchema.safeParse(input('TAX-250', { taxRate: 250 }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === 'taxRate')?.message).toBe('Tax rate must be 0–100%');
    const neg = productInputSchema.safeParse(input('NEG', { salesPrice: -5 }));
    expect(neg.error?.issues.find((i) => i.path[0] === 'salesPrice')?.message).toBe('Must be 0 or more');
  });

  it('PATCH merges a partial body over the stored product', async () => {
    const row = await createProductFromWizard(
      w.db,
      ctx(),
      input('PATCH-1', {
        description: 'keep me',
        packTypes: [unit(['PB-1'])],
        customs: { ...emptyProductForm('Product').customs, hsCode: '6109' },
      }),
    );
    await updateProductFromWizard(w.db, ctx(), row.id, {
      name: 'Renamed',
      version: row.version,
      customs: { manufacturer: 'ACME' },
    } as unknown as ProductInput);
    const form = await getProductForm(w.db, scope(), row.id);
    expect(form?.name).toBe('Renamed');
    expect(form?.description).toBe('keep me');
    expect(form?.packTypes[0]?.barcodes).toEqual(['PB-1']);
    expect(form?.customs.hsCode).toBe('6109');
    expect(form?.customs.manufacturer).toBe('ACME');
    await expect(
      async () =>
        await updateProductFromWizard(w.db, ctx(), row.id, {
          name: 'Stale',
          version: row.version,
        } as unknown as ProductInput),
    ).rejects.toThrow();
  });

  it('rejects a kit barcode already used by another product of the same client', async () => {
    await createProductFromWizard(w.db, ctx(), input('BC-P', { packTypes: [unit(['777000111'])] }));
    const kit = {
      ...emptyProductForm('Kit', w.clientId),
      sku: 'KIT-BC',
      name: 'kit',
      kitType: 'Kit to Order',
      barcode: '777000111',
      components: [{ productId: w.productId, sku: 'x', name: 'x', imageUrl: null, quantity: 1 }],
    } as unknown as ProductInput;
    await expect(async () => await createProductFromWizard(w.db, ctx(), kit)).rejects.toThrow(
      /777000111 is already used by BC-P/,
    );
    const ok = await createProductFromWizard(w.db, ctx(), { ...kit, barcode: '777000222' } as ProductInput);
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, ok.id)).limit(1))[0]?.barcode,
    ).toBe('777000222');
  });
});
