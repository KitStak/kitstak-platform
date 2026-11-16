/**
 * M10 route-level smoke tests (critic R2 blocker: bulk-delete / bulk-lock / labels returned a bare
 * 500 because an import chain left `customFieldSql` undefined). Every facility route module is
 * imported through the real `defineRoute` pipeline, so a broken import chain fails CI instead of
 * failing silently in the UI. Also pins the role matrix: whoever can view a record can view its
 * change log, and viewers / operators can read but not write.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { SHIPMENT_PACKAGE_DEFAULTS } from '@/lib/grid-defs/facility/shipment-packages';
import { locationRow } from '../foundation/domain/fixtures';
import {
  call,
  closeWorld,
  cookieFor,
  current,
  openWorld,
  removeFilesRoot,
  req,
} from '../foundation-f7/harness';

vi.mock('@/server/api/db', () => {
  const get = async () => current().db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

type Handler = Parameters<typeof call>[0];
type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Handler>>;

const modules = import.meta.glob<RouteModule>([
  '/src/app/api/locations/**/route.ts',
  '/src/app/api/warehouses/**/route.ts',
  '/src/app/api/lp-types/**/route.ts',
  '/src/app/api/lp-numbers/**/route.ts',
  '/src/app/api/mobile-carts/**/route.ts',
  '/src/app/api/shipment-packages/**/route.ts',
]);

const route = async (path: string): Promise<RouteModule> => {
  const loader = modules[`/src/app/api/${path}/route.ts`];
  if (!loader) throw new Error(`No route module for ${path}`);
  return loader();
};

beforeEach(async () => {
  await openWorld();
});
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

