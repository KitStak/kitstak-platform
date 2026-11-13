/**
 * Shopify Admin API adapter (M12). Custom App: Access Token, or Client ID & Secret exchanged
 * through the client-credentials grant. REST calls use API version 2024-10; validation uses the
 * GraphQL endpoint when the connection is set to GraphQL. Credentials stay server-side.
 */
import {
  ChannelApiError,
  arr,
  fetchJson,
  num,
  rec,
  strOrNull,
  type AdapterContext,
  type ChannelAdapter,
  type ChannelLocation,
  type ChannelOrder,
} from './channel-adapter';
import type { Credentials } from './crypto';

const VERSION = '2024-10';

export function shopDomain(storeName: string): string {
  const s = storeName
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return s.includes('.') ? s : `${s}.myshopify.com`;
}

async function accessToken(domain: string, creds: Credentials | null): Promise<string> {
  if (creds?.accessToken) return creds.accessToken;
  if (creds?.clientId && creds.clientSecret) {
    const body = rec(
      await fetchJson(`https://${domain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          grant_type: 'client_credentials',
        }),
      }),
    );
    const token = strOrNull(body.access_token);
    if (!token)
      throw new ChannelApiError('Shopify did not return an access token for these client credentials', 401);
    return token;
  }
  throw new ChannelApiError(
    'No Shopify credentials are stored for this connection; reconnect the store',
    401,
  );
}

async function api(
  domain: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  return rec(
    await fetchJson(`https://${domain}/admin/api/${VERSION}/${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': token,
        ...(init.headers ?? {}),
      },
    }),
  );
}

function toOrder(o: Record<string, unknown>): ChannelOrder {
  const ship = rec(o.shipping_address);
  const lines = arr(o.line_items)
    .map(rec)
    .map((l) => ({
      sku: strOrNull(l.sku),
      title: String(l.title ?? l.name ?? 'Item'),
      quantity: num(l.quantity),
      price: num(l.price),
      requiresShipping: l.requires_shipping !== false,
      isCustom: !l.product_id,
      fulfilledQuantity: num(l.quantity) - num(l.fulfillable_quantity, num(l.quantity)),
    }));
  const hasShip = Object.keys(ship).length > 0;
  return {
    id: String(o.id),
    number: String(o.name ?? o.order_number ?? o.id),
    createdAt: String(o.created_at ?? new Date().toISOString()),
    updatedAt: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
    financialStatus: String(o.financial_status ?? ''),
    tags: String(o.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    email: strOrNull(o.email),
    locationId: strOrNull(o.location_id),
    hasFulfillmentOrders: true,
    shipTo: hasShip
      ? {
          name:
            [ship.first_name, ship.last_name].filter(Boolean).join(' ') || String(ship.name ?? 'Customer'),
          firstName: strOrNull(ship.first_name),
          lastName: strOrNull(ship.last_name),
          company: strOrNull(ship.company),
          line1: String(ship.address1 ?? ''),
          line2: strOrNull(ship.address2),
          city: String(ship.city ?? ''),
          state: strOrNull(ship.province_code ?? ship.province),
          zip: String(ship.zip ?? ''),
          country: String(ship.country ?? 'United States'),
          phone: strOrNull(ship.phone),
        }
      : null,
    lines,
    totalPrice: num(o.total_price),
    note: strOrNull(o.note),
    isGift: false,
    raw: o,
  };
}

export const shopifyAdapter: ChannelAdapter = {
  key: 'shopify',
  async validate(ctx) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    if (ctx.connection.apiVersion === 'GraphQL') {
      const res = rec(
        await fetchJson(`https://${domain}/admin/api/${VERSION}/graphql.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
          body: JSON.stringify({ query: '{ shop { name } locations(first: 50) { nodes { id name } } }' }),
        }),
      );
      const data = rec(res.data);
      const locations: ChannelLocation[] = arr(rec(data.locations).nodes)
        .map(rec)
        .map((l) => ({ id: String(l.id).split('/').pop() ?? String(l.id), name: String(l.name) }));
      return { ok: true, message: `Connected to ${String(rec(data.shop).name ?? domain)}`, locations };
    }
    const shop = rec((await api(domain, token, 'shop.json')).shop);
    const locations = arr((await api(domain, token, 'locations.json')).locations)
      .map(rec)
      .map((l) => ({ id: String(l.id), name: String(l.name) }));
    return { ok: true, message: `Connected to ${String(shop.name ?? domain)}`, locations };
  },
  async fetchOrders(ctx: AdapterContext, since) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    const q = new URLSearchParams({ status: 'open', fulfillment_status: 'unfulfilled', limit: '250' });
    if (since) q.set('updated_at_min', since);
    return arr((await api(domain, token, `orders.json?${q.toString()}`)).orders)
      .map(rec)
      .map(toOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    const clean = ids.map((i) => i.split('/').pop() ?? i).filter((i) => /^\d+$/.test(i));
    if (clean.length === 0) return [];
    return arr((await api(domain, token, `orders.json?status=any&ids=${clean.join(',')}`)).orders)
      .map(rec)
      .map(toOrder);
  },
  async fetchProducts(ctx) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    const products = arr((await api(domain, token, 'products.json?limit=250')).products).map(rec);
    return products.flatMap((p) =>
      arr(p.variants)
        .map(rec)
        .map((v) => ({
          id: `${String(v.id)}:${String(v.inventory_item_id ?? '')}`,
          sku: strOrNull(v.sku),
          title: arr(p.variants).length > 1 ? `${String(p.title)} · ${String(v.title)}` : String(p.title),
          price: num(v.price),
          barcode: strOrNull(v.barcode),
          weightOz: num(v.grams) / 28.3495,
          imageUrl: strOrNull(rec(p.image).src),
        })),
    );
  },
  async pushInventory(ctx, items) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    const loc = arr((await api(domain, token, 'locations.json')).locations).map(rec)[0];
    if (!loc) throw new ChannelApiError('The store has no locations to sync inventory to', 422);
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      const inventoryItemId = i.channelProductId.split(':')[1];
      if (!inventoryItemId) {
        out.push({
          sellerSku: i.sellerSku,
          ok: false,
          error: 'Listing has no inventory item id; download products again',
        });
        continue;
      }
      try {
        await api(domain, token, 'inventory_levels/set.json', {
          method: 'POST',
          body: JSON.stringify({
            location_id: loc.id,
            inventory_item_id: Number(inventoryItemId),
            available: i.qty,
          }),
        });
        out.push({ sellerSku: i.sellerSku, ok: true });
      } catch (e) {
        out.push({
          sellerSku: i.sellerSku,
          ok: false,
          error: e instanceof Error ? e.message : 'Inventory update failed',
        });
      }
    }
    return out;
  },
  async pushShipment(ctx, s) {
    const domain = shopDomain(ctx.connection.storeName);
    const token = await accessToken(domain, ctx.credentials);
    const fos = arr(
      (await api(domain, token, `orders/${s.channelOrderId.split('/').pop()}/fulfillment_orders.json`))
        .fulfillment_orders,
    )
      .map(rec)
      .filter((f) => f.status === 'open' || f.status === 'in_progress');
    if (fos.length === 0) return { ok: false, error: 'Order lines are already fulfilled on the store' };
    await api(domain, token, 'fulfillments.json', {
      method: 'POST',
      body: JSON.stringify({
        fulfillment: {
          line_items_by_fulfillment_order: fos.map((f) => ({ fulfillment_order_id: f.id })),
          tracking_info: { number: s.trackingNumber, company: s.carrier },
          notify_customer: true,
        },
      }),
    });
    return { ok: true };
  },
};
