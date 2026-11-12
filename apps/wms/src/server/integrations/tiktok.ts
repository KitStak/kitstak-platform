/**
 * TikTok Shop Partner API (version 202309) adapter (M12).
 * Auth: the app key + app secret (`clientId` / `clientSecret`), the seller's access token
 * (`userAccessToken`, header `x-tts-access-token`) and optionally a refresh token and the
 * shop cipher (looked up from /authorization/202309/shops when blank).
 * Every request is signed: HMAC-SHA256(secret, secret + path + sorted(key+value) + body + secret).
 * AWAITING_SHIPMENT orders are downloaded; Send Shipment Info ships the order's package with
 * self-shipment tracking; inventory updates the SKU quantity in the shop's default warehouse.
 */
import { createHmac } from 'node:crypto';
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
  type ChannelProduct,
} from './channel-adapter';
import type { Credentials } from './crypto';

const BASE = 'https://open-api.tiktokglobalshop.com';
const AUTH_BASE = 'https://auth.tiktok-shops.com';
const PAGE_SIZE = 50;
const MAX_PAGES = 6;

type Ctx = Pick<AdapterContext, 'connection' | 'credentials'>;

/** TikTok Shop request signature (hex). `params` excludes `sign` and `access_token`. */
export function tiktokSign(
  secret: string,
  path: string,
  params: Readonly<Record<string, string>>,
  body = '',
): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHmac('sha256', secret).update(`${secret}${path}${base}${body}${secret}`).digest('hex');
}

function keys(creds: Credentials | null): { appKey: string; secret: string } {
  const appKey = creds?.clientId;
  const secret = creds?.clientSecret;
  if (!appKey || !secret || !(creds?.userAccessToken || creds?.refreshToken))
    throw new ChannelApiError(
      "TikTok Shop needs the app key, app secret and the seller's access token; reconnect the store",
      401,
    );
  return { appKey, secret };
}

/** Access tokens last about 7 days; a stored refresh token renews them in memory. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** Per connection and credential (a rotated token starts fresh); never for the unsaved validation draft. */
const cacheKey = (ctx: Ctx): string | null =>
  ctx.connection.id === 'draft'
    ? null
    : `${ctx.connection.id}|${(ctx.credentials?.refreshToken ?? ctx.credentials?.userAccessToken ?? '').slice(-16)}`;

async function accessToken(ctx: Ctx): Promise<string> {
  const creds = ctx.credentials;
  const { appKey, secret } = keys(creds);
  const cached = cacheKey(ctx) ? tokenCache.get(cacheKey(ctx) as string) : undefined;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (creds?.refreshToken && (!creds.userAccessToken || cached)) {
    const q = new URLSearchParams({
      app_key: appKey,
      app_secret: secret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });
    const body = rec(await fetchJson(`${AUTH_BASE}/api/v2/token/refresh?${q.toString()}`));
    const data = rec(body.data);
    const token = strOrNull(data.access_token);
    if (!token)
      throw new ChannelApiError(
        `TikTok Shop refused the refresh token: ${String(body.message ?? 'unknown error')}`,
        401,
      );
    if (cacheKey(ctx))
      tokenCache.set(cacheKey(ctx) as string, {
        token,
        expiresAt: num(data.access_token_expire_in) * 1000 || Date.now() + 6 * 86_400_000,
      });
    return token;
  }
  const token = creds?.userAccessToken as string;
  if (cacheKey(ctx))
    tokenCache.set(cacheKey(ctx) as string, { token, expiresAt: Date.now() + 6 * 86_400_000 });
  return token;
}

