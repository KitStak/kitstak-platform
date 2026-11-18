/**
 * A local stand-in for the Logiwa iO API, built from the field names in Logiwa's public docs.
 * Like the real API might, it ignores unknown filter parameters by default, so tests prove that
 * rows are filtered locally. It records every request so tests can check nothing but reads happen.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const EXPLORE = '11111111-1111-4111-8111-111111111111';
export const ULTRA = '22222222-2222-4222-8222-222222222222';
export const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
export const EMAIL = 'api@example.com';
export const PASSWORD = 'correct horse';

const statuses = ['Open', 'ReadyToPick', 'Shipped', 'Cancelled', 'ReadyToShip'];

export const orders = Array.from({ length: 250 }, (_, i) => {
  const explore = i % 5 !== 4;
  return {
    identifier: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
    code: `SO-${1000 + i}`,
    channelOrderNumber: `#${5000 + i}`,
    clientIdentifier: explore ? EXPLORE : ULTRA,
    clientDisplayName: explore ? 'Explore Scientific' : 'Ultra',
    warehouseCode: 'BENT1',
    shipmentOrderStatusName: statuses[i % statuses.length],
    shipmentOrderDate: `2026-11-${String(1 + (i % 17)).padStart(2, '0')}T10:00:00`,
    customerFullName: `Customer ${i}`,
    carrierName: 'FedEx',
    totalQuantity: 2,
    billingAddressEmail: null,
    products: [
      {
        productSKU: i % 2 ? 'VIEW-10X' : 'SCOPE-80',
        productName: 'Thing',
        quantity: 2,
        shippedUOMQuantity: 0,
      },
    ],
  };
});

const clients = [
  { identifier: EXPLORE, name: 'Explore Scientific', code: 'ESO', integrationPassword: 'hunter2' },
  { identifier: ULTRA, name: 'Ultra', code: 'ULTRA' },
];
const warehouses = [{ identifier: WAREHOUSE, code: 'BENT1', name: 'Bentonville' }];
const inventory = [
  {
    clientIdentifier: EXPLORE,
    productSKU: 'SCOPE-80',
    locationCode: 'A-01-01',
    quantity: 40,
    warehouseIdentifier: WAREHOUSE,
  },
  {
    clientIdentifier: EXPLORE,
    productSKU: 'VIEW-10X',
    locationCode: 'A-01-02',
    quantity: 12,
    warehouseIdentifier: WAREHOUSE,
  },
  {
    clientIdentifier: ULTRA,
    productSKU: 'ULT-1',
    locationCode: 'B-02-01',
    quantity: 7,
    warehouseIdentifier: WAREHOUSE,
  },
];

export interface MockState {
  requests: { method: string; path: string; query: Record<string, string>; auth?: string }[];
  logins: number;
  rejectFilters: boolean;
  expireNextToken: boolean;
}

export async function startMock(): Promise<{ url: string; state: MockState; close: () => Promise<void> }> {
  const state: MockState = { requests: [], logins: 0, rejectFilters: false, expireNextToken: false };
  let validToken = '';

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const query = Object.fromEntries(url.searchParams);
    state.requests.push({
      method: req.method ?? '',
      path: url.pathname,
      query,
      auth: req.headers.authorization,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/v3.1/Authorize/token') {
      const body = JSON.parse((await readAll(req)) || '{}');
      if (body.email !== EMAIL || body.password !== PASSWORD)
        return send(401, { message: 'Invalid credentials' });
      state.logins++;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      validToken = `h.${Buffer.from(JSON.stringify({ exp, n: state.logins })).toString('base64url')}.s`;
      return send(200, { token: validToken });
    }
    if (req.method !== 'GET') return send(405, { message: 'Only GET in this mock' });
    if (req.headers.authorization !== `Bearer ${validToken}` || state.expireNextToken) {
      state.expireNextToken = false;
      return send(401, { message: 'Unauthorized' });
    }
    if (state.rejectFilters && Object.keys(query).length > 0) return send(400, { message: 'Bad filter' });

    const list = url.pathname.match(/^(\/v3\.1\/.+\/list|\/v3\.1\/Report\/\w+)\/i\/(\d+)\/s\/(\d+)$/);
    if (list) {
      const [, base, i, s] = list;
      const all: unknown[] =
        base === '/v3.1/ShipmentOrder/list'
          ? orders
          : base === '/v3.1/Client/list'
            ? clients
            : base === '/v3.1/Warehouse/list'
              ? warehouses
              : base === '/v3.1/Inventory/list' || base === '/v3.1/Report/TotalInventory'
                ? inventory
                : [];
      const start = Number(i) * Number(s);
      return send(200, { data: all.slice(start, start + Number(s)), totalCount: all.length });
    }
    const one = url.pathname.match(/^\/v3\.1\/ShipmentOrder\/([0-9a-f-]+)$/);
    if (one) {
      const found = orders.find((o) => o.identifier === one[1]);
      return found ? send(200, { data: found }) : send(404, { message: 'Not found' });
    }
    return send(404, { message: 'Not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
