import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { getPath, isAllowedGet, listPath } from '../src/endpoints.js';
import { LogiwaClient, toPage, toRecord } from '../src/client.js';
import { redact } from '../src/util.js';

describe('config', () => {
  it('refuses to start without credentials', () => {
    assert.throws(() => loadConfig({}), /No Logiwa credentials/);
    assert.throws(() => loadConfig({ LOGIWA_MCP_EMAIL: 'a@b.c' }), /No Logiwa credentials/);
  });
  it('ignores other scripts’ Logiwa variables', () => {
    assert.throws(() => loadConfig({ LOGIWA_TOKEN: 'x', LOGIWA_COOKIE: 'y' }), /No Logiwa credentials/);
  });
  it('requires https except for a local mock', () => {
    const creds = { LOGIWA_MCP_TOKEN: 't' };
    assert.throws(() => loadConfig({ ...creds, LOGIWA_MCP_BASE_URL: 'http://myapi.logiwa.com' }), /https/);
    assert.throws(
      () => loadConfig({ ...creds, LOGIWA_MCP_BASE_URL: 'https://u:p@myapi.logiwa.com' }),
      /plain host/,
    );
    assert.equal(
      loadConfig({ ...creds, LOGIWA_MCP_BASE_URL: 'http://127.0.0.1:9' }).baseUrl,
      'http://127.0.0.1:9',
    );
    assert.equal(loadConfig(creds).baseUrl, 'https://myapi.logiwa.com');
  });
  it('caps the page size and lowercases client ids', () => {
    const c = loadConfig({
      LOGIWA_MCP_TOKEN: 't',
      LOGIWA_MCP_PAGE_SIZE: '999',
      LOGIWA_MCP_CLIENTS: ' ABC , def ',
    });
    assert.equal(c.pageSize, 200);
    assert.deepEqual(c.clients, ['abc', 'def']);
  });
});

describe('read-only path guard', () => {
  it('allows only list and get reads', () => {
    assert.ok(isAllowedGet(listPath('shipmentOrders', 0, 50)));
    assert.ok(isAllowedGet('/v3.1/Report/TotalInventory/i/2/s/200'));
    assert.ok(isAllowedGet(getPath('shipmentOrders', 'aaaaaaaa-0000-4000-8000-000000000001')));
    for (const bad of [
      '/v3.1/ShipmentOrder/create',
      '/v3.1/ShipmentOrder/create/bulk',
      '/v3.1/ShipmentOrder/patch/abc',
      '/v3.1/ShipmentOrder/cancel',
      '/v3.1/Inventory/adjust',
      '/v3.1/Product/update',
      '/v3.1/PurchaseOrder/receive',
      '/v3.1/ShipmentOrder/list/i/0/s/10/../../create',
      '/v3.1/Webhook/subscribe',
      '/v3.1/Authorize/token',
    ]) {
      assert.equal(isAllowedGet(bad), false, bad);
    }
  });
  it('rejects action words and path tricks as identifiers', () => {
    for (const id of ['create', 'Update', 'ship', '..', 'a/b', 'a?b=1', '']) {
      assert.throws(() => getPath('shipmentOrders', id), id);
    }
    assert.throws(() => getPath('inventory', 'abc'), /no single-record/);
  });
  it('never sends a blocked request', async () => {
    let calls = 0;
    const client = new LogiwaClient(loadConfig({ LOGIWA_MCP_TOKEN: 't' }), (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch);
    await assert.rejects(client.get('/v3.1/ShipmentOrder/create'), /Blocked/);
    assert.equal(calls, 0);
  });
});

describe('envelopes', () => {
  it('reads rows and totals from common shapes', () => {
    assert.deepEqual(toPage([{ a: 1 }]), { rows: [{ a: 1 }], total: null });
    assert.deepEqual(toPage({ data: [{ a: 1 }], totalCount: 9 }), { rows: [{ a: 1 }], total: 9 });
    assert.deepEqual(toPage({ Data: [{ a: 1, RecordCount: 4 }] }), {
      rows: [{ a: 1, RecordCount: 4 }],
      total: 4,
    });
    assert.deepEqual(toPage({ data: { items: [{ a: 1 }], total: 3 } }), { rows: [{ a: 1 }], total: 3 });
    assert.deepEqual(toRecord({ data: { a: 1 } }), { a: 1 });
    assert.deepEqual(toRecord({ a: 1 }), { a: 1 });
  });
  it('redacts secret-looking fields at any depth', () => {
    assert.deepEqual(redact({ a: 1, password: 'x', nested: [{ apiKey: 'k', b: 2 }] }), {
      a: 1,
      password: '[redacted]',
      nested: [{ apiKey: '[redacted]', b: 2 }],
    });
  });
});
