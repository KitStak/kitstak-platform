/** Round 4 parity loop (M12): live TikTok Shop / Magento / BigCommerce / Etsy adapters and the Shopify Public App OAuth checks. */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bigcommerceAdapter,
  bigcommerceProducts,
  bigcommerceToOrder,
} from '@/server/integrations/bigcommerce';
import { etsyAdapter, etsyMoney, etsyProducts, etsyToOrder } from '@/server/integrations/etsy';
import {
  magentoAdapter,
  magentoBaseUrl,
  magentoToOrder,
  searchCriteria,
} from '@/server/integrations/magento';
import { tiktokAdapter, tiktokSign, tiktokToOrder } from '@/server/integrations/tiktok';
import {
  authorizeUrl,
  normalizeShopDomain,
  shopifyPublicAppConfig,
  signState,
  verifyShopifyHmac,
  verifyState,
} from '@/server/integrations/shopify-oauth';
import { LIVE_PROVIDERS, pauseReason } from '@/server/integrations/runtime/channel-runtime';
import { connectStoreSchema } from '@/lib/grid-defs/integrations/channels';
import type { AdapterContext } from '@/server/integrations/channel-adapter';
import { channelSettingsSchema } from '@/lib/domain-types';

afterEach(() => vi.unstubAllGlobals());

const ctxOf = (
  provider: string,
  credentials: Record<string, string>,
  storeName = 'shop.example.com',
): AdapterContext => ({
  connection: {
    id: `conn-${provider}`,
    provider,
    storeName,
    distribution: 'Custom App',
  } as AdapterContext['connection'],
  credentials,
  settings: channelSettingsSchema.parse({}),
  runNumber: 1,
  now: new Date(),
});

