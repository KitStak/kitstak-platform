/**
 * End-to-end: starts the real server over stdio and calls every tool through an MCP client.
 *
 * Needs a Postgres with the WMS + core migrations, test/fixture.sql and sql/readonly-role.sql
 * applied (tenant_schema=wms_11111111222243338444555555555555). Then:
 *
 *   KITSTAK_MCP_TEST_DATABASE_URL=postgres://kitstak_mcp_ro:<pw>@localhost:5432/<db> \
 *   KITSTAK_MCP_TEST_ADMIN_URL=postgres://postgres@localhost:5432/<db> npm test
 *
 * Skipped when KITSTAK_MCP_TEST_DATABASE_URL is unset.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const roleUrl = process.env.KITSTAK_MCP_TEST_DATABASE_URL;
const adminUrl = process.env.KITSTAK_MCP_TEST_ADMIN_URL;
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

async function start(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    env: { PATH: process.env.PATH ?? '', ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'kitstak-mcp-test', version: '0' });
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

describe('kitstak-mcp', { skip: !roleUrl && 'KITSTAK_MCP_TEST_DATABASE_URL not set' }, () => {
  let client: Client;
  before(async () => {
    client = await start({ KITSTAK_MCP_DATABASE_URL: roleUrl!, KITSTAK_MCP_ORG: 'acme-3pl' });
  });
  after(async () => {
    await client?.close();
  });

  it('exposes only read-only tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'get_inventory',
      'get_kit',
      'get_order',
      'list_customers',
      'list_warehouses',
      'list_work_orders',
      'low_stock',
      'order_status_summary',
      'search_orders',
      'search_products',
      'whoami',
    ]);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });

  it('reads only the configured organization', async () => {
    const who = await call(client, 'whoami');
    assert.equal(who.data.slug, 'acme-3pl');
    const customers = await call(client, 'list_customers');
    assert.deepEqual(customers.data.map((c: { code: string }) => c.code).sort(), ['FRIDA', 'ONYX']);
    assert.ok(!customers.text.includes('SECRET'));
  });

  it('searches and fetches orders', async () => {
    const open = await call(client, 'search_orders', { status: 'open' });
    assert.deepEqual(
      open.data.map((o: { code: string }) => o.code),
      ['SO-1001'],
    );
    const late = await call(client, 'search_orders', { late_only: true });
    assert.equal(late.data.length, 1);
    const byStore = await call(client, 'get_order', { code: 'SHOP-77' });
    assert.equal(byStore.data.code, 'SO-1001');
    assert.equal(byStore.data.lines[0].sku, 'FR-NOSE');
    assert.equal(byStore.data.id, undefined);
    const missing = await call(client, 'get_order', { code: 'nope' });
    assert.equal(missing.isError, true);
    const summary = await call(client, 'order_status_summary', { by_client: true });
    assert.deepEqual(summary.data, [
      { client: 'FRIDA', status: 'Open', orders: 1, units: 4, past_expected_ship_date: 1 },
    ]);
  });

  it('reports inventory, low stock and kits', async () => {
    const inv = await call(client, 'get_inventory', { sku: 'FR-NOSE' });
    assert.equal(inv.data[0].on_hand, 50);
    assert.equal(inv.data[0].allocated, 4);
    assert.equal(inv.data[0].available, 46);
    assert.equal(inv.data[0].open_order_qty, 4);
    const byLoc = await call(client, 'get_inventory', { sku: 'FR-NOSE', by_location: true });
    assert.equal(byLoc.data.length, 2);
    const low = await call(client, 'low_stock');
    assert.deepEqual(
      low.data.map((r: { sku: string }) => r.sku),
      ['FR-NOSE'],
    );
    const kit = await call(client, 'get_kit', { sku: 'FR-TRAY' });
    assert.equal(kit.data.components.length, 2);
    // 46 NoseFrida / 12 per kit = 3; 3 boxes / 1 per kit = 3.
    assert.equal(kit.data.buildable_from_available_components, 3);
    const products = await call(client, 'search_products', { kits_only: true });
    assert.deepEqual(
      products.data.map((p: { sku: string }) => p.sku),
      ['FR-TRAY'],
    );
    const wos = await call(client, 'list_work_orders', { status: 'Open' });
    assert.equal(wos.data[0].kit_sku, 'FR-TRAY');
  });

  it('treats search text as data, not SQL', async () => {
    const res = await call(client, 'search_products', { query: "x' OR 1=1 --" });
    assert.deepEqual(res.data, []);
    const pct = await call(client, 'search_orders', { query: '%' });
    assert.deepEqual(pct.data, []);
  });

  it('narrows to the configured clients', async () => {
    const narrow = await start({
      KITSTAK_MCP_DATABASE_URL: roleUrl!,
      KITSTAK_MCP_ORG: 'acme-3pl',
      KITSTAK_MCP_CLIENTS: 'ONYX',
    });
    try {
      const customers = await call(narrow, 'list_customers');
      assert.deepEqual(
        customers.data.map((c: { code: string }) => c.code),
        ['ONYX'],
      );
      const orders = await call(narrow, 'search_orders', {});
      assert.deepEqual(
        orders.data.map((o: { code: string }) => o.code),
        ['SO-1002'],
      );
      const frida = await call(narrow, 'get_order', { code: 'SO-1001' });
      assert.equal(frida.isError, true);
      const inv = await call(narrow, 'get_inventory', { query: 'FR' });
      assert.equal(inv.isError, true);
    } finally {
      await narrow.close();
    }
  });

  it(
    'refuses a role that can write',
    { skip: !adminUrl && 'KITSTAK_MCP_TEST_ADMIN_URL not set' },
    async () => {
      await assert.rejects(start({ KITSTAK_MCP_DATABASE_URL: adminUrl!, KITSTAK_MCP_ORG: 'acme-3pl' }));
    },
  );
});
