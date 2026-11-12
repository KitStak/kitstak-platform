/**
 * M10 facility-config — route smoke / release gate (REQ-R4-3).
 *
 * Loads every facility page and its list API, asserting HTTP 200, a rendered heading and
 * no uncaught page errors. Run against a production build to gate releases:
 *   npm run build && npx next start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/facility-config/smoke.spec.ts
 * It also runs against the dev server (first hits compile, hence the generous timeouts).
 */
import { expect, test } from '../fixtures/auth';
import { e2eBaseUrl } from '../fixtures/roles';

const base = e2eBaseUrl();
test.use({ actionTimeout: 45_000, navigationTimeout: 150_000 });
test.setTimeout(240_000);

const PAGES: readonly { path: string; api: string; heading: RegExp }[] = [
  { path: '/locations', api: '/api/locations?ps=50', heading: /Locations/ },
  { path: '/settings/warehouses', api: '/api/warehouses', heading: /Warehouses?/ },
  { path: '/settings/lp-types', api: '/api/lp-types', heading: /LP Types|License plate types/i },
  { path: '/settings/lp-numbers', api: '/api/lp-numbers', heading: /LP Numbers|License plate numbers/i },
  { path: '/settings/mobile-carts', api: '/api/mobile-carts', heading: /Mobile carts?/i },
  { path: '/settings/shipment-packages', api: '/api/shipment-packages', heading: /Shipment packages?/i },
];

for (const p of PAGES) {
  test(`smoke ${p.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const api = await page.request.get(`${base}${p.api}`);
    expect(api.status(), `${p.api} status`).toBe(200);
    const res = await page.goto(`${base}${p.path}`);
    expect(res?.status(), `${p.path} status`).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(p.heading, { timeout: 60_000 });
    expect(errors, 'uncaught page errors').toEqual([]);
  });
}

test('smoke location detail', async ({ page }) => {
  const list = await page.request.get(`${base}/api/locations?ps=1`);
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { data?: { id: string; code: string }[] };
  const first = body.data?.[0];
  test.skip(!first, 'no locations seeded');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto(`${base}/locations/${first!.id}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByText(first!.code).first()).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