function mockFetch(handler: (url: URL, init: RequestInit) => unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return new Response(JSON.stringify(handler(url, init) ?? null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('live channel adapters are registered', () => {
  it('TikTok Shop, Magento, BigCommerce and Etsy are live; a credential-less store runs on the demo feed (R6)', () => {
    for (const p of ['tiktok', 'magento', 'bigcommerce', 'etsy']) {
      expect(LIVE_PROVIDERS.has(p)).toBe(true);
      expect(
        pauseReason({ provider: p, distribution: 'Custom App', credentialsEnc: null, isActive: true }),
      ).toBeNull();
    }
  });
  it('accepts the extra credential fields each profile asks for', () => {
    const bad = connectStoreSchema.safeParse({
      provider: 'bigcommerce',
      distribution: 'Custom App',
      storeName: 'BC',
      clientId: 'c1',
      authMethod: 'Access Token',
      accessToken: 't',
    });
    expect(bad.success).toBe(false);
    expect(
      connectStoreSchema.safeParse({
        provider: 'bigcommerce',
        distribution: 'Custom App',
        storeName: 'BC',
        clientId: 'c1',
        authMethod: 'Access Token',
        accessToken: 't',
        storeHash: 'abc123',
      }).success,
    ).toBe(true);
    expect(
      connectStoreSchema.safeParse({
        provider: 'etsy',
        distribution: 'Custom App',
        storeName: 'E',
        clientId: 'c1',
        authMethod: 'Access Token',
        accessToken: 't',
        apiKey: 'k',
        shopId: '12x',
      }).success,
    ).toBe(false);
    expect(
      connectStoreSchema.safeParse({
        provider: 'tiktok',
        distribution: 'Custom App',
        storeName: 'T',
        clientId: 'c1',
        authMethod: 'Client ID & Secret',
        apiClientId: 'a',
        apiClientSecret: 's',
        userAccessToken: 'u',
      }).success,
    ).toBe(true);
  });
});

describe('TikTok Shop', () => {
  it('signs requests the documented way (secret + path + sorted params + body + secret)', () => {
    const sig = tiktokSign(
      'sec',
      '/order/202309/orders/search',
      { timestamp: '1700000000', app_key: 'ak', shop_cipher: 'c', access_token: 'x', sign: 'y' },
      '{"a":1}',
    );
    const expected = createHmac('sha256', 'sec')
      .update(
        'sec/order/202309/orders/searchapp_keyakshop_ciphercTimestamp'.replace(
          'Timestamp',
          'timestamp1700000000',
        ) + '{"a":1}sec',
      )
      .digest('hex');
    expect(sig).toBe(expected);
  });
  it('groups per-unit line items into SKU quantities and maps the address', () => {
    const o = tiktokToOrder({
      id: '576',
      create_time: 1700000000,
      status: 'AWAITING_SHIPMENT',
      payment: { total_amount: '39.98' },
      recipient_address: {
        name: 'Ada L',
        address_line1: '1 Main',
        postal_code: '38118',
        region_code: 'US',
        district_info: [
          { address_level_name: 'State', address_name: 'TN' },
          { address_level_name: 'City', address_name: 'Memphis' },
        ],
      },
      line_items: [
        { sku_id: 's1', seller_sku: 'SKU-1', product_name: 'Tee', sale_price: '19.99' },
        { sku_id: 's1', seller_sku: 'SKU-1', product_name: 'Tee', sale_price: '19.99' },
      ],
    });
    expect(o.lines).toEqual([expect.objectContaining({ sku: 'SKU-1', quantity: 2, price: 19.99 })]);
    expect(o.shipTo).toMatchObject({ city: 'Memphis', state: 'TN', country: 'United States' });
    expect(o.financialStatus).toBe('paid');
  });
  it('downloads AWAITING_SHIPMENT orders with a signed call and the access-token header', async () => {
    const calls = mockFetch((url) =>
      url.pathname.includes('/authorization/')
        ? { code: 0, data: { shops: [{ cipher: 'CIPH', name: 'Shop' }] } }
        : { code: 0, data: { orders: [{ id: '1', line_items: [{ seller_sku: 'A', sale_price: '1' }] }] } },
    );
    const orders = await tiktokAdapter.fetchOrders(
      ctxOf('tiktok', { clientId: 'ak', clientSecret: 'sec', userAccessToken: 'tok' }),
      null,
    );
    expect(orders).toHaveLength(1);
    const search = calls.find((c) => c.url.pathname === '/order/202309/orders/search');
    expect(search?.url.searchParams.get('shop_cipher')).toBe('CIPH');
    expect(search?.url.searchParams.get('sign')).toMatch(/^[0-9a-f]{64}$/);
    expect((search?.init.headers as Record<string, string>)['x-tts-access-token']).toBe('tok');
    expect(JSON.parse(String(search?.init.body))).toMatchObject({ order_status: 'AWAITING_SHIPMENT' });
  });
});

describe('Magento 2', () => {
  it('builds the REST base and searchCriteria', () => {
    expect(magentoBaseUrl('http://shop.example.com/')).toBe('https://shop.example.com/rest/V1');
    expect(
      decodeURIComponent(searchCriteria([{ field: 'status', value: 'processing', condition: 'eq' }], 2)),
    ).toContain('searchCriteria[filter_groups][0][filters][0][field]=status');
  });
  it('maps an order from its shipping assignment and skips child items', () => {
    const o = magentoToOrder({
      entity_id: 7,
      increment_id: '000000007',
      created_at: '2026-11-10 13:05:08',
      total_paid: 20,
      grand_total: 20,
      customer_email: 'a@b.c',
      items: [
        {
          item_id: 1,
          sku: 'TEE-M',
          name: 'Tee',
          qty_ordered: 2,
          price: 10,
          product_type: 'configurable',
          product_id: 9,
        },
        { item_id: 2, parent_item_id: 1, sku: 'TEE-M', qty_ordered: 2 },
      ],
      extension_attributes: {
        shipping_assignments: [
          {
            shipping: {
              address: {
                firstname: 'Ada',
                lastname: 'L',
                street: ['1 Main', 'Apt 2'],
                city: 'Memphis',
                region_code: 'TN',
                postcode: '38118',
                country_id: 'US',
              },
            },
          },
        ],
      },
    });
    expect(o).toMatchObject({
      id: '7',
      number: '#000000007',
      createdAt: '2026-11-10T13:05:08.000Z',
      financialStatus: 'paid',
    });
    expect(o.lines).toHaveLength(1);
    expect(o.shipTo).toMatchObject({ line2: 'Apt 2', state: 'TN' });
  });
  it('ships with item ids and a custom track', async () => {
    const calls = mockFetch((url) =>
      url.pathname.endsWith('/orders/7') ? { entity_id: 7, items: [{ item_id: 11, sku: 'TEE-M' }] } : 99,
    );
    const res = await magentoAdapter.pushShipment(ctxOf('magento', { accessToken: 't' }), {
      channelOrderId: '7',
      storeOrderNumber: '#7',
      trackingNumber: '1Z',
      carrier: 'UPS',
      lines: [{ sku: 'TEE-M', quantity: 2 }],
    });
    expect(res.ok).toBe(true);
    const ship = calls.find((c) => c.url.pathname.endsWith('/order/7/ship'));
    expect(JSON.parse(String(ship?.init.body))).toMatchObject({
      items: [{ order_item_id: 11, qty: 2 }],
      tracks: [{ track_number: '1Z' }],
    });
  });
});

describe('BigCommerce', () => {
  it('maps V2 orders and variant products', () => {
    const o = bigcommerceToOrder(
      { id: 101, status_id: 11, date_created: 'Tue, 10 Nov 2026 13:05:08 +0000', total_inc_tax: '25.00' },
      [{ sku: 'MUG', name: 'Mug', quantity: 2, price_inc_tax: '12.50', product_id: 5 }],
      {
        first_name: 'Ada',
        last_name: 'L',
        street_1: '1 Main',
        city: 'Memphis',
        state: 'Tennessee',
        zip: '38118',
        country: 'United States',
      },
    );
    expect(o).toMatchObject({
      id: '101',
      number: '#101',
      financialStatus: 'paid',
      createdAt: '2026-11-10T13:05:08.000Z',
    });
    expect(o.lines[0]).toMatchObject({ sku: 'MUG', quantity: 2, price: 12.5 });
    expect(
      bigcommerceProducts({
        id: 5,
        name: 'Mug',
        variants: [
          { id: 50, sku: 'MUG-R', option_values: [{ label: 'Red' }] },
          { id: 51, sku: 'MUG-B', option_values: [{ label: 'Blue' }] },
        ],
      }).map((p) => p.id),
    ).toEqual(['5:50', '5:51']);
  });
  it('uses X-Auth-Token on the store-hash path and rejects a bad hash', async () => {
    const calls = mockFetch(() => ({ name: 'BC Store' }));
    await expect(
      bigcommerceAdapter.validate({
        connection: ctxOf('bigcommerce', {}).connection,
        credentials: { accessToken: 't', storeHash: 'ab-c' },
        now: new Date(),
      }),
    ).rejects.toThrow(/letters and digits/);
    const res = await bigcommerceAdapter.validate({
      connection: ctxOf('bigcommerce', {}).connection,
      credentials: { accessToken: 't', storeHash: 'abc123' },
      now: new Date(),
    });
    expect(res.ok).toBe(true);
    expect(calls[0]?.url.toString()).toBe('https://api.bigcommerce.com/stores/abc123/v2/store');
    expect((calls[0]?.init.headers as Record<string, string>)['x-auth-token']).toBe('t');
  });
});

describe('Etsy', () => {
  it('converts money and maps receipts and listing inventory', () => {
    expect(etsyMoney({ amount: 1999, divisor: 100 })).toBe(19.99);
    const o = etsyToOrder({
      receipt_id: 9,
      is_paid: true,
      name: 'Ada Lovelace',
      first_line: '1 Main',
      city: 'Memphis',
      zip: '38118',
      country_iso: 'US',
      transactions: [
        { sku: 'RING', title: 'Ring', quantity: 1, price: { amount: 5000, divisor: 100 }, listing_id: 3 },
      ],
      grandtotal: { amount: 5000, divisor: 100 },
    });
    expect(o).toMatchObject({ id: '9', financialStatus: 'paid', totalPrice: 50 });
    expect(o.shipTo).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(
      etsyProducts(
        { listing_id: 3, title: 'Ring' },
        {
          products: [
            {
              product_id: 30,
              sku: 'RING-7',
              offerings: [{ price: { amount: 5000, divisor: 100 } }],
              property_values: [{ values: ['7'] }],
            },
          ],
        },
      )[0],
    ).toMatchObject({ id: '3:30', sku: 'RING-7', title: 'Ring · 7', price: 50 });
  });
  it('sends the keystring and bearer token, scoped to the shop', async () => {
    const calls = mockFetch(() => ({ shop_name: 'BluebirdAndMain' }));
    const res = await etsyAdapter.validate({
      connection: ctxOf('etsy', {}).connection,
      credentials: { apiKey: 'key', accessToken: 'tok', shopId: '123' },
      now: new Date(),
    });
    expect(res.message).toContain('BluebirdAndMain');
    expect(calls[0]?.url.pathname).toBe('/v3/application/shops/123');
    expect((calls[0]?.init.headers as Record<string, string>)['x-api-key']).toBe('key');
  });
});

describe('Shopify Public App OAuth', () => {
  it('is enabled only with client id + secret', () => {
    expect(shopifyPublicAppConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      shopifyPublicAppConfig({
        SHOPIFY_CLIENT_ID: 'id',
        SHOPIFY_CLIENT_SECRET: 's',
      } as unknown as NodeJS.ProcessEnv)?.scopes,
    ).toContain('read_orders');
  });
  it('normalises shop domains and refuses others', () => {
    expect(normalizeShopDomain('Bluebird-Main')).toBe('bluebird-main.myshopify.com');
    expect(normalizeShopDomain('https://bluebird-main.myshopify.com/admin')).toBe(
      'bluebird-main.myshopify.com',
    );
    expect(normalizeShopDomain('evil.com/x.myshopify.com')).toBeNull();
    expect(normalizeShopDomain('a b')).toBeNull();
  });
  it("signs and verifies state (tamper, expiry) and Shopify's callback HMAC", () => {
    const st = signState(
      { userId: 'u', clientId: 'c', shop: 's.myshopify.com', nonce: 'n', exp: Date.now() + 60_000 },
      'secret',
    );
    expect(verifyState(st, 'secret')?.shop).toBe('s.myshopify.com');
    expect(verifyState(st, 'other')).toBeNull();
    expect(verifyState(`${st}x`, 'secret')).toBeNull();
    expect(
      verifyState(
        signState({ userId: 'u', clientId: 'c', shop: 's', nonce: 'n', exp: Date.now() - 1 }, 'secret'),
        'secret',
      ),
    ).toBeNull();
    const q = new URLSearchParams({
      code: 'abc',
      shop: 's.myshopify.com',
      state: st,
      timestamp: '1700000000',
    });
    const msg = [...q.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    q.set('hmac', createHmac('sha256', 'secret').update(msg).digest('hex'));
    expect(verifyShopifyHmac(q, 'secret')).toBe(true);
    q.set('shop', 't.myshopify.com');
    expect(verifyShopifyHmac(q, 'secret')).toBe(false);
    expect(
      authorizeUrl(
        { clientId: 'id', clientSecret: 's', scopes: 'read_orders' },
        's.myshopify.com',
        'st',
        'https://app/cb',
      ),
    ).toBe(
      'https://s.myshopify.com/admin/oauth/authorize?client_id=id&scope=read_orders&redirect_uri=https%3A%2F%2Fapp%2Fcb&state=st',
    );
  });
});
