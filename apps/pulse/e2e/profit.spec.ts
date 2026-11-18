import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Profit team suite: Home, the Profit explorer (drill down, compare, saved views, export), the
 * client page, extra services and reports with schedules. Every write is done, the page is
 * reloaded to prove it was saved, and then it is undone, so the suite leaves nothing behind.
 *   E2E_BASE_URL=http://localhost:3500 E2E_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome pnpm exec playwright test e2e/profit.spec.ts
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';

type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

/** Signs in once per worker and reuses the session cookie: the auth server rate limits sign-ins. */
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

const money = (text: string | null): number => Number((text ?? '').replace(/[^0-9.-]/g, ''));
const stamp = Date.now().toString().slice(-6);
const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text });

test.describe('profit', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Home answers in two lines and lists the jobs that need you', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-answer')).toContainText('Your jobs made');
    await expect(page.getByTestId('home-answer')).toContainText('the company made');
    await expect(page.getByTestId('home-tiles').locator('section')).toHaveCount(6);
    await expect(page.getByTestId('home-logged')).toContainText('logged today');
    await page.getByTestId('explain-company_profit').click();
    await expect(page.getByTestId('explain-body')).toContainText('Profit on jobs');
  });

  test('explorer: each level below adds up to the row above, down to the entries', async ({ page }) => {
    await page.goto('/profit?by=client&range=last_90');
    const first = page.getByTestId('profit-row').first();
    await expect(first).toBeVisible();
    const clientProfit = money(await first.locator('td').nth(6).textContent());
    await first.getByTestId('drill').click();
    await page.waitForURL(/by=job/);
    await expect(page.getByTestId('drill-path')).toBeVisible();
    await expect.poll(async () => money(await page.getByTestId('profit-total').locator('td').nth(6).textContent())).toBe(clientProfit);
    const job = page.getByTestId('profit-row').filter({ has: page.getByTestId('drill') }).first();
    const jobProfit = money(await job.locator('td').nth(6).textContent());
    await job.getByTestId('drill').click();
    await page.waitForURL(/by=day/);
    await expect.poll(async () => money(await page.getByTestId('profit-total').locator('td').nth(6).textContent())).toBe(jobProfit);
    const day = page.getByTestId('profit-row').first();
    const dayProfit = money(await day.locator('td').nth(6).textContent());
    await day.getByTestId('drill').click();
    await expect(page.getByTestId('entries-sums')).toBeVisible();
    expect(money(await page.getByTestId('entries-sums').locator('dd').nth(2).textContent())).toBe(dayProfit);
  });

  test('explorer: a saved view comes back after a reload, and a delete can be undone', async ({ page }) => {
    const name = `E2E view ${stamp}`;
    await page.goto('/profit?by=client&range=last_month&compare=prior&sort=-margin');
    await expect(page.getByTestId('profit-row').first()).toBeVisible();
    await expect(page.getByTestId('sort-profit_change')).toBeVisible();
    await page.getByTestId('views-menu').click();
    await page.getByTestId('view-save-open').click();
    await page.getByTestId('view-name').fill(name);
    await page.getByTestId('view-save').click();
    await expect(toast(page, `Saved the view ${name}`)).toBeVisible();
    await page.goto('/profit');
    await page.getByTestId('views-menu').click();
    await page.getByTestId(`view-apply-${name}`).click();
    await page.waitForURL(/range=last_month/);
    expect(page.url()).toContain('compare=prior');
    expect(page.url()).toContain('sort=-margin');
    await page.getByTestId('views-menu').click();
    await page.getByTestId(`view-delete-${name}`).click();
    await toast(page, `Deleted the view ${name}`).getByRole('button', { name: 'Undo' }).click();
    await page.reload();
    await page.getByTestId('views-menu').click();
    await expect(page.getByTestId(`view-apply-${name}`)).toBeVisible();
    await page.getByTestId(`view-delete-${name}`).click();
    await expect(toast(page, `Deleted the view ${name}`)).toBeVisible();
  });

  test('explorer: the CSV holds exactly the rows on screen', async ({ page }) => {
    await page.goto('/profit?by=client&range=last_90&sort=-revenue');
    await expect(page.getByTestId('profit-row').first()).toBeVisible();
    const rows = await page.getByTestId('profit-row').count();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('profit-export').click()]);
    const lines = readFileSync((await download.path()) as string, 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(rows + 2);
    expect(lines[lines.length - 1]).toMatch(/^Total,/);
    expect(Number(lines[1]!.split(',')[1])).toBe(money(await page.getByTestId('profit-row').first().locator('td').nth(1).textContent()));
  });

  test('extra services: add, reload, edit, delete and undo', async ({ page }) => {
    const name = `E2E sleeve ${stamp}`;
    const row = page.getByTestId('service-row').filter({ hasText: name });
    await page.goto('/services');
    await page.getByTestId('services-add').click();
    await page.getByTestId('service-save').click();
    await expect(page.getByText('Give the service a name.')).toBeVisible();
    await page.getByTestId('service-name').fill(name);
    await page.getByTestId('service-unit').fill('sleeves');
    await page.getByTestId('service-price').fill('0.10');
    await page.getByTestId('service-cost').fill('0.02');
    await page.getByTestId('service-pace').fill('300');
    await expect(page.getByTestId('service-preview')).toContainText('One sleeve should cost');
    await page.getByTestId('service-save').click();
    await expect(toast(page, `Added ${name}`)).toBeVisible();
    await page.reload();
    await expect(row).toHaveCount(1);
    await row.getByTestId('service-actions').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByTestId('service-price').fill('0.25');
    await page.getByTestId('service-save').click();
    await expect(row.locator('td').nth(1)).toHaveText('$0.25');
    await row.getByTestId('service-actions').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await toast(page, `Deleted ${name}`).getByRole('button', { name: 'Undo' }).click();
    await expect(row).toHaveCount(1);
    await row.getByTestId('service-actions').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('reports: the CSV matches the screen, and a schedule can be built, saved and removed', async ({ page }) => {
    const name = `E2E schedule ${stamp}`;
    await page.goto('/reports/daily-production-log?range=last_90');
    await expect(page.getByTestId('report-table')).toBeVisible();
    const href = (await page.getByTestId('report-csv').getAttribute('href')) as string;
    const file = await page.request.get(href);
    expect(file.headers()['content-type']).toContain('text/csv');
    expect((await file.text()).split('\r\n')[0]).toContain('Units good');
    await page.getByTestId('report-schedule').click();
    await page.getByTestId('schedule-name').fill(name);
    await expect(page.getByTestId('schedule-sentence')).toContainText('Every Monday at 7 AM');
    await page.getByTestId('schedule-save').click();
    await expect(toast(page, `${name} is scheduled`)).toBeVisible();
    await page.goto('/reports?tab=scheduled');
    const row = page.getByTestId('schedule-row').filter({ hasText: name });
    await expect(row).toContainText('Every Monday at 7 AM');
    await row.getByTestId('schedule-build').click();
    await expect(toast(page, `${name} is built`)).toBeVisible({ timeout: 60_000 });
    const run = page.getByTestId('run-row').filter({ hasText: name }).first();
    const built = await page.request.get((await run.getByTestId('run-csv').getAttribute('href')) as string);
    expect(await built.text()).toContain('Units good');
    await row.getByTestId('schedule-actions').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await toast(page, 'Deleted the schedule').getByRole('button', { name: 'Undo' }).click();
    await page.reload();
    await expect(row).toHaveCount(1);
    await row.getByTestId('schedule-actions').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('unknown clients, services and reports answer 404', async ({ page }) => {
    for (const path of ['/clients/00000000-0000-4000-8000-000000000000', '/services/00000000-0000-4000-8000-000000000000', '/reports/not-a-report']) {
      expect((await page.request.get(path)).status(), path).toBe(404);
    }
  });
});
