/** M09 pure model: pack-type chain, volume, step schemas. */
import { describe, expect, it } from 'vitest';
import {
  computeVolume,
  hierarchicalUomQty,
  packingFlagsFor,
  toInches,
  toOunces,
} from '@/lib/grid-defs/products/catalog-options';
import {
  advancedStepSchema,
  componentsStepSchema,
  derivedVolume,
  emptyProductForm,
  generalStepSchema,
  newPackType,
  normalizeCountryCode,
  normalizePackTypes,
  packTypesStepSchema,
  productInputSchema,
} from '@/lib/grid-defs/products/product-form';

const pack = (
  key: string,
  kind: 'Primary' | 'Hierarchical' | 'Irregular',
  extra: Record<string, unknown> = {},
) => ({
  ...newPackType(kind, []),
  key,
  packType: key,
  ...extra,
});

describe('normalizePackTypes', () => {
  it('derives hierarchical UOM qty from child qty × parent chain', () => {
    const out = normalizePackTypes([
      pack('Unit', 'Primary'),
      pack('Case', 'Hierarchical', { parentKey: 'Unit', childQty: 12 }),
      pack('Pallet', 'Hierarchical', { parentKey: 'Case', childQty: 40 }),
      pack('3PK', 'Irregular', { uomQty: 3 }),
    ]);
    expect(out.map((p) => p.uomQty)).toEqual([1, 12, 480, 3]);
  });

  it('falls back to the primary when the parent is missing and never loops', () => {
    const out = normalizePackTypes([
      pack('Unit', 'Primary'),
      pack('Case', 'Hierarchical', { parentKey: 'Case', childQty: 6 }),
    ]);
    expect(out[1]?.uomQty).toBe(6);
  });
});

describe('volume', () => {
  it('computes L×W×H in the target unit', () => {
    expect(computeVolume(10, 8, 6, 'Inch', 'Cubic Inch')).toBe(480);
    expect(computeVolume(1, 1, 1, 'Foot', 'Cubic Inch')).toBe(1728);
    expect(computeVolume(12, 12, 12, 'Inch', 'Cubic Foot')).toBe(1);
  });

  it('keeps a manual override', () => {
    expect(
      derivedVolume({
        length: 1,
        width: 1,
        height: 1,
        dimensionUnit: 'Inch',
        volumeUnit: 'Cubic Inch',
        volume: 99,
        volumeOverridden: true,
      }),
    ).toBe(99);
    expect(
      derivedVolume({
        length: 2,
        width: 2,
        height: 2,
        dimensionUnit: 'Inch',
        volumeUnit: 'Cubic Inch',
        volume: 99,
        volumeOverridden: false,
      }),
    ).toBe(8);
  });

  it('converts weight and dims', () => {
    expect(toOunces(2, 'Pound')).toBe(32);
    expect(toInches(1, 'Foot')).toBe(12);
    expect(hierarchicalUomQty(12, 1)).toBe(12);
  });
});

describe('step schemas', () => {
  it('requires client, SKU and name with inline messages', () => {
    const r = generalStepSchema.safeParse(emptyProductForm('Product'));
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['clientId', 'sku', 'name']));
  });

  it('rejects negative prices and out-of-range tax with inline messages (never coerced)', () => {
    const base = { ...emptyProductForm('Product', 'c1'), sku: 'NEG-1', name: 'x' };
    const r = generalStepSchema.safeParse({ ...base, salesPrice: -5, purchasePrice: -1, taxRate: 150 });
    expect(r.success).toBe(false);
    const byPath = Object.fromEntries(
      (r.success ? [] : r.error.issues).map((i) => [i.path.join('.'), i.message]),
    );
    expect(byPath.salesPrice).toBe('Must be 0 or more');
    expect(byPath.purchasePrice).toBe('Must be 0 or more');
    expect(byPath.taxRate).toBe('Tax rate must be 0 to 100%');
    expect(generalStepSchema.safeParse({ ...base, salesPrice: 12.5, taxRate: 8 }).success).toBe(true);
  });

  it('rejects spaces in SKU', () => {
    const r = generalStepSchema.safeParse({ ...emptyProductForm('Product', 'c1'), sku: 'A B', name: 'x' });
    expect(r.success).toBe(false);
  });

  it('requires exactly one primary pack type for products', () => {
    expect(packTypesStepSchema.safeParse({ productCategory: 'Product', packTypes: [] }).success).toBe(false);
    expect(
      packTypesStepSchema.safeParse({ productCategory: 'Product', packTypes: [pack('Unit', 'Primary')] })
        .success,
    ).toBe(true);
    expect(packTypesStepSchema.safeParse({ productCategory: 'Kit', packTypes: [] }).success).toBe(true);
  });

  it('flags a barcode on two pack types', () => {
    const r = packTypesStepSchema.safeParse({
      productCategory: 'Product',
      packTypes: [
        pack('Unit', 'Primary', { barcodes: ['X1'] }),
        pack('Case', 'Hierarchical', { barcodes: ['X1'] }),
      ],
    });
    expect(r.success).toBe(false);
  });

  it('blocks a kit with zero components (beyond Logiwa)', () => {
    const r = componentsStepSchema.safeParse({ productCategory: 'Kit', components: [] });
    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('Add at least one component to the kit');
  });

  it('requires a format when expiry tracking is on, and a hazmat type when hazardous', () => {
    const base = emptyProductForm('Product', 'c1');
    expect(advancedStepSchema.safeParse({ ...base, trackExpiry: true, expiryFormat: null }).success).toBe(
      false,
    );
    expect(
      advancedStepSchema.safeParse({ ...base, trackExpiry: true, expiryFormat: 'yyyy-MM-dd' }).success,
    ).toBe(true);
    expect(advancedStepSchema.safeParse({ ...base, isHazmat: true }).success).toBe(false);
  });

  it('validates the whole payload', () => {
    const ok = productInputSchema.safeParse({
      ...emptyProductForm('Product', 'c1'),
      sku: 'SKU-1',
      name: 'One',
      packTypes: [pack('Unit', 'Primary')],
    });
    expect(ok.success).toBe(true);
  });

  it('drops the Liquid flag for packaging material', () => {
    expect(packingFlagsFor('Packaging Material').some((f) => f.key === 'isLiquid')).toBe(false);
    expect(packingFlagsFor('Product')).toHaveLength(8);
  });
});

describe('customs origin country', () => {
  it('maps legacy country names to ISO codes so old records stay editable', () => {
    expect(normalizeCountryCode('Vietnam')).toBe('VN');
    expect(normalizeCountryCode('United States')).toBe('US');
    expect(normalizeCountryCode('China')).toBe('CN');
    expect(normalizeCountryCode('colombia')).toBe('CO');
    expect(normalizeCountryCode('us')).toBe('US');
    expect(normalizeCountryCode('')).toBe('');
    expect(normalizeCountryCode(null)).toBe('');
  });

  it('accepts a legacy name in the advanced step and rejects free text', () => {
    const base = emptyProductForm('Product', 'c1');
    const ok = advancedStepSchema.safeParse({
      ...base,
      customs: { ...base.customs, originCountry: 'Vietnam' },
    });
    expect(ok.success).toBe(true);
    const bad = advancedStepSchema.safeParse({
      ...base,
      customs: { ...base.customs, originCountry: 'Atlantis' },
    });
    expect(bad.success).toBe(false);
  });
});
