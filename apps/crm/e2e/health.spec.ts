import { expect, publicTest as test } from './support/fixtures';

test('health endpoint is healthy and exposes only {status} publicly', async ({ request }) => {
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { ok: boolean; data: Record<string, unknown> };
  expect(body.ok).toBe(true);
  // A 200 means the database ping succeeded (503 otherwise); details need HEALTH_TOKEN.
  expect(body.data).toEqual({ status: 'ok' });
});

test('unauthenticated app routes redirect to login', async ({ page, baseURL }) => {
  await page.goto('/some-org');
  // One front door (docs/billing/CONTRACTS.md, review round 4). With a Portal address set, this is
  // the Portal sign in and `next` is the full CRM address. Run alone, it is the CRM's own page and
  // `next` is the path. Either way the person comes back to the page they asked for.
  await expect(page).toHaveURL(/\/login\?/);
  const landed = new URL(page.url());
  expect(landed.pathname).toBe('/login');
  const appOrigin = new URL(baseURL ?? 'http://localhost:3100').origin;
  expect(['/some-org', `${appOrigin}/some-org`]).toContain(landed.searchParams.get('next'));
});

test('mutating API calls from a foreign origin are rejected', async ({ request }) => {
  const response = await request.post('/api/v1/health', {
    headers: { origin: 'https://evil.example' },
    data: {},
  });
  expect(response.status()).toBe(403);
});
