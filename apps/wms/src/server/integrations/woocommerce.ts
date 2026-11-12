/**
 * WooCommerce REST API v3 adapter (M12). Auth: consumer key + consumer secret (HTTP Basic over
 * HTTPS), stored as `clientId` / `clientSecret`. The store name is the shop's domain.
 * Orders in "processing" are downloaded; Send Shipment Info adds a customer note with the
 * tracking number and completes the order; inventory sets `stock_quantity` (manage stock on).
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

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

/** "shop.example.com", "https://shop.example.com/" → "https://shop.example.com". */
export function wooBaseUrl(storeName: string): string {
  const s = storeName.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return `${withScheme.replace(/^http:\/\//i, 'https://')}/wp-json/wc/v3`;
}

function authHeader(creds: Credentials | null): string {
  const key = creds?.clientId;
  const secret = creds?.clientSecret;
  if (!key || !secret)
    throw new ChannelApiError(
      'WooCommerce needs a consumer key and consumer secret; reconnect the store',
      401,
    );
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

async function call(
  ctx: Pick<AdapterContext, 'connection' | 'credentials'>,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  return fetchJson(`${wooBaseUrl(ctx.connection.storeName)}${path}`, {
    ...init,
    headers: {
      authorization: authHeader(ctx.credentials),
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

const gmt = (v: unknown): string => {
  const s = strOrNull(v);
  if (!s) return new Date().toISOString();
  return /Z|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s).toISOString() : new Date(`${s}Z`).toISOString();
};

/** Maps one WooCommerce order JSON to the channel order shape. */
export function wooToOrder(o: Record<string, unknown>): ChannelOrder {
  const ship = rec(o.shipping);
  const bill = rec(o.billing);
  const a = strOrNull(ship.address_1) ? ship : bill;
  const first = strOrNull(a.first_name);
  const last = strOrNull(a.last_name);
  const lines = arr(o.line_items)
    .map(rec)
    .map((l) => {
      const qty = num(l.quantity);
      return {
        sku: strOrNull(l.sku),
        title: String(l.name ?? 'Item'),
        quantity: qty,
        price: num(l.price, qty > 0 ? num(l.total) / qty : 0),
        requiresShipping: true,
        isCustom: !num(l.product_id),
        fulfilledQuantity: 0,
      };
    });
  const status = String(o.status ?? '');
  return {
    id: String(o.id),
    number: `#${String(o.number ?? o.id)}`,
    createdAt: gmt(o.date_created_gmt ?? o.date_created),
    updatedAt: gmt(o.date_modified_gmt ?? o.date_modified ?? o.date_created_gmt),
    financialStatus:
      o.date_paid || o.date_paid_gmt || status === 'processing' || status === 'completed'
        ? 'paid'
        : 'pending',
    tags: [],
    email: strOrNull(bill.email),
    locationId: null,
    hasFulfillmentOrders: true,
    shipTo: strOrNull(a.address_1)
      ? {
          name: [first, last].filter(Boolean).join(' ') || strOrNull(a.company) || 'Customer',
          firstName: first,
          lastName: last,
          company: strOrNull(a.company),
          line1: String(a.address_1 ?? ''),
          line2: strOrNull(a.address_2),
          city: String(a.city ?? ''),
          state: strOrNull(a.state),
          zip: String(a.postcode ?? ''),
          country: String(a.country ?? 'US') === 'US' ? 'United States' : String(a.country),
          phone: strOrNull(a.phone) ?? strOrNull(bill.phone),
        }
      : null,
    lines,
    totalPrice: num(o.total),
    note: strOrNull(o.customer_note),
    isGift: false,
    raw: o,
  };
}

async function pages(ctx: AdapterContext, path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = arr(await call(ctx, `${path}${sep}per_page=${PAGE_SIZE}&page=${page}`)).map(rec);
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

function productOf(p: Record<string, unknown>, v: Record<string, unknown> | null): ChannelProduct {
  const src = v ?? p;
  const image = rec(arr(p.images)[0]);
  return {
    id: v ? `${String(p.id)}:${String(v.id)}` : String(p.id),
    sku: strOrNull(src.sku),
    title: v
      ? `${String(p.name)} — ${
          arr(v.attributes)
            .map(rec)
            .map((x) => String(x.option ?? ''))
            .filter(Boolean)
            .join(' / ') || String(v.id)
        }`
      : String(p.name ?? 'Product'),
    price: num(src.price),
    barcode: strOrNull(
      rec(
        arr(src.meta_data)
          .map(rec)
          .find((m) => /gtin|upc|ean|barcode/i.test(String(m.key ?? ''))),
      ).value,
    ),
    weightOz: num(src.weight) * 16,
    imageUrl: strOrNull(rec(v?.image).src) ?? strOrNull(image.src),
  };
}

export const woocommerceAdapter: ChannelAdapter = {
  key: 'woocommerce',
  async validate(ctx) {
    await call(ctx, '/orders?per_page=1');
    return {
      ok: true,
      message: `Connected to ${ctx.connection.storeName}`,
      locations: [{ id: 'default', name: 'WooCommerce store (single location)' }],
    };
  },
  async fetchOrders(ctx, since) {
    const q = new URLSearchParams({ status: 'processing', orderby: 'date', order: 'asc' });
    if (since) q.set('modified_after', since);
    return (await pages(ctx, `/orders?${q.toString()}`)).map(wooToOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const clean = ids.map((i) => i.replace(/^#/, '')).filter((i) => /^\d+$/.test(i));
    if (clean.length === 0) return [];
    return arr(await call(ctx, `/orders?include=${clean.join(',')}&per_page=${PAGE_SIZE}`))
      .map(rec)
      .map(wooToOrder);
  },
  async fetchProducts(ctx) {
    const products = await pages(ctx, '/products?status=publish');
    const out: ChannelProduct[] = [];
    for (const p of products) {
      if (p.type === 'variable') {
        const vars = arr(await call(ctx, `/products/${String(p.id)}/variations?per_page=${PAGE_SIZE}`)).map(
          rec,
        );
        out.push(...vars.map((v) => productOf(p, v)));
      } else if (p.virtual !== true && p.downloadable !== true) out.push(productOf(p, null));
    }
    return out;
  },
  async pushInventory(ctx, items) {
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      const [pid, vid] = i.channelProductId.split(':');
      try {
        await call(ctx, vid ? `/products/${pid}/variations/${vid}` : `/products/${pid}`, {
          method: 'PUT',
          body: JSON.stringify({ manage_stock: true, stock_quantity: i.qty }),
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
    await call(ctx, `/orders/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        note: `Shipped with ${s.carrier}. Tracking number: ${s.trackingNumber}`,
        customer_note: true,
      }),
    });
    await call(ctx, `/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
    return { ok: true };
  },
};
