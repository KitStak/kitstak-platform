/**
 * BigCommerce adapter (M12). REST: V2 orders/shipments + V3 catalog/inventory.
 * Auth: a store-level API account access token (`X-Auth-Token`) plus the store hash
 * (`stores/{hash}` in the API path), stored encrypted as `accessToken` / `storeHash`.
 * Orders in "Awaiting Fulfillment" (status 11) are downloaded; Send Shipment Info creates a
 * V2 shipment (tracking + items), which BigCommerce moves to Shipped / Partially Shipped.
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
  type ChannelOrder,
  type ChannelProduct,
} from './channel-adapter';
import type { Credentials } from './crypto';

const PAGE_SIZE = 250;
const MAX_PAGES = 4;
/** BigCommerce order status id "Awaiting Fulfillment". */
export const BC_AWAITING_FULFILLMENT = 11;

type Ctx = Pick<AdapterContext, 'connection' | 'credentials'>;

function auth(creds: Credentials | null): { hash: string; token: string } {
  const token = creds?.accessToken;
  const hash = creds?.storeHash?.trim();
  if (!token || !hash)
    throw new ChannelApiError(
      'BigCommerce needs the API account access token and the store hash; reconnect the store',
      401,
    );
  if (!/^[a-z0-9]+$/i.test(hash))
    throw new ChannelApiError(
      'The BigCommerce store hash has letters and digits only (from https://api.bigcommerce.com/stores/{hash}/)',
      400,
    );
  return { hash, token };
}

