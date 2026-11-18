import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Production team write screens: each test does the thing, reloads the page to prove it was
 * saved, and then puts the data back. Runs against a dev server with the seeded demo:
 * `E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/production.spec.ts`.
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';

type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

async function signIn(page: Page) {
  if (!session && process.env.E2E_COOKIES) session = JSON.parse(readFileSync(process.env.E2E_COOKIES, 'utf8')) as Cookie[];
  if (!session) {
    const response = await page.request.post('/api/auth/sign-in/email', { data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' }, headers: { origin: ORIGIN() } });
    expect(response.ok(), `sign in answered ${response.status()}`).toBeTruthy();
    session = await page.context().cookies();
    return;
  }
  await page.context().addCookies(session);
}

interface GridRow {
  jobId: string;
  jobNumber: string;
  entries: { id: string }[];
}

async function logGrid(page: Page): Promise<{ date: string; rows: GridRow[] }> {
  const response = await page.request.get('/api/v1/log');
  return ((await response.json()) as { data: { date: string; rows: GridRow[] } }).data;
}

test.describe('production', () => {
  test.describe.configure({ mode: 'serial' });

  test('day grid: a typed row saves itself, survives a reload, and can be cleared with undo', async ({ page }) => {
    await signIn(page);
    const grid = await logGrid(page);
    const empty = grid.rows.find((row) => row.entries.length === 0);
    test.skip(!empty, 'every job already has work logged today');
    const number = empty!.jobNumber;
    await page.goto('/log');
    const row = page.getByTestId(`log-row-${number}`);
    await row.getByLabel(`Units good for ${number}`).fill('120');
    await row.getByLabel(`People for ${number}`).fill('3');
    await row.getByLabel(`Hours each for ${number}`).fill('2');
    await expect(row.getByLabel(`Labor hours for ${number}`)).toHaveValue('6');
    await row.getByLabel(`Hours each for ${number}`).press('Enter');
    await expect(row.getByTestId('saved-tick').first()).toBeVisible();
    await expect(row.getByTestId('pace-chip')).toContainText('20');

    await page.reload();
    const again = page.getByTestId(`log-row-${number}`);
    await expect(again.getByLabel(`Units good for ${number}`)).toHaveValue('120');
    await expect(again.getByLabel(`Labor hours for ${number}`)).toHaveValue('6');

    await again.getByRole('button', { name: `More for ${number}` }).first().click();
    await page.getByRole('menuitem', { name: 'Clear this line' }).click();
    await expect(page.getByText(`Cleared ${number}`)).toBeVisible();
    await expect.poll(async () => (await logGrid(page)).rows.find((item) => item.jobNumber === number)?.entries.length).toBe(0);
  });

  test('other time: add, reload, remove', async ({ page }) => {
    await signIn(page);
    await page.goto('/log');
    const strip = page.getByTestId('other-time');
    const note = `E2E cleanup ${Date.now()}`;
    await strip.getByRole('button', { name: 'Add other time' }).click();
    await strip.getByLabel('Reason').selectOption('cleanup');
    await strip.getByLabel('Labor hours').fill('1.5');
    await strip.getByLabel('Note').fill(note);
    await strip.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Other time added')).toBeVisible();
    await page.reload();
    const item = page.getByTestId('other-time').locator('li').filter({ hasText: note });
    await expect(item).toContainText('1.5 hours');
    await item.getByRole('button', { name: 'Remove cleanup time' }).click();
    await expect(page.getByText(/Removed 1\.5 hours of cleanup/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('other-time').locator('li').filter({ hasText: note })).toHaveCount(0);
  });

  test('labor rates: the builder matches the worked example and a new class and rate are saved', async ({ page }) => {
    await signIn(page);
    await page.goto('/labor?tab=rates');
    const name = `E2E class ${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: 'Add a labor class' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(`Added ${name}`)).toBeVisible();
    await page.getByRole('button', { name: 'Add a rate' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Wage for an hour').fill('16.00');
    await dialog.getByLabel('Payroll taxes and workers comp').fill('9');
    await dialog.getByLabel('Benefits and paid time off').fill('12');
    await dialog.getByLabel('Other', { exact: true }).fill('0');
    await dialog.getByLabel('Overhead for each hour').fill('2.40');
    await dialog.getByLabel('Overtime multiplier').fill('1.5');
    // SPEC 4.3: wage $16.00, 9% and 12% on top, $2.40 overhead is $21.76, and $30.48 for an overtime hour.
    await expect(dialog.getByTestId('loaded-rate')).toHaveText('$21.76');
    await expect(dialog.getByTestId('rate-readout')).toContainText('$30.48');
    await expect(dialog.getByTestId('rate-preview')).toContainText(/No logged work|This changes/);
    await dialog.getByRole('button', { name: 'Add the rate' }).click();
    await expect(page.getByText(new RegExp(`New rate for ${name}`))).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByTestId('loaded-rate')).toHaveText('$21.76');
    await expect(page.getByTestId('rate-row')).toHaveCount(1);

    await page.getByRole('button', { name: `More for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByText('Labor class deleted')).toBeVisible();
  });

  test('target pace: a target is added, survives a reload, and is removed', async ({ page }) => {
    await signIn(page);
    await page.goto('/target-pace');
    const note = `E2E target ${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: 'Add a target' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Units per person per hour').fill('41.5');
    await dialog.getByLabel('Note').fill(note);
    await dialog.getByRole('button', { name: 'Add the target' }).click();
    await expect(page.getByText('Target added')).toBeVisible();
    await page.reload();
    const row = page.getByTestId('standard-row').filter({ hasText: note });
    await expect(row).toContainText('41.5');
    await row.getByRole('button', { name: /Remove the target/ }).click();
    await expect(page.getByText('Target removed')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('standard-row').filter({ hasText: note })).toHaveCount(0);
  });

  test('floor tablet: an unknown link shows nothing but "not active", with no session', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/kiosk/t/this-link-does-not-exist-000000');
    await expect(page.getByRole('heading', { name: 'This tablet link is not active' })).toBeVisible();
    const state = await page.request.post('/api/v1/kiosk/state', { data: { token: 'this-link-does-not-exist-000000' }, headers: { origin: ORIGIN() } });
    expect(state.status()).toBe(404);
    await context.close();
  });
});
