/**
 * Adobe Commerce / Magento 2 REST adapter (M12). Auth: an Integration access token
 * (System → Extensions → Integrations; "Bearer" for the REST API), stored as `accessToken`.
 * The store name is the base URL. "processing" orders are downloaded; Send Shipment Info
 * calls `POST /V1/order/{id}/ship` with the items and a track; inventory sets the default
 * source stock item.
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

type Ctx = Pick<AdapterContext, 'connection' | 'credentials'>;

/** "shop.example.com", "https://shop.example.com/" → "https://shop.example.com/rest/V1". */
export function magentoBaseUrl(storeName: string): string {
  const s = storeName
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest(\/V1)?$/i, '');
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return `${withScheme.replace(/^http:\/\//i, 'https://')}/rest/V1`;
}

function bearer(creds: Credentials | null): string {
  const token = creds?.accessToken;
  if (!token)
    throw new ChannelApiError('Magento needs an integration access token; reconnect the store', 401);
  return `Bearer ${token}`;
}

async function call(ctx: Ctx, path: string, init: RequestInit = {}): Promise<unknown> {
  return fetchJson(`${magentoBaseUrl(ctx.connection.storeName)}${path}`, {
    ...init,
    headers: {
      authorization: bearer(ctx.credentials),
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/** Builds `searchCriteria` query params: each filter is its own group (AND). */
export function searchCriteria(
  filters: readonly { field: string; value: string; condition: string }[],
  page: number,
  pageSize = PAGE_SIZE,
): string {
  const q = new URLSearchParams();
  filters.forEach((f, i) => {
    q.set(`searchCriteria[filter_groups][${i}][filters][0][field]`, f.field);
    q.set(`searchCriteria[filter_groups][${i}][filters][0][value]`, f.value);
    q.set(`searchCriteria[filter_groups][${i}][filters][0][condition_type]`, f.condition);
  });
  q.set('searchCriteria[pageSize]', String(pageSize));
  q.set('searchCriteria[currentPage]', String(page));
  return q.toString();
}

/** Magento stores UTC as "2026-11-10 13:05:08". */
const utc = (v: unknown): string => {
  const s = strOrNull(v);
  if (!s) return new Date().toISOString();
  const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};
const magentoDate = (iso: string): string => new Date(iso).toISOString().replace('T', ' ').slice(0, 19);

export function magentoToOrder(o: Record<string, unknown>): ChannelOrder {
  const assignment = rec(arr(rec(rec(o.extension_attributes)).shipping_assignments)[0]);
  const ship = rec(rec(assignment.shipping).address);
  const a = strOrNull(arr(ship.street)[0]) ? ship : rec(o.billing_address);
  const first = strOrNull(a.firstname);
  const last = strOrNull(a.lastname);
  // Configurable products appear as a parent + child; ship the parent row (it carries the child's SKU).
  const items = arr(o.items)
    .map(rec)
    .filter((i) => !i.parent_item_id);
  return {
    id: String(o.entity_id),
    number: `#${String(o.increment_id ?? o.entity_id)}`,
    createdAt: utc(o.created_at),
    updatedAt: utc(o.updated_at ?? o.created_at),
    financialStatus: num(o.total_due) <= 0 || num(o.total_paid) > 0 ? 'paid' : 'pending',
    tags: [],
    email: strOrNull(o.customer_email),
    locationId: null,
    hasFulfillmentOrders: true,
    shipTo: strOrNull(arr(a.street)[0])
      ? {
          name: [first, last].filter(Boolean).join(' ') || strOrNull(a.company) || 'Customer',
          firstName: first,
          lastName: last,
          company: strOrNull(a.company),
          line1: String(arr(a.street)[0] ?? ''),
          line2: strOrNull(arr(a.street)[1]),
          city: String(a.city ?? ''),
          state: strOrNull(a.region_code) ?? strOrNull(a.region),
          zip: String(a.postcode ?? ''),
          country: String(a.country_id ?? 'US') === 'US' ? 'United States' : String(a.country_id),
          phone: strOrNull(a.telephone),
        }
      : null,
    lines: items.map((i) => ({
      sku: strOrNull(i.sku),
      title: String(i.name ?? 'Item'),
      quantity: num(i.qty_ordered) - num(i.qty_canceled),
      price: num(i.price_incl_tax ?? i.price),
      requiresShipping:
        i.is_virtual !== 1 &&
        i.is_virtual !== true &&
        i.product_type !== 'virtual' &&
        i.product_type !== 'downloadable',
      isCustom: !num(i.product_id),
      fulfilledQuantity: num(i.qty_shipped),
    })),
    totalPrice: num(o.grand_total),
    note: strOrNull(
      arr(o.status_histories)
        .map(rec)
        .find((h) => h.comment)?.comment,
    ),
    isGift: Boolean(rec(o.extension_attributes).gift_message),
    raw: o,
  };
}

async function searchPages(
  ctx: Ctx,
  path: string,
  filters: readonly { field: string; value: string; condition: string }[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = rec(await call(ctx, `${path}?${searchCriteria(filters, page)}`));
    const batch = arr(body.items).map(rec);
    out.push(...batch);
    if (batch.length < PAGE_SIZE || out.length >= num(body.total_count)) break;
  }
  return out;
}

export const magentoAdapter: ChannelAdapter = {
  key: 'magento',
  async validate(ctx) {
    const configs = arr(await call(ctx, '/store/storeConfigs')).map(rec);
    let locations = [{ id: 'default', name: 'Default Source' }];
    try {
      const sources = arr(
        rec(
          await call(
            ctx,
            `/inventory/sources?${searchCriteria([{ field: 'enabled', value: '1', condition: 'eq' }], 1)}`,
          ),
        ).items,
      ).map(rec);
      if (sources.length > 0)
        locations = sources.map((x) => ({
          id: String(x.source_code),
          name: String(x.name ?? x.source_code),
        }));
    } catch {
      /* MSI disabled: single default source. */
    }
    return {
      ok: true,
      message: `Connected to ${String(configs[0]?.base_url ?? ctx.connection.storeName)}`,
      locations,
    };
  },
  async fetchOrders(ctx, since) {
    const filters = [{ field: 'status', value: 'processing', condition: 'eq' }];
    if (since) filters.push({ field: 'updated_at', value: magentoDate(since), condition: 'gteq' });
    return (await searchPages(ctx, '/orders', filters)).map(magentoToOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const out: ChannelOrder[] = [];
    for (const raw of ids) {
      const id = raw.replace(/^#/, '');
      if (!/^\d+$/.test(id)) continue;
      out.push(magentoToOrder(rec(await call(ctx, `/orders/${id}`))));
    }
    return out;
  },
  async fetchProducts(ctx) {
    const products = await searchPages(ctx, '/products', [
      { field: 'type_id', value: 'simple', condition: 'eq' },
      { field: 'status', value: '1', condition: 'eq' },
    ]);
    return products.map((p): ChannelProduct => {
      const attrs = new Map(
        arr(p.custom_attributes)
          .map(rec)
          .map((a) => [String(a.attribute_code), a.value]),
      );
      return {
        id: String(p.sku),
        sku: strOrNull(p.sku),
        title: String(p.name ?? 'Product'),
        price: num(p.price),
        barcode:
          strOrNull(attrs.get('barcode')) ?? strOrNull(attrs.get('upc')) ?? strOrNull(attrs.get('gtin')),
        weightOz: num(p.weight) * 16,
        imageUrl: strOrNull(attrs.get('image')),
      };
    });
  },
  async pushInventory(ctx, items) {
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      try {
        await call(ctx, `/products/${encodeURIComponent(i.channelProductId || i.sellerSku)}/stockItems/1`, {
          method: 'PUT',
          body: JSON.stringify({ stockItem: { qty: i.qty, is_in_stock: i.qty > 0 } }),
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
    const order = rec(await call(ctx, `/orders/${id}`));
    const bySku = new Map(
      arr(order.items)
        .map(rec)
        .filter((i) => !i.parent_item_id)
        .map((i) => [String(i.sku ?? ''), Number(i.item_id)]),
    );
    const items = s.lines
      .map((l) => ({ order_item_id: bySku.get(l.sku), qty: l.quantity }))
      .filter((x): x is { order_item_id: number; qty: number } => Number.isFinite(x.order_item_id));
    if (items.length === 0) return { ok: false, error: 'None of the shipped SKUs are on the Magento order' };
    await call(ctx, `/order/${id}/ship`, {
      method: 'POST',
      body: JSON.stringify({
        items,
        notify: true,
        tracks: [{ track_number: s.trackingNumber, title: s.carrier, carrier_code: 'custom' }],
      }),
    });
    return { ok: true };
  },
};