async function call(ctx: Ctx, path: string, init: RequestInit = {}): Promise<unknown> {
  const { hash, token } = auth(ctx.credentials);
  return fetchJson(`https://api.bigcommerce.com/stores/${hash}${path}`, {
    ...init,
    headers: {
      'x-auth-token': token,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/** BigCommerce V2 dates are RFC 2822 ("Tue, 20 Nov 2026 13:05:08 +0000"). */
const iso = (v: unknown): string => {
  const s = strOrNull(v);
  const d = s ? new Date(s) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/** Maps a V2 order with its products and first shipping address. */
export function bigcommerceToOrder(
  o: Record<string, unknown>,
  products: readonly Record<string, unknown>[],
  address: Record<string, unknown> | null,
): ChannelOrder {
  const a = address ?? rec(o.billing_address);
  const first = strOrNull(a.first_name);
  const last = strOrNull(a.last_name);
  const status = String(o.payment_status ?? '');
  return {
    id: String(o.id),
    number: `#${String(o.id)}`,
    createdAt: iso(o.date_created),
    updatedAt: iso(o.date_modified ?? o.date_created),
    financialStatus:
      /captured|paid|authorized/i.test(status) || num(o.status_id) === BC_AWAITING_FULFILLMENT
        ? 'paid'
        : status || 'pending',
    tags: [],
    email: strOrNull(a.email) ?? strOrNull(rec(o.billing_address).email),
    locationId: null,
    hasFulfillmentOrders: true,
    shipTo: strOrNull(a.street_1)
      ? {
          name: [first, last].filter(Boolean).join(' ') || strOrNull(a.company) || 'Customer',
          firstName: first,
          lastName: last,
          company: strOrNull(a.company),
          line1: String(a.street_1 ?? ''),
          line2: strOrNull(a.street_2),
          city: String(a.city ?? ''),
          state: strOrNull(a.state),
          zip: String(a.zip ?? ''),
          country: strOrNull(a.country) ?? 'United States',
          phone: strOrNull(a.phone),
        }
      : null,
    lines: products.map((p) => ({
      sku: strOrNull(p.sku),
      title: String(p.name ?? 'Item'),
      quantity: num(p.quantity),
      price: num(p.price_inc_tax ?? p.base_price),
      requiresShipping: p.type !== 'digital',
      isCustom: !num(p.product_id),
      fulfilledQuantity: num(p.quantity_shipped),
    })),
    totalPrice: num(o.total_inc_tax),
    note: strOrNull(o.customer_message),
    isGift: false,
    raw: o,
  };
}

async function withDetails(ctx: Ctx, o: Record<string, unknown>): Promise<ChannelOrder> {
  const id = String(o.id);
  const [products, addresses] = await Promise.all([
    call(ctx, `/v2/orders/${id}/products?limit=${PAGE_SIZE}`),
    call(ctx, `/v2/orders/${id}/shipping_addresses`),
  ]);
  const first = arr(addresses)[0];
  return bigcommerceToOrder(o, arr(products).map(rec), first ? rec(first) : null);
}

/** V2 returns 204 (null body) past the last page. */
async function v2Pages(ctx: Ctx, path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = arr(await call(ctx, `${path}&limit=${PAGE_SIZE}&page=${page}`)).map(rec);
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

export function bigcommerceProducts(p: Record<string, unknown>): ChannelProduct[] {
  const variants = arr(p.variants).map(rec);
  const image = strOrNull(
    rec(
      arr(p.images)
        .map(rec)
        .find((i) => i.is_thumbnail) ?? arr(p.images)[0],
    ).url_standard,
  );
  const base = { title: String(p.name ?? 'Product'), imageUrl: image };
  // A product without options has one base variant; options add more.
  if (variants.length <= 1) {
    const v = variants[0] ?? {};
    return [
      {
        id: `${String(p.id)}:${String(v.id ?? '')}`,
        sku: strOrNull(v.sku) ?? strOrNull(p.sku),
        price: num(v.price ?? p.price, num(p.price)),
        barcode: strOrNull(v.upc) ?? strOrNull(p.upc),
        weightOz: num(v.weight ?? p.weight) * 16,
        ...base,
      },
    ];
  }
  return variants.map((v) => ({
    id: `${String(p.id)}:${String(v.id)}`,
    sku: strOrNull(v.sku),
    price: num(v.calculated_price ?? v.price, num(p.price)),
    barcode: strOrNull(v.upc),
    weightOz: num(v.calculated_weight ?? v.weight ?? p.weight) * 16,
    ...base,
    title: `${base.title} · ${
      arr(v.option_values)
        .map(rec)
        .map((x) => String(x.label ?? ''))
        .filter(Boolean)
        .join(' / ') || String(v.id)
    }`,
  }));
}

export const bigcommerceAdapter: ChannelAdapter = {
  key: 'bigcommerce',
  async validate(ctx) {
    const store = rec(await call(ctx, '/v2/store'));
    let locations = [{ id: 'default', name: 'BigCommerce store (default location)' }];
    try {
      const inv = arr(rec(await call(ctx, '/v3/inventory/locations')).data)
        .map(rec)
        .filter((l) => l.enabled !== false);
      if (inv.length > 0)
        locations = inv.map((l) => ({ id: String(l.id), name: String(l.label ?? l.code ?? l.id) }));
    } catch {
      /* Multi-location inventory is optional on older plans. */
    }
    return { ok: true, message: `Connected to ${String(store.name ?? ctx.connection.storeName)}`, locations };
  },
  async fetchOrders(ctx, since) {
    const q = new URLSearchParams({ status_id: String(BC_AWAITING_FULFILLMENT), sort: 'date_created:asc' });
    if (since) q.set('min_date_modified', new Date(since).toISOString());
    const orders = await v2Pages(ctx, `/v2/orders?${q.toString()}`);
    const out: ChannelOrder[] = [];
    for (const o of orders) out.push(await withDetails(ctx, o));
    return out;
  },
  async fetchOrdersById(ctx, ids) {
    const out: ChannelOrder[] = [];
    for (const raw of ids) {
      const id = raw.replace(/^#/, '');
      if (!/^\d+$/.test(id)) continue;
      out.push(await withDetails(ctx, rec(await call(ctx, `/v2/orders/${id}`))));
    }
    return out;
  },
  async fetchProducts(ctx) {
    const out: ChannelProduct[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = rec(
        await call(
          ctx,
          `/v3/catalog/products?include=variants,images&is_visible=true&limit=${PAGE_SIZE}&page=${page}`,
        ),
      );
      const batch = arr(body.data).map(rec);
      for (const p of batch) if (p.type !== 'digital') out.push(...bigcommerceProducts(p));
      const pagination = rec(rec(body.meta).pagination);
      if (num(pagination.current_page) >= num(pagination.total_pages, 1) || batch.length < PAGE_SIZE) break;
    }
    return out;
  },
  async pushInventory(ctx, items) {
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      const [pid, vid] = i.channelProductId.split(':');
      try {
        await call(ctx, vid ? `/v3/catalog/products/${pid}/variants/${vid}` : `/v3/catalog/products/${pid}`, {
          method: 'PUT',
          body: JSON.stringify({ inventory_level: i.qty }),
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
    const id = s.channelOrderId.replace(/^#/, '');
    const [products, addresses] = await Promise.all([
      call(ctx, `/v2/orders/${id}/products?limit=${PAGE_SIZE}`),
      call(ctx, `/v2/orders/${id}/shipping_addresses`),
    ]);
    const address = rec(arr(addresses)[0]);
    if (!address.id) return { ok: false, error: 'The order has no shipping address in BigCommerce' };
    const bySku = new Map(
      arr(products)
        .map(rec)
        .map((p) => [String(p.sku ?? ''), String(p.id)]),
    );
    const items = s.lines
      .map((l) => ({ order_product_id: Number(bySku.get(l.sku)), quantity: l.quantity }))
      .filter((x) => Number.isFinite(x.order_product_id));
    if (items.length === 0)
      return { ok: false, error: 'None of the shipped SKUs are on the BigCommerce order' };
    await call(ctx, `/v2/orders/${id}/shipments`, {
      method: 'POST',
      body: JSON.stringify({
        order_address_id: Number(address.id),
        tracking_number: s.trackingNumber,
        tracking_carrier: s.carrier.toLowerCase().replace(/\s+/g, ''),
        items,
      }),
    });
    return { ok: true };
  },
};
