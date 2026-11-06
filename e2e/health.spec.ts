import { expect, publicTest as test } from './support/fixtures';

test('health endpoint is healthy and exposes only {status} publicly', async ({ request }) => {
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { ok: boolean; data: Record<string, unknown> };
  expect(body.ok).toBe(true);
  // A 200 means the database ping succeeded (503 otherwise); details need HEALTH_TOKEN.
  expect(body.data).toEqual({ status: 'ok' });
});

test('unauthenticated app routes redirect to login', async ({ page }) => {
  await page.goto('/some-org');
  await expect(page).toHaveURL(/\/login\?next=%2Fsome-org/);
});

test('mutating API calls from a foreign origin are rejected', async ({ request }) => {
  const response = await request.post('/api/v1/health', {
    headers: { origin: 'https://evil.example' },
    data: {},
  });
  expect(response.status()).toBe(403);
});
