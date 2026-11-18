/**
 * End to end: starts the real server over stdio against a local mock of the Logiwa iO API and
 * calls every tool through an MCP client. No network or Logiwa account needed.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EMAIL, EXPLORE, PASSWORD, startMock, ULTRA, WAREHOUSE, type MockState } from './mock-logiwa.js';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

async function start(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    env: { PATH: process.env.PATH ?? '', ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'logiwa-mcp-test', version: '0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content[0]?.text ?? '';
  return { isError: res.isError === true, text, data: res.isError ? undefined : JSON.parse(text) };
}

/** Runs the server until it exits (async, so an in-process mock can still answer it). */
function runStartup(env: Record<string, string>): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('exit', (status) => {
      clearTimeout(timer);
      resolve({ status, stderr });
    });
  });
}

describe('logiwa-mcp', () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  let state: MockState;
  let client: Client;

  before(async () => {
    mock = await startMock();
    state = mock.state;
    client = await start({
      LOGIWA_MCP_BASE_URL: mock.url,
      LOGIWA_MCP_EMAIL: EMAIL,
      LOGIWA_MCP_PASSWORD: PASSWORD,
    });
  });
  after(async () => {
    await client?.close();
    await mock?.close();
  });

  it('exposes only read-only tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'logiwa_available_to_promise',
      'logiwa_get_order',
      'logiwa_get_product',
      'logiwa_get_purchase_order',
      'logiwa_inventory_totals',
      'logiwa_list_clients',
      'logiwa_list_inventory',
      'logiwa_list_products',
      'logiwa_list_purchase_orders',
      'logiwa_list_warehouses',
      'logiwa_order_status_summary',
      'logiwa_receiving_history',
      'logiwa_search_orders',
      'logiwa_shipment_history',
      'logiwa_whoami',
    ]);
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, t.name);
      assert.equal(t.annotations?.destructiveHint, false, t.name);
    }
  });

  it('says what it reads, with no secrets', async () => {
    const { data, text } = await call(client, 'logiwa_whoami');
    assert.equal(data.readOnly, true);
    assert.equal(data.host, new URL(mock.url).host);
    assert.ok(!text.includes(PASSWORD) && !text.includes(EMAIL));
  });

  it('lists clients and redacts secret fields', async () => {
    const { data, text } = await call(client, 'logiwa_list_clients');
    assert.equal(data.returned, 2);
    assert.ok(!text.includes('hunter2'));
    assert.equal((await call(client, 'logiwa_list_clients', { query: 'explore' })).data.returned, 1);
  });

  it('lists warehouses', async () => {
    const { data } = await call(client, 'logiwa_list_warehouses');
    assert.equal(data.rows[0].identifier, WAREHOUSE);
  });

  it('filters orders locally even when Logiwa ignores the filter', async () => {
    const { data } = await call(client, 'logiwa_search_orders', { client: ULTRA, page_size: 200 });
    assert.ok(data.returned > 0);
    assert.ok(data.rows.every((r: { clientIdentifier: string }) => r.clientIdentifier === ULTRA));
    const sent = state.requests.at(-1)!;
    assert.equal(sent.query['ClientIdentifier.eq'], ULTRA);
    assert.equal(sent.path, '/v3.1/ShipmentOrder/list/i/0/s/200');
  });

  it('supports open status, names, SKU and date filters', async () => {
    const open = (await call(client, 'logiwa_search_orders', { status: 'open', page_size: 200 })).data;
    assert.ok(
      open.rows.every(
        (r: { shipmentOrderStatusName: string }) =>
          !['Shipped', 'Cancelled'].includes(r.shipmentOrderStatusName),
      ),
    );
    const named = (
      await call(client, 'logiwa_search_orders', {
        client: 'explore',
        status: 'Ready To Pick',
        page_size: 200,
      })
    ).data;
    assert.ok(named.returned > 0);
    assert.ok(
      named.rows.every(
        (r: { clientDisplayName: string; shipmentOrderStatusName: string }) =>
          r.clientDisplayName === 'Explore Scientific' && r.shipmentOrderStatusName === 'ReadyToPick',
      ),
    );
    const sku = (
      await call(client, 'logiwa_search_orders', {
        sku: 'VIEW-10X',
        from: '2026-11-05',
        to: '2026-11-06',
        page_size: 200,
        full: true,
      })
    ).data;
    assert.ok(sku.returned > 0);
    assert.ok(
      sku.rows.every(
        (r: { products: { productSKU: string }[]; shipmentOrderDate: string }) =>
          r.products[0]!.productSKU === 'VIEW-10X' &&
          r.shipmentOrderDate >= '2026-11-05' &&
          r.shipmentOrderDate < '2026-11-07',
      ),
    );
  });

  it('pages with a 1-based page number', async () => {
    const { data } = await call(client, 'logiwa_search_orders', { page: 2, page_size: 200 });
    assert.equal(data.totalInLogiwa, 250);
    assert.equal(data.returned, 50);
    assert.equal(state.requests.at(-1)!.path, '/v3.1/ShipmentOrder/list/i/1/s/200');
  });

  it('gets one order by identifier or by code, with lines', async () => {
    const byId = (await call(client, 'logiwa_get_order', { id: 'aaaaaaaa-0000-4000-8000-000000000003' }))
      .data;
    assert.equal(byId.code, 'SO-1003');
    assert.equal(byId.lines[0].productSKU, 'VIEW-10X');
    const byCode = (await call(client, 'logiwa_get_order', { id: 'SO-1007' })).data;
    assert.equal(byCode.identifier, 'aaaaaaaa-0000-4000-8000-000000000007');
    assert.equal((await call(client, 'logiwa_get_order', { id: 'create' })).isError, true);
  });

  it('counts orders by status across pages', async () => {
    const { data } = await call(client, 'logiwa_order_status_summary', { client: EXPLORE });
    assert.equal(data.complete, true);
    assert.equal(data.ordersCounted, 200);
    assert.equal(data.byStatus.Shipped.orders, 50);
    assert.equal(data.openOrders, 100);
    assert.deepEqual(Object.keys(data.byClient), ['Explore Scientific']);
  });

  it('reads inventory by client, SKU and location', async () => {
    const all = (await call(client, 'logiwa_list_inventory', { client: EXPLORE })).data;
    assert.equal(all.returned, 2);
    const loc = (await call(client, 'logiwa_list_inventory', { location: 'B-02-01' })).data;
    assert.equal(loc.rows[0].productSKU, 'ULT-1');
    const totals = (await call(client, 'logiwa_inventory_totals', { sku: 'SCOPE-80' })).data;
    assert.equal(totals.returned, 1);
  });

  it('answers the other list tools', async () => {
    for (const name of [
      'logiwa_available_to_promise',
      'logiwa_list_products',
      'logiwa_list_purchase_orders',
      'logiwa_shipment_history',
      'logiwa_receiving_history',
    ]) {
      const res = await call(client, name, { client: EXPLORE, from: '2026-11-01', to: '2026-11-30' });
      assert.equal(res.isError, false, `${name}: ${res.text}`);
    }
  });

  it('falls back to local filtering when Logiwa rejects the filter syntax', async () => {
    state.rejectFilters = true;
    try {
      const { data } = await call(client, 'logiwa_search_orders', { client: ULTRA, page_size: 200 });
      assert.ok(data.rows.every((r: { clientIdentifier: string }) => r.clientIdentifier === ULTRA));
      assert.match(data.notes.join(' '), /filtered locally/);
    } finally {
      state.rejectFilters = false;
    }
  });

  it('logs in again when the token expires', async () => {
    const before = state.logins;
    state.expireNextToken = true;
    const res = await call(client, 'logiwa_list_warehouses');
    assert.equal(res.isError, false);
    assert.equal(state.logins, before + 1);
  });

  it('only ever logs in and reads', () => {
    for (const r of state.requests) {
      if (r.method === 'POST') assert.equal(r.path, '/v3.1/Authorize/token');
      else assert.equal(r.method, 'GET', `${r.method} ${r.path}`);
    }
  });
});

