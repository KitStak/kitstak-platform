import { expect, test, type Page } from '@playwright/test';

/**
 * Record search: the command palette finds jobs and clients as you type, and Enter opens the record.
 * `/search` lists the same records, and `/clients` goes to the client list. Reads only; nothing is created.
 * Uses the seeded Northwind Robotics org (client Cobalt Foods, job J-1026 palletizing spare parts kits).
 *   E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/search.spec.ts
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';

type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

/** Signs in once per worker and reuses the cookie: the auth server rate limits sign ins. */
async function signIn(page: Page) {
  if (session) {
    await page.context().addCookies(session);
    return;
  }
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email: 'maya@northwind-robotics.example', password: 'Northwind-Demo-2026!' },
    headers: { origin: ORIGIN() },
  });
  expect(response.ok(), `sign in answered ${response.status()}`).toBeTruthy();
  session = await page.context().cookies();
}

async function openPalette(page: Page) {
  await page.goto('/');
  // The shortcut is registered on hydration: press until the palette answers.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('palette-input')).toBeVisible({ timeout: 2000 });
  }).toPass();
}

test.describe('record search', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('Ctrl K, a client name, then Enter opens that client', async ({ page }) => {
    await openPalette(page);
    await page.getByTestId('palette-input').pressSequentially('Cobalt Foods', { delay: 20 });
    const first = page.getByTestId('palette-record').first();
    await expect(first).toContainText('Cobalt Foods');
    await expect(first).toContainText('Client');
    await expect(page.locator('[cmdk-item][aria-selected="true"]')).toContainText('Cobalt Foods');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname.startsWith('/clients/'));
    await expect(page.locator('h1').first()).toContainText('Cobalt Foods');
  });

  test('a job number or product words find the job', async ({ page }) => {
    await openPalette(page);
    await page.getByTestId('palette-input').fill('palletizing spare');
    await expect(page.getByTestId('palette-record').first()).toContainText('J-1026');
    await page.getByTestId('palette-input').fill('J-1026');
    await expect(page.locator('[cmdk-item][aria-selected="true"]')).toContainText('J-1026');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/jobs/J-1026');
  });

  test('the search page lists records, and /clients opens the client list', async ({ page }) => {
    await page.goto('/search?q=cobalt');
    await expect(page.locator('[data-testid="search-hit"][data-kind="client"]').first()).toContainText(
      'Cobalt Foods',
    );
    await expect(page.locator('[data-testid="search-hit"][data-kind="job"]').first()).toBeVisible();
    await page.goto('/clients');
    await page.waitForURL((url) => url.pathname === '/profit' && url.searchParams.get('by') === 'client');
  });
});
