/**
 * M05 round 8 integration (real API routes against the dev server):
 *   - a receive line without `locationId` is received into MLT1's default receiving location;
 *   - field errors on the receive API are specific (`lines.0.quantity`), never a generic union error;
 *   - Completed -> Started re-opens the PO (stamps cleared, logged) and its receipt can be cancelled;
 *   - the PO detail route renders.
 *
 * Creates KS-TEST-E2E-R8-* records on the shared dev DB (Copperline · MLT1).
 * Run: npx playwright test tests/e2e/inbound-receiving/po-round8.spec.ts --project=e2e --no-deps
 */
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { e2eBaseUrl, storageStatePath } from '../fixtures/roles';

async function api(): Promise<{ c: APIRequestContext; h: Record<string, string> }> {
  const c = await pwRequest.newContext({
    baseURL: e2eBaseUrl(),
    storageState: storageStatePath('admin'),
    timeout: 120_000,
  });
  await c.get('/api/auth/csrf');
  const token = (await c.storageState()).cookies.find((k) => k.name === 'ks_csrf')?.value ?? '';
  return { c, h: { 'x-csrf-token': token } };
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ((await res.json()) as { data: T }).data;
}

test('receive without location defaults to the receiving location; Completed re-opens to Started', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const a = await api();
  const sku = 'CPL-MUG-12OZ';
  const product = (
    await json<{ id: string; clientId: string; sku: string }[]>(await a.c.get(`/api/products?q=${sku}&ps=5`))
  ).find((p) => p.sku === sku);
  const wh = (await json<{ id: string; code: string }[]>(await a.c.get('/api/warehouses?q=MLT1&ps=10'))).find(
    (w) => w.code === 'MLT1',
  );
  const vendor = (
    await json<{ id: string }[]>(await a.c.get(`/api/vendors?ps=1&clientId=${product?.clientId}&active=1`))
  )[0];
  const code = `KS-TEST-E2E-R8-${Date.now().toString(36).toUpperCase()}`;
  const po = await json<{
    id: string;
    lines: { id: string }[];
    defaultReceivingLocation: { id: string } | null;
  }>(
    await a.c.post('/api/purchase-orders', {
      headers: a.h,
      data: {
        warehouseId: wh?.id,
        clientId: product?.clientId,
        vendorId: vendor?.id,
        code,
        poType: 'Purchase Order',
        poDate: new Date().toISOString(),
        lines: [{ productId: product?.id, orderedQuantity: 3, unitCost: 1 }],
      },
    }),
  );
  const lineId = po.lines[0]?.id ?? '';

  const bad = await a.c.post(`/api/purchase-orders/${po.id}/receive`, {
    headers: a.h,
    data: { lines: [{ lineId, quantity: 0 }] },
  });
  expect(bad.status()).toBe(400);
  const err = (await bad.json()) as { fieldErrors?: Record<string, string[]> };
  expect(err.fieldErrors?.['lines.0.quantity']?.[0]).toBe('Quantity must be at least 1');

  const r = await json<{ receiptIds: string[]; status: string }>(
    await a.c.post(`/api/purchase-orders/${po.id}/receive`, {
      headers: a.h,
      data: { lines: [{ lineId, quantity: 3 }] },
    }),
  );
  expect(r.status).toBe('Completed');
  const receipt = await json<{ locationId: string }>(await a.c.get(`/api/receipts/${r.receiptIds[0]}`));
  expect(receipt.locationId).toBe(po.defaultReceivingLocation?.id);

  const done = await json<{ version: number; allowedStatuses: string[] }>(
    await a.c.get(`/api/purchase-orders/${po.id}`),
  );
  expect(done.allowedStatuses).toContain('Started');
  const reopened = await json<{ status: string; completedAt: string | null }>(
    await a.c.post(`/api/purchase-orders/${po.id}/status`, {
      headers: a.h,
      data: { status: 'Started', reason: 'Wrong lot received', version: done.version },
    }),
  );
  expect(reopened.status).toBe('Started');
  expect(reopened.completedAt).toBeNull();
  await json(await a.c.post(`/api/receipts/${r.receiptIds[0]}/cancel`, { headers: a.h, data: {} }));

  await page.goto(`/receiving/${po.id}`);
  await expect(page.getByRole('heading', { name: 'Edit purchase order' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(code).first()).toBeVisible();
});