/** TikTok wraps every response: { code: 0, message: "Success", data }. */
async function call(
  ctx: Ctx,
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT';
    query?: Record<string, string>;
    body?: unknown;
    shop?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const { appKey, secret } = keys(ctx.credentials);
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(opts.query ?? {}),
  };
  if (opts.shop !== false) params.shop_cipher = await shopCipher(ctx);
  const body = opts.body === undefined ? '' : JSON.stringify(opts.body);
  params.sign = tiktokSign(secret, path, params, body);
  const res = rec(
    await fetchJson(`${BASE}${path}?${new URLSearchParams(params).toString()}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      body: body || undefined,
      headers: {
        'x-tts-access-token': await accessToken(ctx),
        'content-type': 'application/json',
        accept: 'application/json',
      },
    }),
  );
  const code = num(res.code);
  if (code !== 0)
    throw new ChannelApiError(
      `TikTok Shop error ${code}: ${String(res.message ?? 'request failed')}`,
      code === 105001 || code === 105002 || code === 36004004 ? 401 : 400,
    );
  return rec(res.data);
}

const cipherCache = new Map<string, string>();
async function shopCipher(ctx: Ctx): Promise<string> {
  const given = ctx.credentials?.shopCipher?.trim();
  if (given) return given;
  const hit = cacheKey(ctx) ? cipherCache.get(cacheKey(ctx) as string) : undefined;
  if (hit) return hit;
  const shops = arr((await call(ctx, '/authorization/202309/shops', { shop: false })).shops).map(rec);
  const cipher = strOrNull(shops[0]?.cipher);
  if (!cipher) throw new ChannelApiError("This TikTok Shop app isn't authorised for any shop", 403);
  if (cacheKey(ctx)) cipherCache.set(cacheKey(ctx) as string, cipher);
  return cipher;
}

const fromUnix = (v: unknown): string =>
  num(v) > 0 ? new Date(num(v) * 1000).toISOString() : new Date().toISOString();

/** Groups TikTok's one-row-per-unit line items into quantity lines by SKU. */
export function tiktokToOrder(o: Record<string, unknown>): ChannelOrder {
  const a = rec(o.recipient_address);
  const district = arr(a.district_info).map(rec);
  const level = (l: string) =>
    strOrNull(
      district.find((d) =>
        String(d.address_level_name ?? d.address_level ?? '')
          .toLowerCase()
          .includes(l),
      )?.address_name,
    );
  const lines = new Map<
    string,
    { sku: string | null; title: string; quantity: number; price: number; fulfilled: number }
  >();
  for (const li of arr(o.line_items).map(rec)) {
    if (li.is_gift === true && !strOrNull(li.seller_sku)) continue;
    const key = `${String(li.sku_id ?? li.seller_sku ?? li.id)}`;
    const prev = lines.get(key);
    const shipped = ['SHIPPED', 'DELIVERED', 'COMPLETED', 'IN_TRANSIT'].includes(
      String(li.display_status ?? '').toUpperCase(),
    );
    lines.set(key, {
      sku: strOrNull(li.seller_sku),
      title: String(li.product_name ?? 'Item'),
      quantity: (prev?.quantity ?? 0) + 1,
      price: num(li.sale_price),
      fulfilled: (prev?.fulfilled ?? 0) + (shipped ? 1 : 0),
    });
  }
  const name = strOrNull(a.name) ?? 'Customer';
  return {
    id: String(o.id),
    number: `#${String(o.id)}`,
    createdAt: fromUnix(o.create_time),
    updatedAt: fromUnix(o.update_time ?? o.create_time),
    financialStatus: num(o.paid_time) > 0 || String(o.status) === 'AWAITING_SHIPMENT' ? 'paid' : 'pending',
    tags: [],
    email: strOrNull(o.buyer_email),
    locationId: strOrNull(o.warehouse_id),
    hasFulfillmentOrders: true,
    shipTo: strOrNull(a.address_line1)
      ? {
          name,
          firstName: strOrNull(a.first_name),
          lastName: strOrNull(a.last_name),
          company: null,
          line1: String(a.address_line1),
          line2: [strOrNull(a.address_line2), strOrNull(a.address_line3)].filter(Boolean).join(', ') || null,
          city: level('city') ?? String(a.city ?? ''),
          state: level('state') ?? strOrNull(a.state),
          zip: String(a.postal_code ?? ''),
          country: String(a.region_code ?? 'US') === 'US' ? 'United States' : String(a.region_code),
          phone: strOrNull(a.phone_number),
        }
      : null,
    lines: [...lines.values()].map((l) => ({
      sku: l.sku,
      title: l.title,
      quantity: l.quantity,
      price: l.price,
      requiresShipping: true,
      isCustom: false,
      fulfilledQuantity: l.fulfilled,
    })),
    totalPrice: num(rec(o.payment).total_amount),
    note: strOrNull(o.buyer_message),
    isGift: false,
    raw: o,
  };
}

async function warehouses(ctx: Ctx): Promise<Record<string, unknown>[]> {
  return arr((await call(ctx, '/logistics/202309/warehouses')).warehouses)
    .map(rec)
    .filter((w) => String(w.type ?? 'SALES_WAREHOUSE') === 'SALES_WAREHOUSE');
}

