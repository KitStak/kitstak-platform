import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/server/db/schema';
import { createOrder } from '@/server/domain/orders';
import { locationRow, orderInput } from '../foundation/domain/fixtures';
import {
  asArray,
  call,
  closeWorld,
  cookieFor,
  current,
  expectCsrf,
  openWorld,
  removeFilesRoot,
  req,
} from './harness';
import { mapSeq } from '@/server/db/sql';

vi.mock('@/server/api/db', () => {
  const get = async () => current().db;
  return { getAppDb: get, getPlatformDb: get, getTenantDbFor: get };
});

const KEYS = [
  'locations',
  'lps',
  'users',
  'products',
  'customers',
  'vendors',
  'orders',
  'jobs',
  'carrier-services',
  'shipment-packages',
] as const;
const pickers = Object.fromEntries(
  await Promise.all(
    await mapSeq(
      KEYS,
      async (k) =>
        [k, (await import(`@/app/api/pickers/${k}/route`)) as { GET: Parameters<typeof call>[0] }] as const,
    ),
  ),
);
const meRoute = await import('@/app/api/me/route');

beforeEach(async () => {
  await openWorld();
});
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

async function pick(
  key: (typeof KEYS)[number],
  query: string,
  userId = current().viewerId,
): Promise<Awaited<ReturnType<typeof call>>> {
  return call(
    pickers[key].GET,
    req('GET', `/api/pickers/${key}?${query}`, { cookie: await cookieFor(userId) }),
  );
}

const labels = (res: Awaited<ReturnType<typeof call>>): unknown[] => asArray(res.data).map((o) => o.label);

describe('/api/pickers/*', () => {
  it('every picker answers 200 for a signed-in viewer and 401 without a session', async () => {
    for (const key of KEYS) {
      expect((await pick(key, '')).status, key).toBe(200);
      expect((await call(pickers[key].GET, req('GET', `/api/pickers/${key}`))).status, key).toBe(401);
    }
  });

  it('locations are warehouse-scoped, searchable and filterable', async () => {
    const w = current();
    await w.db.insert(schema.locations).values(locationRow(w.otherWarehouseId, 'A-01-01-RENO'));
    const viewerAll = labels(await pick('locations', 'q=a-0'));
    expect(viewerAll).toContain('A-01-01');
    expect(viewerAll).not.toContain('A-01-01-RENO');
    expect(labels(await pick('locations', 'q=a-0', w.userId))).toContain('A-01-01-RENO');
    expect(labels(await pick('locations', 'q=RCV&mode=sw'))).toEqual(['RCV-01']);
    expect(labels(await pick('locations', 'areaType=Returns'))).toEqual(['RET-01']);
    expect(labels(await pick('locations', `ids=${w.loc.pack}`))).toEqual(['PACK-01']);
    expect((await pick('locations', `warehouseId=${w.otherWarehouseId}`)).status).toBe(400);
    expect((await pick('locations', 'limit=500')).status).toBe(400);
  });

  it('products, orders and customers are client-scoped', async () => {
    const w = current();
    const betaProduct = (
      await w.db
        .insert(schema.products)
        .values({
          clientId: w.otherClientId,
          sku: 'BETA-SKU',
          barcode: 'BETA-SKU',
          name: 'Beta',
          category: 'General',
          weightOz: 1,
          lengthIn: 1,
          widthIn: 1,
          heightIn: 1,
          price: 1,
          status: 'Active',
        })
        .returning()
    )[0].id;
    expect(labels(await pick('products', 'q=sku'))).toEqual([]);
    expect(labels(await pick('products', 'q=widget'))).toEqual(['MLT-WIDGET-01']);
    expect(labels(await pick('products', 'q=beta', w.userId))).toEqual(['BETA-SKU']);

    const mine = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await createOrder(
      w.db,
      w.ctx,
      orderInput(w, [{ productId: betaProduct, quantity: 1 }], { clientId: w.otherClientId }),
    );
    expect(labels(await pick('orders', ''))).toEqual([mine.code]);
    expect(labels(await pick('orders', 'status=Open'))).toEqual([mine.code]);
    expect(labels(await pick('orders', 'status=Shipped'))).toEqual([]);
    expect((await pick('orders', 'status=Bogus')).status).toBe(400);

    await w.db.insert(schema.customers).values([
      { clientId: w.clientId, firstName: 'Ann', lastName: 'Lee', email: 'ann@x.io', phone: '1' },
      { clientId: w.otherClientId, firstName: 'Bob', lastName: 'Ray', email: 'bob@x.io', phone: '2' },
    ]);
    expect(labels(await pick('customers', ''))).toEqual(['Ann Lee']);
  });

  it("users filter by warehouse; carrier services follow their connection's warehouse", async () => {
    const w = current();
    const inWh = labels(await pick('users', `warehouseId=${w.warehouseId}`));
    expect(inWh).toEqual(expect.arrayContaining(['Admin', 'Operator', 'Viewer']));
    expect(labels(await pick('carrier-services', 'q=ground'))).toEqual(['Ground']);
    expect(labels(await pick('carrier-services', `connectionId=${w.carrierConnectionId}`))).toHaveLength(3);
  });
});

describe('/api/me', () => {
  it("GET returns the viewer's permissions; PATCH needs CSRF and narrows context", async () => {
    const w = current();
    const res = await call(meRoute.GET, req('GET', '/api/me', { cookie: await cookieFor(w.viewerId) }));
    expect(res.status).toBe(200);
    const perms = (res.data as { permissions: string[] }).permissions;
    expect(perms).toContain('fulfillment.shipment_orders.view');
    expect(perms).not.toContain('settings.users.view');
    await expectCsrf(meRoute.PATCH, 'PATCH', '/api/me', {
      context: { warehouseId: w.warehouseId, clientId: null },
    });
  });
});
