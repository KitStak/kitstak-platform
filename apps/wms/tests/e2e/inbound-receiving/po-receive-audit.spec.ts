/**
 * M05 round 6 integration (real API routes against the dev server): Actual Receiving Date
 * audit trail for "receive 1 (operator), receive 1 (admin), receive all". Partial receipts
 * write no Actual Receiving Date entry; completion writes exactly one "(empty) --> <date>".
 * Also covers the packType default (omitted -> product base pack type) and the suggest
 * route without lineId.
 *
 * Creates KS-TEST-E2E-AUD-* records on the shared dev DB (Copperline · MLT1).
 * Run: npx playwright test tests/e2e/inbound-receiving/po-receive-audit.spec.ts --project=e2e --no-deps
 */
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { e2eBaseUrl, storageStatePath } from '../fixtures/roles';

const SKU = 'CPL-MUG-12OZ';

async function api(role: 'admin' | 'operator'): Promise<{ c: APIRequestContext; h: Record<string, string> }> {
  const c = await pwRequest.newContext({
    baseURL: e2eBaseUrl(),
    storageState: storageStatePath(role),
    timeout: 120_000,
  });
  // Same-origin header: the CSRF token is retired (blueprint §1.4).
  return { c, h: { Origin: e2eBaseUrl() } };
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ((await res.json()) as { data: T }).data;
}

test('receive 1, receive 1, receive all: one Actual Receiving Date entry at completion', async () => {
  test.setTimeout(240_000);
  const admin = await api('admin');
  const op = await api('operator');
  const product = (
    await json<{ id: string; clientId: string }[]>(await admin.c.get(`/api/products?q=${SKU}&ps=5`))
  ).find(Boolean);
  expect(product).toBeTruthy();
  const whs = await json<{ id: string; code: string }[]>(await admin.c.get('/api/warehouses?q=MLT1&ps=10'));
  const wh = whs.find((w) => w.code === 'MLT1');
  expect(wh).toBeTruthy();
  const vendor = (
    await json<{ id: string }[]>(
      await admin.c.get(`/api/vendors?ps=1&clientId=${product?.clientId}&active=1`),
    )
  )[0];
  expect(vendor).toBeTruthy();

  // packType omitted: defaults to the product's base pack type (no 400).
  const po = await json<{ id: string; lines: { id: string; packType: string }[] }>(
    await admin.c.post('/api/purchase-orders', {
      headers: admin.h,
      data: {
        warehouseId: wh?.id,
        clientId: product?.clientId,
        vendorId: vendor?.id,
        code: `KS-TEST-E2E-AUD-${Date.now().toString(36).toUpperCase()}`,
        poType: 'Purchase Order',
        poDate: new Date().toISOString(),
        lines: [{ productId: product?.id, orderedQuantity: 5, unitCost: 1 }],
      },
    }),
  );
  const lineId = po.lines[0]?.id ?? '';
  expect(po.lines[0]?.packType).toBeTruthy();

  // Suggest without lineId: a suggestion per open line, not a raw validation message.
  const sugg = await json<{ lines: { lineId: string; remaining: number }[] }>(
    await admin.c.get(`/api/purchase-orders/${po.id}/suggest`),
  );
  expect(sugg.lines.map((l) => l.lineId)).toEqual([lineId]);

  const detail = await json<{ defaultReceivingLocation: { id: string } | null }>(
    await admin.c.get(`/api/purchase-orders/${po.id}`),
  );
  const locationId = detail.defaultReceivingLocation?.id ?? '';
  expect(locationId).toBeTruthy();
  const one = { lines: [{ lineId, quantity: 1, locationId }] };
  await json(await op.c.post(`/api/purchase-orders/${po.id}/receive`, { headers: op.h, data: one }));
  await json(await admin.c.post(`/api/purchase-orders/${po.id}/receive`, { headers: admin.h, data: one }));

  const logPath = `/api/change-log?entityType=purchase_order&entityId=${po.id}&ps=100`;
  type Entry = { field: string | null; fromValue: string | null; message: string };
  const partial = await json<Entry[]>(await admin.c.get(logPath));
  expect(partial.filter((e) => e.field === 'receivedAt')).toEqual([]);

  const done = await json<{ status: string }>(
    await admin.c.post(`/api/purchase-orders/${po.id}/receive`, { headers: admin.h, data: { all: true } }),
  );
  expect(done.status).toBe('Completed');
  const entries = (await json<Entry[]>(await admin.c.get(logPath))).filter((e) => e.field === 'receivedAt');
  expect(entries).toHaveLength(1);
  expect(entries[0]?.fromValue).toBe('(empty)');
  expect(entries[0]?.message).toMatch(
    /^Actual Receiving Date is modified\. \(empty\) --> \d{4}\/\d{2}\/\d{2} /,
  );
  await admin.c.dispose();
  await op.c.dispose();
});
