/** M09 catalog, critic round 5 → round 6: kit buildability, own-dims notices, demo images, overflow edges. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { buildableFromComponent, kitBuildability } from '@/lib/grid-defs/products/kit-buildability';
import { ownDimsGaps } from '@/lib/grid-defs/products/pack-derivation';
import {
  DEMO_IMAGE_KINDS,
  demoImageColour,
  demoImageKind,
  demoImageUrl,
  isDemoImageUrl,
  parseDemoImageKey,
  renderDemoImage,
  shade,
} from '@/lib/grid-defs/products/demo-images';
import {
  emptyProductForm,
  imageUrlError,
  newPackType,
  productInputSchema,
  type ProductInput,
} from '@/lib/grid-defs/products/product-form';
import { overflowEdges } from '@/components/products/overflow-fade';
import { createProductFromWizard } from '@/server/repositories/products-commands';
import { applyDemoImages, planDemoImages } from '@/server/repositories/products-demo-images';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('kitBuildability', () => {
  const comps = [
    { id: 'a', sku: 'APX-TEE-BLK-M', quantity: 1, available: 396 },
    { id: 'b', sku: 'APX-TEE-WHT-M', quantity: 1, available: 543 },
    { id: 'c', sku: 'APX-TEE-NVY-M', quantity: 2, available: 900 },
  ];
  it('is the minimum per-component figure and names the limiting component', () => {
    const r = kitBuildability(comps);
    expect(r.buildable).toBe(396);
    expect(r.limiting.map((c) => c.sku)).toEqual(['APX-TEE-BLK-M']);
    expect(r.shortForNext).toBe(1);
  });
  it('accounts for quantity per kit and the units short for one more kit', () => {
    const r = kitBuildability([
      { id: 'x', sku: 'X', quantity: 3, available: 10 },
      { id: 'y', sku: 'Y', quantity: 1, available: 50 },
    ]);
    expect(r.buildable).toBe(3);
    expect(r.limiting.map((c) => c.sku)).toEqual(['X']);
    expect(r.shortForNext).toBe(2); // 4 kits need 12, 10 on hand
  });
  it('reports ties, zero and empty kits', () => {
    expect(
      kitBuildability([
        { id: 'x', sku: 'X', quantity: 1, available: 5 },
        { id: 'y', sku: 'Y', quantity: 1, available: 5 },
      ]).limiting,
    ).toHaveLength(2);
    expect(kitBuildability([{ id: 'x', sku: 'X', quantity: 1, available: -4 }]).buildable).toBe(0);
    expect(kitBuildability([])).toEqual({ buildable: 0, limiting: [], shortForNext: 0 });
    expect(buildableFromComponent({ quantity: 0, available: 7 })).toBe(7);
  });
});

describe('ownDimsGaps (packaging / kit Packing step)', () => {
  it('warns packaging materials about missing dims and weight', () => {
    const gaps = ownDimsGaps('Packaging Material', {
      length: 0,
      width: 0,
      height: 0,
      weight: 0,
      weightUnit: 'Pound',
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatch(/box matching/);
    expect(gaps[1]).toMatch(/0 pounds/);
  });
  it('is silent when complete, and for products (dims live on pack types)', () => {
    expect(
      ownDimsGaps('Packaging Material', {
        length: 10,
        width: 8,
        height: 2,
        weight: 0.5,
        weightUnit: 'Pound',
      }),
    ).toEqual([]);
    expect(
      ownDimsGaps('Product', { length: 0, width: 0, height: 0, weight: 0, weightUnit: 'Pound' }),
    ).toEqual([]);
    expect(ownDimsGaps('Kit', { length: 1, width: 1, height: 0, weight: 1, weightUnit: 'Ounce' })[0]).toMatch(
      /this kit/,
    );
  });
});

describe('demo product images', () => {
  it('maps seed SKUs to a kind and colourway', () => {
    expect(demoImageKind('APX-TEE-BLK-M')).toBe('tee');
    expect(demoImageKind('VLT-PKG-BOX-12106')).toBe('box');
    expect(demoImageKind('APX-PKG-POLY-1013')).toBe('mailer');
    expect(demoImageKind('NOVA-KIT-ROAD')).toBe('kit');
    expect(demoImageKind('CPL-BAG-ESP-12')).toBe('coffee-bag');
    expect(demoImageKind('ZZZ-1', 'Apparel')).toBe('tee');
    expect(demoImageKind('ZZZ-1')).toBe('widget');
    expect(demoImageColour('APX-TEE-WHT-M')).toBe('e5e7eb');
    expect(demoImageColour('VLT-MSE-WRLS')).toBe('0f766e');
    expect(demoImageUrl('APX-TEE-NVY-L')).toBe('/api/products/demo-image/tee-1e3a5f.svg');
  });
  it('parses only known kinds with a 6-digit hex', () => {
    expect(parseDemoImageKey('phone-case-7c3aed.svg')).toEqual({ kind: 'phone-case', hex: '7c3aed' });
    expect(parseDemoImageKey('box-abcdef.svg')).toEqual({ kind: 'box', hex: 'abcdef' });
    expect(parseDemoImageKey('evil-1f2937.svg')).toBeNull();
    expect(parseDemoImageKey('tee-1f293.svg')).toBeNull();
    expect(parseDemoImageKey('tee-1f2937.svg?x=<script>')).toBeNull();
    expect(isDemoImageUrl('/api/products/demo-image/tee-1f2937.svg')).toBe(true);
    expect(isDemoImageUrl('/api/products/demo-image/../users')).toBe(false);
    expect(isDemoImageUrl('//evil.example/tee-1f2937.svg')).toBe(false);
  });
  it('renders a static SVG for every kind and refuses a bad colour', () => {
    for (const kind of DEMO_IMAGE_KINDS) {
      const svg = renderDemoImage(kind, '1f2937');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    }
    expect(() => renderDemoImage('tee', 'zz"/>')).toThrow();
    expect(shade('ffffff', -1)).toBe('000000');
  });
  it('is accepted by the product image-URL rule (wizard and API)', () => {
    expect(imageUrlError('/api/products/demo-image/tee-1f2937.svg')).toBeNull();
    expect(imageUrlError('/api/users')).not.toBeNull();
    expect(imageUrlError('https://cdn.example.com/a.jpg')).toBeNull();
  });
});

describe('applyDemoImages', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());
  const ctx = () => ({ ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: 'all' as const } });
  const make = async (sku: string, imageUrl = '') =>
    await createProductFromWizard(w.db, ctx(), {
      ...emptyProductForm('Product', w.clientId),
      sku,
      name: sku,
      imageUrl,
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
    } as unknown as ProductInput);

  it('fills only image-less, non-test products, bumps version and writes the change log', async () => {
    const tee = await make('APX-TEE-BLK-M');
    const withImg = await make('APX-TEE-WHT-M', 'https://cdn.example.com/w.jpg');
    const test = await make('KS-E2E-TEE');
    expect((await planDemoImages(w.db)).map((r) => r.sku)).toContain('APX-TEE-BLK-M');
    const applied = await applyDemoImages(w.db, w.ctx);
    const skus = applied.map((r) => r.sku);
    expect(skus).toContain('APX-TEE-BLK-M');
    expect(skus).not.toContain('APX-TEE-WHT-M');
    expect(skus).not.toContain('KS-E2E-TEE');
    const row = (await w.db.select().from(schema.products).where(eq(schema.products.id, tee.id)).limit(1))[0];
    expect(row?.imageUrl).toBe('/api/products/demo-image/tee-1f2937.svg');
    expect(row?.version).toBe((tee.version ?? 1) + 1);
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, withImg.id)).limit(1))[0]
        ?.imageUrl,
    ).toBe('https://cdn.example.com/w.jpg');
    expect(
      (await w.db.select().from(schema.products).where(eq(schema.products.id, test.id)).limit(1))[0]
        ?.imageUrl ?? null,
    ).toBeNull();
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, tee.id));
    expect(log.some((l) => JSON.stringify(l).includes('demo-image'))).toBe(true);
    // Idempotent
    expect((await applyDemoImages(w.db, w.ctx)).map((r) => r.sku)).not.toContain('APX-TEE-BLK-M');
    // A demo URL round-trips through the product schema (editing a seeded product saves).
    const parsed = productInputSchema.safeParse({
      ...emptyProductForm('Product', w.clientId),
      sku: 'X1',
      name: 'X1',
      imageUrl: row?.imageUrl,
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
    });
    expect(
      parsed.success ? null : parsed.error.issues.filter((i) => String(i.path[0]) === 'imageUrl'),
    ).toBeNull();
  });
});

describe('overflowEdges', () => {
  it('reports hidden content on each edge with 1px slack', () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 500, clientWidth: 500 })).toEqual({
      start: false,
      end: false,
    });
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 986, clientWidth: 762 })).toEqual({
      start: false,
      end: true,
    });
    expect(overflowEdges({ scrollLeft: 224, scrollWidth: 986, clientWidth: 762 })).toEqual({
      start: true,
      end: false,
    });
    expect(overflowEdges({ scrollLeft: 100, scrollWidth: 986, clientWidth: 762 })).toEqual({
      start: true,
      end: true,
    });
  });
});
