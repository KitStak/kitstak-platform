/**
 * End-to-end: starts the real server over stdio and calls every tool through an MCP client.
 *
 * Needs a Postgres with the migrations applied in journal order (apps/crm, packages/db,
 * apps/wms, apps/projects), then test/fixture.sql and sql/readonly-role.sql
 * (tenant_schema=wms_11111111222243338444555555555555). Then:
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
import postgres from 'postgres';

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
      'crm_get_item',
      'crm_list_boards',
      'crm_search_items',
      'org_overview',
      'projects_get_task',
      'projects_list',
      'projects_search_tasks',
      'whoami',
      'wms_get_inventory',
      'wms_get_kit',
      'wms_get_order',
      'wms_list_customers',
      'wms_list_warehouses',
      'wms_list_work_orders',
      'wms_low_stock',
      'wms_order_status_summary',
      'wms_search_orders',
      'wms_search_products',
    ]);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });

  it('reads only the configured organization', async () => {
    const who = await call(client, 'whoami');
    assert.equal(who.data.slug, 'acme-3pl');
    const customers = await call(client, 'wms_list_customers');
    assert.deepEqual(customers.data.map((c: { code: string }) => c.code).sort(), ['FRIDA', 'ONYX']);
    assert.ok(!customers.text.includes('SECRET'));
  });

  it('searches and fetches orders', async () => {
    const open = await call(client, 'wms_search_orders', { status: 'open' });
    assert.deepEqual(
      open.data.map((o: { code: string }) => o.code),
      ['SO-1001'],
    );
    const late = await call(client, 'wms_search_orders', { late_only: true });
    assert.equal(late.data.length, 1);
    const byStore = await call(client, 'wms_get_order', { code: 'SHOP-77' });
    assert.equal(byStore.data.code, 'SO-1001');
    assert.equal(byStore.data.lines[0].sku, 'FR-NOSE');
    assert.equal(byStore.data.id, undefined);
    const missing = await call(client, 'wms_get_order', { code: 'nope' });
    assert.equal(missing.isError, true);
    const summary = await call(client, 'wms_order_status_summary', { by_client: true });
    assert.deepEqual(summary.data, [
      { client: 'FRIDA', status: 'Open', orders: 1, units: 4, past_expected_ship_date: 1 },
    ]);
  });

  it('reports inventory, low stock and kits', async () => {
    const inv = await call(client, 'wms_get_inventory', { sku: 'FR-NOSE' });
    assert.equal(inv.data[0].on_hand, 50);
    assert.equal(inv.data[0].allocated, 4);
    assert.equal(inv.data[0].available, 46);
    assert.equal(inv.data[0].open_order_qty, 4);
    const byLoc = await call(client, 'wms_get_inventory', { sku: 'FR-NOSE', by_location: true });
    assert.equal(byLoc.data.length, 2);
    const low = await call(client, 'wms_low_stock');
    assert.deepEqual(
      low.data.map((r: { sku: string }) => r.sku),
      ['FR-NOSE'],
    );
    const kit = await call(client, 'wms_get_kit', { sku: 'FR-TRAY' });
    assert.equal(kit.data.components.length, 2);
    // 46 NoseFrida / 12 per kit = 3; 3 boxes / 1 per kit = 3.
    assert.equal(kit.data.buildable_from_available_components, 3);
    const products = await call(client, 'wms_search_products', { kits_only: true });
    assert.deepEqual(
      products.data.map((p: { sku: string }) => p.sku),
      ['FR-TRAY'],
    );
    const wos = await call(client, 'wms_list_work_orders', { status: 'Open' });
    assert.equal(wos.data[0].kit_sku, 'FR-TRAY');
  });

  it('treats search text as data, not SQL', async () => {
    const res = await call(client, 'wms_search_products', { query: "x' OR 1=1 --" });
    assert.deepEqual(res.data, []);
    const pct = await call(client, 'wms_search_orders', { query: '%' });
    assert.deepEqual(pct.data, []);
  });

  it('reads the org overview without other orgs or emails', async () => {
    const who = await call(client, 'whoami');
    assert.deepEqual(who.data.apps, ['wms', 'crm', 'projects']);
    const o = await call(client, 'org_overview');
    assert.deepEqual(
      o.data.members.map((m: { name: string }) => m.name),
      ['Josh Hooper', 'Sydney Baker'],
    );
    assert.deepEqual(
      o.data.modules.map((m: { module: string }) => m.module),
      ['crm', 'wms'],
    );
    assert.ok(!o.text.includes('@'));
  });

  it('reads CRM boards and items, hiding private boards and other orgs', async () => {
    const boards = await call(client, 'crm_list_boards');
    assert.deepEqual(
      boards.data.map((b: { name: string }) => b.name),
      ['Accounts', 'Deals'],
    );
    const all = await call(client, 'crm_search_items', {});
    assert.deepEqual(all.data.map((i: { name: string }) => i.name).sort(), ['Frida Baby', 'Frida Q4 trays']);
    const deals = await call(client, 'crm_search_items', { kind: 'deals', query: 'trays' });
    assert.equal(deals.data.length, 1);
    const deal = deals.data[0];
    assert.equal(deal.group, 'Negotiation');
    assert.deepEqual(deal.fields, {
      Stage: 'Won',
      // A user from another org shows as an id, never a name.
      Owner: ['Sydney Baker', 'aaaaaaaa-0000-4000-8000-000000000009'],
      'Deal value': '12000 USD',
      // The linked item on a private board is left out.
      Account: ['Frida Baby'],
    });
    const item = await call(client, 'crm_get_item', { item_id: deal.id });
    assert.deepEqual(
      item.data.subitems.map((x: { name: string }) => x.name),
      ['Send quote'],
    );
    assert.deepEqual(
      item.data.linked.map((x: { name: string }) => x.name),
      ['Frida Baby'],
    );
    assert.equal(item.data.latest_updates[0].text, 'Called Ashley, trays confirmed');
    assert.equal(item.data.latest_updates[0].author, 'Sydney Baker');
    for (const hidden of [
      'eeeeeeee-0000-4000-8000-000000000003',
      'eeeeeeee-0000-4000-8000-000000000004',
      'eeeeeeee-0000-4000-8000-000000000009',
    ]) {
      assert.equal((await call(client, 'crm_get_item', { item_id: hidden })).isError, true, hidden);
    }
    const leak = await call(client, 'crm_search_items', { query: 'secret' });
    assert.deepEqual(leak.data, []);
    // Text search looks at string values, never at JSON keys of stored cells.
    const keys = await call(client, 'crm_search_items', { query: 'labelId' });
    assert.deepEqual(keys.data, []);
  });

  it('reads projects and tasks, hiding private projects and other orgs', async () => {
    const projects = await call(client, 'projects_list');
    assert.deepEqual(projects.data, [
      {
        key: 'OPS',
        name: 'Logiwa go-live',
        kind: 'project',
        status: 'active',
        health: 'on_track',
        health_note: null,
        owner: 'Sydney Baker',
        start_date: null,
        due_date: '2026-12-01',
        open_tasks: 1,
        done_tasks: 1,
        overdue_tasks: 1,
      },
    ]);
    const open = await call(client, 'projects_search_tasks', {});
    assert.deepEqual(
      open.data.map((t: { task: string }) => t.task),
      ['OPS-1', 'OPS-3'],
    );
    const josh = await call(client, 'projects_search_tasks', { assignee: 'josh', overdue_only: true });
    assert.deepEqual(
      josh.data.map((t: { task: string }) => t.task),
      ['OPS-1'],
    );
    const task = await call(client, 'projects_get_task', { task: 'ops-1' });
    assert.equal(task.data.description, 'All three clients');
    assert.equal(task.data.milestone, 'UAT');
    assert.deepEqual(
      task.data.subtasks.map((t: { task: string }) => t.task),
      ['OPS-3'],
    );
    assert.equal(task.data.latest_comments[0].author, 'Josh Hooper');
    assert.equal((await call(client, 'projects_get_task', { task: 'HR-1' })).isError, true);
    assert.equal((await call(client, 'projects_get_task', { task: 'PLT-1' })).isError, true);
    const leak = await call(client, 'projects_search_tasks', { query: 'secret', status: 'todo' });
    assert.deepEqual(leak.data, []);
  });

  it('shows private boards and projects only when asked', async () => {
    const all = await start({
      KITSTAK_MCP_DATABASE_URL: roleUrl!,
      KITSTAK_MCP_ORG: 'acme-3pl',
      KITSTAK_MCP_INCLUDE_PRIVATE: '1',
    });
    try {
      const boards = await call(all, 'crm_list_boards');
      assert.deepEqual(boards.data.map((b: { name: string }) => b.name).sort(), [
        'Accounts',
        'Comp Plans',
        'Deals',
        'Private Deals',
      ]);
      const projects = await call(all, 'projects_list');
      assert.deepEqual(projects.data.map((p: { key: string }) => p.key).sort(), ['HR', 'OPS']);
    } finally {
      await all.close();
    }
  });

  it(
    'offers only the apps the role was granted',
    { skip: !adminUrl && 'KITSTAK_MCP_TEST_ADMIN_URL not set' },
    async () => {
      const admin = postgres(adminUrl!, { onnotice: () => {} });
      try {
        await admin
          .unsafe(
            `
        DROP OWNED BY kitstak_mcp_wms_only;
        DROP ROLE IF EXISTS kitstak_mcp_wms_only;`,
          )
          .catch(() => admin.unsafe('DROP ROLE IF EXISTS kitstak_mcp_wms_only'));
        await admin.unsafe(`
        CREATE ROLE kitstak_mcp_wms_only LOGIN BYPASSRLS PASSWORD 'wmsonly';
        GRANT USAGE ON SCHEMA core TO kitstak_mcp_wms_only;
        GRANT SELECT ON core.organization, core.wms_tenants TO kitstak_mcp_wms_only;
        GRANT USAGE ON SCHEMA wms_11111111222243338444555555555555 TO kitstak_mcp_wms_only;
        GRANT SELECT ON ALL TABLES IN SCHEMA wms_11111111222243338444555555555555 TO kitstak_mcp_wms_only;`);
      } finally {
        await admin.end();
      }
      const url = new URL(roleUrl!);
      url.username = 'kitstak_mcp_wms_only';
      url.password = 'wmsonly';
      const wmsOnly = await start({ KITSTAK_MCP_DATABASE_URL: url.toString(), KITSTAK_MCP_ORG: 'acme-3pl' });
      try {
        const { tools } = await wmsOnly.listTools();
        assert.ok(
          tools.every((t) => t.name === 'whoami' || t.name.startsWith('wms_')),
          tools.map((t) => t.name).join(),
        );
      } finally {
        await wmsOnly.close();
      }
    },
  );

  it('narrows to the configured clients', async () => {
    const narrow = await start({
      KITSTAK_MCP_DATABASE_URL: roleUrl!,
      KITSTAK_MCP_ORG: 'acme-3pl',
      KITSTAK_MCP_CLIENTS: 'ONYX',
    });
    try {
      const customers = await call(narrow, 'wms_list_customers');
      assert.deepEqual(
        customers.data.map((c: { code: string }) => c.code),
        ['ONYX'],
      );
      const orders = await call(narrow, 'wms_search_orders', {});
      assert.deepEqual(
        orders.data.map((o: { code: string }) => o.code),
        ['SO-1002'],
      );
      const frida = await call(narrow, 'wms_get_order', { code: 'SO-1001' });
      assert.equal(frida.isError, true);
      const inv = await call(narrow, 'wms_get_inventory', { query: 'FR' });
      assert.equal(inv.isError, true);
    } finally {
      await narrow.close();
    }
  });

  it(
    'grants the role no secrets',
    { skip: !adminUrl && 'KITSTAK_MCP_TEST_ADMIN_URL not set' },
    async () => {
      const admin = postgres(adminUrl!, { onnotice: () => {} });
      try {
        const T = 'wms_11111111222243338444555555555555';
        const [row] = await admin<Record<string, boolean>[]>`
          SELECT
            has_table_privilege('kitstak_mcp_ro', ${`${T}.clients`}, 'SELECT') AS clients,
            has_table_privilege('kitstak_mcp_ro', ${`${T}.users`}, 'SELECT') AS users,
            has_table_privilege('kitstak_mcp_ro', ${`${T}.user_sessions`}, 'SELECT') AS sessions,
            has_table_privilege('kitstak_mcp_ro', ${`${T}.password_reset_tokens`}, 'SELECT') AS reset_tokens,
            has_table_privilege('kitstak_mcp_ro', ${`${T}.channel_connections`}, 'SELECT') AS channels,
            has_column_privilege('kitstak_mcp_ro', 'core.entitlements', 'stripe_subscription_id', 'SELECT') AS stripe_sub,
            has_column_privilege('kitstak_mcp_ro', 'core.entitlements', 'module', 'SELECT') AS module,
            has_column_privilege('kitstak_mcp_ro', 'core.organization', 'metadata', 'SELECT') AS org_metadata`;
        assert.deepEqual(row, {
          clients: true,
          users: false,
          sessions: false,
          reset_tokens: false,
          channels: false,
          stripe_sub: false,
          module: true,
          org_metadata: false,
        });
      } finally {
        await admin.end();
      }
    },
  );

  it(
    'refuses a role that can write',
    { skip: !adminUrl && 'KITSTAK_MCP_TEST_ADMIN_URL not set' },
    async () => {
      await assert.rejects(start({ KITSTAK_MCP_DATABASE_URL: adminUrl!, KITSTAK_MCP_ORG: 'acme-3pl' }));
    },
  );
});
