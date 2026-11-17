// Shopify pushShipment: the runtime passes the store order number ("#1001") for normally downloaded
// orders, so the adapter must resolve Shopify's numeric order id before asking for fulfillment orders.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopifyAdapter } from '@/server/integrations/shopify';
import type { AdapterContext } from '@/server/integrations/channel-adapter';
import { channelSettingsSchema } from '@/lib/domain-types';

afterEach(() => vi.unstubAllGlobals());

const ctx: AdapterContext = {
  connection: {
    id: 'conn-shopify',
    provider: 'shopify',
    storeName: 'test-store',
    distribution: 'Custom App',
  } as AdapterContext['connection'],
  credentials: { accessToken: 't' },
  settings: channelSettingsSchema.parse({}),
  runNumber: 1,
  now: new Date(),
};

const shipment = (channelOrderId: string) => ({
  channelOrderId,
  storeOrderNumber: '#1001',
  trackingNumber: '1ZTEST',
  carrier: 'UPS',
  lines: [{ sku: 'KS-TEST-A', quantity: 1 }],
});

function mockShopify(ordersByName: Record<string, unknown>[]) {
  const calls: { path: string; search: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/admin\/api\/[^/]+\//, '');
      calls.push({ path, search: url.search, method: init.method ?? 'GET' });
      const body =
        path === 'orders.json'
          ? { orders: ordersByName }
          : path === 'orders/7856587735329/fulfillment_orders.json'
            ? { fulfillment_orders: [{ id: 55, status: 'open' }] }
            : path === 'fulfillments.json'
              ? { fulfillment: { id: 1 } }
              : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('Shopify pushShipment order id resolution', () => {
  it('uses a numeric channel order id directly without a lookup', async () => {
    const calls = mockShopify([]);

    const res = await shopifyAdapter.pushShipment(ctx, shipment('7856587735329'));

    expect(res).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual([
      'orders/7856587735329/fulfillment_orders.json',
      'fulfillments.json',
    ]);
  });

  it('accepts a GID-style order id without a lookup', async () => {
    const calls = mockShopify([]);

    const res = await shopifyAdapter.pushShipment(ctx, shipment('gid://shopify/Order/7856587735329'));

    expect(res).toEqual({ ok: true });
    expect(calls[0]?.path).toBe('orders/7856587735329/fulfillment_orders.json');
  });

  it('looks up an all-digit order name from a store with no order prefix', async () => {
    const calls = mockShopify([{ id: 7856587735329, name: '1001' }]);

    const res = await shopifyAdapter.pushShipment(ctx, shipment('1001'));

    expect(res).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual([
      'orders.json',
      'orders/7856587735329/fulfillment_orders.json',
      'fulfillments.json',
    ]);
  });

  it('resolves the numeric id from the store order number before fulfilling', async () => {
    const calls = mockShopify([
      { id: 111, name: '#10010' },
      { id: 7856587735329, name: '#1001' },
    ]);

    const res = await shopifyAdapter.pushShipment(ctx, shipment('#1001'));

    expect(res).toEqual({ ok: true });
    expect(calls[0]?.path).toBe('orders.json');
    expect(new URLSearchParams(calls[0]?.search).get('name')).toBe('#1001');
    expect(new URLSearchParams(calls[0]?.search).get('status')).toBe('any');
    expect(calls[1]?.path).toBe('orders/7856587735329/fulfillment_orders.json');
    expect(calls[2]).toMatchObject({ path: 'fulfillments.json', method: 'POST' });
  });

  it('reports a clear error when the store has no order with that number', async () => {
    const calls = mockShopify([]);

    const res = await shopifyAdapter.pushShipment(ctx, shipment('#1001'));

    expect(res).toEqual({ ok: false, error: 'Order #1001 was not found on the store' });
    expect(calls.map((c) => c.path)).toEqual(['orders.json']);
  });
});