export const tiktokAdapter: ChannelAdapter = {
  key: 'tiktok',
  async validate(ctx) {
    const shops = arr((await call(ctx, '/authorization/202309/shops', { shop: false })).shops).map(rec);
    if (shops.length === 0)
      throw new ChannelApiError("This TikTok Shop app isn't authorised for any shop", 403);
    const list = await warehouses(ctx);
    const locations: ChannelLocation[] =
      list.length > 0
        ? list.map((w) => ({ id: String(w.id), name: String(w.name ?? w.id) }))
        : [{ id: 'default', name: 'TikTok Shop warehouse' }];
    return {
      ok: true,
      message: `Connected to ${String(shops[0]?.name ?? ctx.connection.storeName)}`,
      locations,
    };
  },
  async fetchOrders(ctx, since) {
    const out: ChannelOrder[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = {
        page_size: String(PAGE_SIZE),
        sort_field: 'create_time',
        sort_order: 'ASC',
      };
      if (token) query.page_token = token;
      const body: Record<string, unknown> = { order_status: 'AWAITING_SHIPMENT' };
      if (since) body.update_time_ge = Math.floor(new Date(since).getTime() / 1000);
      const data = await call(ctx, '/order/202309/orders/search', { query, body });
      out.push(...arr(data.orders).map(rec).map(tiktokToOrder));
      token = strOrNull(data.next_page_token);
      if (!token) break;
    }
    return out;
  },
  async fetchOrdersById(ctx, ids) {
    const clean = ids.map((i) => i.replace(/^#/, '')).filter((i) => /^\d+$/.test(i));
    const out: ChannelOrder[] = [];
    for (let i = 0; i < clean.length; i += 50) {
      const data = await call(ctx, '/order/202309/orders', {
        query: { ids: clean.slice(i, i + 50).join(',') },
      });
      out.push(...arr(data.orders).map(rec).map(tiktokToOrder));
    }
    return out;
  },
  async fetchProducts(ctx) {
    const out: ChannelProduct[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = { page_size: '100' };
      if (token) query.page_token = token;
      const data = await call(ctx, '/product/202309/products/search', {
        query,
        body: { status: 'ACTIVATE' },
      });
      for (const p of arr(data.products).map(rec)) {
        for (const s of arr(p.skus).map(rec)) {
          out.push({
            id: `${String(p.id)}:${String(s.id)}`,
            sku: strOrNull(s.seller_sku),
            title: String(p.title ?? 'Product'),
            price: num(rec(s.price).sale_price ?? rec(s.price).tax_exclusive_price),
            barcode: null,
            weightOz: 0,
            imageUrl: null,
          });
        }
      }
      token = strOrNull(data.next_page_token);
      if (!token) break;
    }
    return out;
  },
  async pushInventory(ctx, items) {
    const list = await warehouses(ctx);
    const warehouseId = String((list.find((w) => w.is_default === true) ?? list[0])?.id ?? '');
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      const [productId, skuId] = i.channelProductId.split(':');
      try {
        if (!productId || !skuId)
          throw new Error('Download products first so the SKU is linked to its TikTok product');
        await call(ctx, `/product/202309/products/${productId}/inventory/update`, {
          body: {
            skus: [
              {
                id: skuId,
                inventory: [{ quantity: i.qty, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }],
              },
            ],
          },
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
    const order = rec(arr((await call(ctx, '/order/202309/orders', { query: { ids: id } })).orders)[0]);
    const pkg = strOrNull(rec(arr(order.packages)[0]).id);
    const option = strOrNull(order.delivery_option_id);
    if (!pkg || !option) return { ok: false, error: 'The TikTok order has no package to ship yet' };
    const providers = arr(
      (await call(ctx, `/logistics/202309/delivery_options/${option}/shipping_providers`)).shipping_providers,
    ).map(rec);
    const want = s.carrier.toLowerCase();
    const provider =
      providers.find((p) =>
        String(p.name ?? '')
          .toLowerCase()
          .includes(want),
      ) ?? providers.find((p) => want.includes(String(p.name ?? '').toLowerCase()));
    if (!provider)
      return {
        ok: false,
        error: `TikTok Shop has no shipping provider matching ${s.carrier} for this order`,
      };
    await call(ctx, `/fulfillment/202309/packages/${pkg}/ship`, {
      body: {
        handover_method: 'DROP_OFF',
        self_shipment: { tracking_number: s.trackingNumber, shipping_provider_id: String(provider.id) },
      },
    });
    return { ok: true };
  },
};