describe('client narrowing', () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  let client: Client;
  before(async () => {
    mock = await startMock();
    client = await start({
      LOGIWA_MCP_BASE_URL: mock.url,
      LOGIWA_MCP_EMAIL: EMAIL,
      LOGIWA_MCP_PASSWORD: PASSWORD,
      LOGIWA_MCP_CLIENTS: EXPLORE,
    });
  });
  after(async () => {
    await client?.close();
    await mock?.close();
  });

  it('never shows another client', async () => {
    const orders = (await call(client, 'logiwa_search_orders', { page_size: 200 })).data;
    assert.ok(orders.rows.every((r: { clientIdentifier: string }) => r.clientIdentifier === EXPLORE));
    assert.equal(mock.state.requests.at(-1)!.query['ClientIdentifier.eq'], EXPLORE);
    assert.equal((await call(client, 'logiwa_search_orders', { client: ULTRA })).isError, true);
    assert.equal(
      (await call(client, 'logiwa_get_order', { id: 'aaaaaaaa-0000-4000-8000-000000000004' })).isError,
      true,
    );
    assert.equal((await call(client, 'logiwa_list_clients')).data.returned, 1);
    const inv = (await call(client, 'logiwa_list_inventory', { location: 'B-02-01' })).data;
    assert.equal(inv.returned, 0);
  });
});

describe('startup', () => {
  it('refuses to start without credentials', async () => {
    const r = await runStartup({});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /No Logiwa credentials/);
  });

  it('refuses a wrong password and does not print it', async () => {
    const mock = await startMock();
    try {
      const r = await runStartup({
        LOGIWA_MCP_BASE_URL: mock.url,
        LOGIWA_MCP_EMAIL: EMAIL,
        LOGIWA_MCP_PASSWORD: 'wrong-pass-123',
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /login failed/);
      assert.ok(!r.stderr.includes('wrong-pass-123'));
    } finally {
      await mock.close();
    }
  });
});
