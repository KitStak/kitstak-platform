/**
 * Walmart Marketplace API adapter (M12). Auth: client ID + client secret exchanged for a token
 * (`/v3/token`, client credentials). Orders in Created / Acknowledged are downloaded and Created
 * ones are acknowledged; shipments post line-level Shipped statuses with tracking; inventory
 * updates `/v3/inventory` per SKU.
 */
import { randomUUID } from 'node:crypto';
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
} from './channel-adapter';
import type { Credentials } from './crypto';

const API = 'https://marketplace.walmartapis.com';
const SVC = 'KitStak WMS';
const LOOKBACK_DAYS = 30;

function basic(creds: Credentials | null): string {
  if (!creds?.clientId || !creds.clientSecret)
    throw new ChannelApiError('Walmart needs a client ID and client secret; reconnect the store', 401);
  return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
}

const baseHeaders = (creds: Credentials | null): Record<string, string> => ({
  authorization: basic(creds),
  'WM_SVC.NAME': SVC,
  'WM_QOS.CORRELATION_ID': randomUUID(),
  accept: 'application/json',
});

async function accessToken(creds: Credentials | null): Promise<string> {
  const body = rec(
    await fetchJson(`${API}/v3/token`, {
      method: 'POST',
      headers: { ...baseHeaders(creds), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  );
  const t = strOrNull(body.access_token);
  if (!t) throw new ChannelApiError('Walmart did not return an access token for these credentials', 401);
  return t;
}

async function call(
  ctx: Pick<AdapterContext, 'credentials'>,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const t = await accessToken(ctx.credentials);
  return rec(
    await fetchJson(`${API}${path}`, {
      ...init,
      headers: {
        ...baseHeaders(ctx.credentials),
        'WM_SEC.ACCESS_TOKEN': t,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    }),
  );
}

const orderLines = (o: Record<string, unknown>) => arr(rec(o.orderLines).orderLine).map(rec);

/** Maps one Walmart purchase order to the channel order shape. */
export function walmartToOrder(o: Record<string, unknown>): ChannelOrder {
  const info = rec(o.shippingInfo);
  const a = rec(info.postalAddress);
  const name = strOrNull(a.name) ?? 'Customer';
  const [firstName, ...rest] = name.split(' ');
  const lines = orderLines(o).map((l) => {
    const item = rec(l.item);
    const qty = num(rec(l.orderLineQuantity).amount);
    const product = arr(rec(l.charges).charge)
      .map(rec)
      .find((c) => c.chargeType === 'PRODUCT');
    const shipped = arr(rec(l.orderLineStatuses).orderLineStatus)
      .map(rec)
      .filter((st) => st.status === 'Shipped')
      .reduce((n, st) => n + num(rec(st.statusQuantity).amount), 0);
    return {
      sku: strOrNull(item.sku),
      title: String(item.productName ?? 'Item'),
      quantity: qty,
      price: num(rec(product?.chargeAmount).amount),
      requiresShipping: true,
      isCustom: false,
      fulfilledQuantity: shipped,
    };
  });
  const placed =
    typeof o.orderDate === 'number'
      ? new Date(o.orderDate).toISOString()
      : String(o.orderDate ?? new Date().toISOString());
  const country = String(a.country ?? 'USA');
  return {
    id: String(o.purchaseOrderId),
    number: String(o.customerOrderId ?? o.purchaseOrderId),
    createdAt: placed,
    updatedAt: placed,
    financialStatus: 'paid',
    tags: [],
    email: strOrNull(o.customerEmailId),
    locationId: strOrNull(rec(o.shipNode).id),
    hasFulfillmentOrders: lines.length > 0,
    shipTo: strOrNull(a.address1)
      ? {
          name,
          firstName: firstName || null,
          lastName: rest.join(' ') || null,
          company: null,
          line1: String(a.address1),
          line2: strOrNull(a.address2),
          city: String(a.city ?? ''),
          state: strOrNull(a.state),
          zip: String(a.postalCode ?? ''),
          country: country === 'USA' || country === 'US' ? 'United States' : country,
          phone: strOrNull(info.phone),
        }
      : null,
    lines,
    totalPrice: lines.reduce((n, l) => n + l.price * l.quantity, 0),
    note: null,
    isGift: false,
    raw: o,
  };
}

async function listOrders(
  ctx: AdapterContext,
  status: string,
  since: string,
): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({ status, createdStartDate: since, limit: '200' });
  const body = await call(ctx, `/v3/orders?${q.toString()}`);
  return arr(rec(rec(body.list).elements).order).map(rec);
}

export const walmartAdapter: ChannelAdapter = {
  key: 'walmart',
  async validate(ctx) {
    await accessToken(ctx.credentials);
    return {
      ok: true,
      message: `Connected to Walmart Marketplace (${ctx.connection.storeName})`,
      locations: [{ id: 'default', name: 'Walmart ship node (default)' }],
    };
  },
  async fetchOrders(ctx, since) {
    const from = since ?? new Date(ctx.now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const created = await listOrders(ctx, 'Created', from);
    for (const o of created) {
      try {
        await call(ctx, `/v3/orders/${encodeURIComponent(String(o.purchaseOrderId))}/acknowledge`, {
          method: 'POST',
        });
      } catch {
        /* acknowledged on the next run */
      }
    }
    const acknowledged = await listOrders(ctx, 'Acknowledged', from);
    const seen = new Set<string>();
    return [...created, ...acknowledged]
      .filter((o) => {
        const id = String(o.purchaseOrderId);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(walmartToOrder);
  },
  async fetchOrdersById(ctx, ids) {
    const out: ChannelOrder[] = [];
    for (const id of ids.slice(0, 50))
      out.push(walmartToOrder(rec((await call(ctx, `/v3/orders/${encodeURIComponent(id)}`)).order)));
    return out;
  },
  async fetchProducts(ctx) {
    return arr((await call(ctx, '/v3/items?limit=200')).ItemResponse)
      .map(rec)
      .map((i) => ({
        id: String(i.wpid ?? i.sku),
        sku: strOrNull(i.sku),
        title: String(i.productName ?? i.sku),
        price: num(rec(i.price).amount),
        barcode: strOrNull(i.upc) ?? strOrNull(i.gtin),
        weightOz: 0,
        imageUrl: null,
      }));
  },
  async pushInventory(ctx, items) {
    const out: { sellerSku: string; ok: boolean; error?: string }[] = [];
    for (const i of items) {
      try {
        await call(ctx, `/v3/inventory?sku=${encodeURIComponent(i.sellerSku)}`, {
          method: 'PUT',
          body: JSON.stringify({ sku: i.sellerSku, quantity: { unit: 'EACH', amount: i.qty } }),
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
    const order = rec((await call(ctx, `/v3/orders/${encodeURIComponent(s.channelOrderId)}`)).order);
    const shipDateTime = Date.now();
    const orderLine = orderLines(order).flatMap((l) => {
      const shipped = s.lines.find((x) => x.sku === rec(l.item).sku);
      if (!shipped) return [];
      return [
        {
          lineNumber: String(l.lineNumber),
          orderLineStatuses: {
            orderLineStatus: [
              {
                status: 'Shipped',
                statusQuantity: { unitOfMeasurement: 'EACH', amount: String(shipped.quantity) },
                trackingInfo: {
                  shipDateTime,
                  carrierName: { carrier: s.carrier },
                  methodCode: 'Standard',
                  trackingNumber: s.trackingNumber,
                },
              },
            ],
          },
        },
      ];
    });
    if (orderLine.length === 0)
      return { ok: false, error: 'None of the shipped SKUs are on the Walmart order' };
    await call(ctx, `/v3/orders/${encodeURIComponent(s.channelOrderId)}/shipping`, {
      method: 'POST',
      body: JSON.stringify({ orderShipment: { orderLines: { orderLine } } }),
    });
    return { ok: true };
  },
};