describe('M10 route modules', () => {
  it('every facility route module loads and exports only handler functions', async () => {
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThanOrEqual(38);
    for (const p of paths) {
      const mod = await modules[p]!();
      const handlers = (['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const).filter((m) => m in mod);
      expect(handlers.length, p).toBeGreaterThan(0);
      for (const m of handlers) expect(typeof mod[m], `${p} ${m}`).toBe('function');
    }
  });

  it('bulk-delete, bulk-lock and labels validate (400) instead of failing (500)', async () => {
    const w = current();
    const cookie = await cookieFor(w.userId);
    for (const p of [
      'locations/bulk-delete',
      'locations/bulk-lock',
      'locations/labels',
      'lp-types/bulk-delete',
      'mobile-carts/bulk-delete',
      'mobile-carts/labels',
      'shipment-packages/bulk-delete',
      'lp-numbers/labels',
      'warehouses/bulk-active',
    ]) {
      const mod = await route(p);
      const res = await call(mod.POST!, req('POST', `/api/${p}`, { cookie, body: {} }));
      expect(res.status, p).toBe(400);
      expect(res.json.code, p).toBe('VALIDATION');
    }
  });

  it('labels and lock work on real locations; delete is guarded per row', async () => {
    const w = current();
    const cookie = await cookieFor(w.userId);
    const labels = await call(
      (await route('locations/labels')).POST!,
      req('POST', '/api/locations/labels', { cookie, body: { ids: [w.loc.pack, w.loc.ship] } }),
    );
    expect(labels.status).toBe(200);
    expect((labels.data as { code: string }[]).map((r) => r.code).sort()).toEqual(
      ['PACK-01', 'SHIP-01'].sort(),
    );

    const lock = await call(
      (await route('locations/bulk-lock')).POST!,
      req('POST', '/api/locations/bulk-lock', { cookie, body: { ids: [w.loc.pack], locked: true } }),
    );
    expect(lock.status).toBe(200);

    const free = (
      await w.db.insert(schema.locations).values(locationRow(w.warehouseId, 'KS-SMOKE-01')).returning()
    )[0];
    const del = await call(
      (await route('locations/bulk-delete')).POST!,
      req('POST', '/api/locations/bulk-delete', { cookie, body: { ids: [free.id] } }),
    );
    expect(del.status).toBe(200);
  });

  it('list endpoints answer 200 for admin, operator and viewer', async () => {
    const w = current();
    for (const userId of [w.userId, w.operatorId, w.viewerId]) {
      const cookie = await cookieFor(userId);
      for (const p of [
        'locations',
        'warehouses',
        'lp-types',
        'lp-numbers',
        'mobile-carts',
        'shipment-packages',
        'locations/zones',
      ]) {
        const res = await call((await route(p)).GET!, req('GET', `/api/${p}`, { cookie }));
        expect(
          res.status,
          `${p} as ${userId === w.viewerId ? 'viewer' : userId === w.operatorId ? 'operator' : 'admin'}`,
        ).toBe(200);
      }
    }
  });

  it('role matrix: viewers read records and their change logs, but cannot write', async () => {
    const w = current();
    const viewer = await cookieFor(w.viewerId);
    const detail = await call(
      (await route('locations/[id]')).GET!,
      req('GET', `/api/locations/${w.loc.pack}`, { cookie: viewer }),
      { id: w.loc.pack },
    );
    const log = await call(
      (await route('locations/[id]/change-log')).GET!,
      req('GET', `/api/locations/${w.loc.pack}/change-log`, { cookie: viewer }),
      { id: w.loc.pack },
    );
    expect(detail.status).toBe(200);
    expect(log.status).toBe(200);

    const whLog = await call(
      (await route('warehouses/[id]/change-log')).GET!,
      req('GET', `/api/warehouses/${w.warehouseId}/change-log`, { cookie: viewer }),
      { id: w.warehouseId },
    );
    expect(whLog.status).toBe(200);

    const create = await call(
      (await route('locations')).POST!,
      req('POST', '/api/locations', { cookie: viewer, body: {} }),
    );
    expect(create.status).toBe(403);
    const bulk = await call(
      (await route('locations/bulk-delete')).POST!,
      req('POST', '/api/locations/bulk-delete', { cookie: viewer, body: { ids: [w.loc.pack] } }),
    );
    expect(bulk.status).toBe(403);
  });

  it("change log is scoped: a location in a warehouse the viewer can't see is not found", async () => {
    const w = current();
    const other = (
      await w.db.insert(schema.locations).values(locationRow(w.otherWarehouseId, 'RNO-01')).returning()
    )[0];
    const res = await call(
      (await route('locations/[id]/change-log')).GET!,
      req('GET', `/api/locations/${other.id}/change-log`, { cookie: await cookieFor(w.viewerId) }),
      { id: other.id },
    );
    expect([403, 404]).toContain(res.status);
  });

  it("shipment package 'Auto-create new SKU' creates and links a Packaging Material SKU, then matches it", async () => {
    const w = current();
    const cookie = await cookieFor(w.userId);
    const mod = await route('shipment-packages');
    const body = {
      ...SHIPMENT_PACKAGE_DEFAULTS,
      warehouseId: w.warehouseId,
      code: 'box-auto-1',
      description: 'Auto box',
      length: 10,
      width: 8,
      height: 4,
      trackInventory: true,
      trackingMethod: 'auto',
      inventoryClientId: w.clientId,
      inventoryProductId: null,
      reductionRule: 'Any Location',
    };
    const res = await call(mod.POST!, req('POST', '/api/shipment-packages', { cookie, body }));
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const pkg = (
      await w.db
        .select()
        .from(schema.shipmentPackages)
        .where(eq(schema.shipmentPackages.code, 'BOX-AUTO-1'))
        .limit(1)
    )[0]!;
    const product = (
      await w.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, pkg.inventoryProductId!))
        .limit(1)
    )[0]!;
    expect(product).toMatchObject({
      sku: 'BOX-AUTO-1',
      clientId: w.clientId,
      productCategory: 'Packaging Material',
      lengthIn: 10,
    });
    // A second package with the same code in another warehouse matches the existing SKU instead of duplicating it.
    const again = await call(
      mod.POST!,
      req('POST', '/api/shipment-packages', { cookie, body: { ...body, warehouseId: w.otherWarehouseId } }),
    );
    expect(again.status).toBe(201);
    expect(
      await w.db.select().from(schema.products).where(eq(schema.products.sku, 'BOX-AUTO-1')),
    ).toHaveLength(1);
    // "Match" still requires a SKU.
    const match = await call(
      mod.POST!,
      req('POST', '/api/shipment-packages', {
        cookie,
        body: { ...body, code: 'BOX-M', trackingMethod: 'match' },
      }),
    );
    expect(match.status).toBe(400);
  });

  it('custom LP number availability flags a number taken by another LP type in the warehouse', async () => {
    const w = current();
    const t = (
      await w.db
        .insert(schema.lpTypes)
        .values({ warehouseId: w.warehouseId, code: 'SMK', numberPrefix: 'SMK-', numberLength: 5 })
        .returning()
    )[0];
    await w.db
      .insert(schema.licensePlates)
      .values({ warehouseId: w.warehouseId, lpTypeId: t.id, number: 'KSC-00001' });
    const mod = await route('lp-numbers/availability');
    const cookie = await cookieFor(w.userId);
    const taken = await call(
      mod.GET!,
      req('GET', `/api/lp-numbers/availability?warehouseId=${w.warehouseId}&code=ksc-00001`, { cookie }),
    );
    expect(taken.status).toBe(200);
    expect((taken.data as { taken: Record<string, string> }).taken.number).toBe(
      'LP number KSC-00001 already exists in this warehouse',
    );
    const free = await call(
      mod.GET!,
      req('GET', `/api/lp-numbers/availability?warehouseId=${w.warehouseId}&code=KSC-99999`, { cookie }),
    );
    expect((free.data as { taken: Record<string, string> }).taken).toEqual({});
  });
});
