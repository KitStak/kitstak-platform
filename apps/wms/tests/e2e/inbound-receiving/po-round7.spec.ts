/**
 * M05 round 7 integration (real API routes against the dev server):
 *   - directed putaway: a suggestion fetched before the lot was typed still stamps the
 *     algorithm / rule on the Receiving ledger row;
 *   - Cancel order on a Started PO with receipts short-closes it (Completed, stock kept);
 *   - Import PO Serial Numbers (CSV) attaches serials; Remove Serial Number clears them;
 *   - completion writes exactly one "Actual Receiving Date is modified" entry.
 *
 * Creates KS-TEST-E2E-R7-* records on the shared dev DB (Copperline / NovaFit · MLT1).
 * Run: npx playwright test tests/e2e/inbound-receiving/po-round7.spec.ts --project=e2e --no-deps
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

const suffix = () => Date.now().toString(36).toUpperCase();
/** Direct DB reads need a Postgres the dev server also uses (local PGlite is single-process, held by `next dev`). */
const readDb = async (): Promise<{
  query: <T>(text: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
}> => {
  const mod = (await import('../../../scripts/lib/raw-db.mjs' as string)) as {
    openRawDb: () => Promise<{
      query: <T>(text: string, params?: unknown[]) => Promise<T[]>;
      close: () => Promise<void>;
    }>;
  };
  return await mod.openRawDb();
};

async function setup(a: Awaited<ReturnType<typeof api>>, sku: string, qty: number) {
  const product = (
    await json<{ id: string; clientId: string; sku: string }[]>(await a.c.get(`/api/products?q=${sku}&ps=5`))
  ).find((p) => p.sku === sku);
  expect(product).toBeTruthy();
  const wh = (await json<{ id: string; code: string }[]>(await a.c.get('/api/warehouses?q=MLT1&ps=10'))).find(
    (w) => w.code === 'MLT1',
  );
  const vendor = (
    await json<{ id: string }[]>(await a.c.get(`/api/vendors?ps=1&clientId=${product?.clientId}&active=1`))
  )[0];
  expect(vendor).toBeTruthy();
  const code = `KS-TEST-E2E-R7-${suffix()}`;
  const po = await json<{ id: string; code: string; version: number; lines: { id: string }[] }>(
    await a.c.post('/api/purchase-orders', {
      headers: a.h,
      data: {
        warehouseId: wh?.id,
        clientId: product?.clientId,
        vendorId: vendor?.id,
        code,
        poType: 'Purchase Order',
        poDate: new Date().toISOString(),
        lines: [{ productId: product?.id, orderedQuantity: qty, unitCost: 1 }],
      },
    }),
  );
  return { po, lineId: po.lines[0]?.id ?? '' };
}

test('directed putaway stamps the algorithm even when the suggestion predates the lot; short-close keeps stock', async () => {
  test.skip(
    !process.env.DATABASE_URL,
    'reads the ledger directly: needs DATABASE_URL (local PGlite is held by the dev server)',
  );
  test.setTimeout(240_000);
  const a = await api();
  const { po, lineId } = await setup(a, 'CPL-BAG-MED-12', 10);
  // The drawer asks for a suggestion before the lot / expiry is typed.
  const s = await json<{ algorithm: string; rule: string | null; suggestions: { locationId: string }[] }>(
    await a.c.get(`/api/purchase-orders/${po.id}/suggest?lineId=${lineId}&qty=4`),
  );
  const top = s.suggestions[0];
  expect(top).toBeTruthy();
  const expiry = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const r = await json<{ receiptIds: string[]; status: string }>(
    await a.c.post(`/api/purchase-orders/${po.id}/receive`, {
      headers: a.h,
      data: {
        lines: [
          {
            lineId,
            quantity: 4,
            locationId: top?.locationId,
            lotNumber: `R7-${suffix()}`,
            expiryDate: expiry,
            fromSuggestion: true,
            suggestBasis: { qty: 4, lot: null, expiry: null, damageReason: null },
          },
        ],
      },
    }),
  );
  expect(r.status).toBe('Started');
  const db = await readDb();
  const [txn] = await db.query<{ a: string | null; r: string | null }>(
    'SELECT algorithm_name AS a, algorithm_rule_name AS r FROM inventory_transactions WHERE receipt_id = $1 LIMIT 1',
    [r.receiptIds[0]],
  );
  expect(txn?.a).toBe(s.algorithm);

  // Cancel order on the Started PO: short-close, received stock kept.
  const detail = await json<{ version: number }>(await a.c.get(`/api/purchase-orders/${po.id}`));
  const out = await json<{ status: string; shortClosed: boolean; cancelledUnits: number }>(
    await a.c.post(`/api/purchase-orders/${po.id}/cancel`, {
      headers: a.h,
      data: { version: detail.version },
    }),
  );
  expect(out.shortClosed).toBe(true);
  expect(out.status).toBe('Completed');
  expect(out.cancelledUnits).toBe(6);
  const [active] = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM receipts WHERE purchase_order_id = $1 AND cancelled_at IS NULL',
    [po.id],
  );
  expect(active?.n).toBe(1);
  const log = await db.query<{ field: string; message: string }>(
    'SELECT field, message FROM change_log WHERE entity_id = $1 ORDER BY "rowid"',
    [po.id],
  );
  expect(log.filter((l) => l.field === 'receivedAt').map((l) => l.message)).toEqual([
    expect.stringMatching(/^Actual Receiving Date is modified\. \(empty\) --> /),
  ]);
  expect(log.some((l) => l.field === 'statusChangeReason' && /Open balance cancelled/.test(l.message))).toBe(
    true,
  );
  await db.close();
});

test('Import PO Serial Numbers attaches serials and Remove Serial Number clears them', async () => {
  test.setTimeout(240_000);
  const a = await api();
  const { po, lineId } = await setup(a, 'NOVA-HUB-7P', 3);
  const s1 = `R7SN-${suffix()}-1`;
  const s2 = `R7SN-${suffix()}-2`;
  const csv = `PO Code,SKU,Serial Number\n${po.code},NOVA-HUB-7P,${s1}\n${po.code},NOVA-HUB-7P,${s2}\n${po.code},NOVA-HUB-7P,${s1}\n`;
  const res = await a.c.post('/api/imports/po-serials', {
    headers: a.h,
    multipart: { file: { name: 'po-serials.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const batch = ((await res.json()) as { data: Record<string, unknown> }).data;
  // The duplicate row fails ("already pre-advised", listed in the error file); the other two land.
  expect(batch).toMatchObject({ successCount: 2, errorCount: 1 });
  const detail = await json<{
    preAdvisedSerials: number;
    lines: { id: string; preAdvisedSerials: { serial: string; received: boolean }[] }[];
  }>(await a.c.get(`/api/purchase-orders/${po.id}`));
  expect(detail.preAdvisedSerials).toBe(2);
  expect(detail.lines.find((l) => l.id === lineId)?.preAdvisedSerials.map((x) => x.serial)).toEqual([s1, s2]);
  const removed = await json<{ succeeded: string[]; removed: number }>(
    await a.c.post('/api/purchase-orders/bulk/remove-serials', { headers: a.h, data: { ids: [po.id] } }),
  );
  expect(removed.removed).toBe(2);
  expect(
    (await json<{ preAdvisedSerials: number }>(await a.c.get(`/api/purchase-orders/${po.id}`)))
      .preAdvisedSerials,
  ).toBe(0);
});
