import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiData, open, signIn, toast, watchPage } from './support';

/**
 * The five things a new shop does on day one, end to end in a real browser, on one job:
 * create a job, log a day, see the job's profit change, import a CSV, export a CSV.
 * Then the seams between teams: the job tabs use the shared entry ledgers, the command palette
 * and the go to keys reach every screen, and list state lives in the address bar.
 * The suite makes one job and removes it (and its import) at the end.
 *   E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/core-flows.spec.ts
 */

const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const JOB_NAME = `E2E core flow ${stamp}`;
const PRICE = '2.00';
let job: { number: string; id: string } | null = null;
let today = '';
let batchUrl = '';

interface JobDetail {
  id: string;
  number: string;
  version: number;
  stats: { unitsGood: string; hours: string; revenueCents: number | null; laborCents: number | null; otherCents: number | null; costCents: number | null; profitCents: number | null };
}
const jobDetail = (page: Page) => apiData<JobDetail>(page, `jobs/${job!.number}`);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => signIn(page));

test('1. create a job with the wizard', async ({ page }) => {
  const watch = watchPage(page);
  const clients = await apiData<{ name: string }[]>(page, 'clients');
  await open(page, '/jobs/new');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('Pick a client or type a new name.').first()).toBeVisible();
  await page.getByTestId('wizard-client').fill(clients[0]!.name);
  await page.getByTestId('wizard-name').fill(JOB_NAME);
  await page.getByTestId('wizard-units').fill('1000');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-price').fill(PRICE);
  await page.getByRole('radio', { name: 'The hours it will take' }).click();
  await page.getByTestId('wizard-hours').fill('40');
  await expect(page.getByTestId('preview-margin')).toContainText('%');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('wizard-review')).toBeVisible();
  // "Start it now?" is left on Planned: the first day of logged work starts the job by itself.
  await page.getByTestId('wizard-save').click();
  await page.waitForURL(/\/jobs\/J-\d+$/, { timeout: 60_000 });
  const number = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: JOB_NAME })).toBeVisible();
  const detail = await apiData<JobDetail>(page, `jobs/${number}`);
  job = { number, id: detail.id };
  expect(detail.stats.revenueCents ?? 0).toBe(0);
  expect(watch.problems).toEqual([]);
});

test('2. log a day of work on it', async ({ page }) => {
  test.skip(!job, 'the job was not created');
  const watch = watchPage(page);
  const number = job!.number;
  today = (await apiData<{ date: string }>(page, 'log')).date;
  // A planned job is not on the day sheet yet: the first day goes in from the job's own Work log.
  await open(page, `/jobs/${number}/work`);
  const form = page.getByTestId('work-add-form');
  await form.getByTestId('work-good').fill('120');
  await form.getByTestId('work-people').fill('2');
  await form.getByTestId('work-hours').fill('6');
  await form.getByTestId('work-save').click();
  await expect.poll(async () => (await apiData<{ status: string }>(page, `jobs/${number}`)).status).toBe('active');
  // Now it is active, so it is on the day sheet. Type the real numbers over the first ones.
  await open(page, `/log?job=${number}`);
  const row = page.getByTestId(`log-row-${number}`);
  await expect(row).toBeVisible();
  await row.getByLabel(`Units good for ${number}`).fill('200');
  await row.getByLabel(`People for ${number}`).fill('2');
  await row.getByLabel(`Hours each for ${number}`).fill('4');
  await expect(row.getByLabel(`Labor hours for ${number}`)).toHaveValue('8');
  await row.getByLabel(`Hours each for ${number}`).press('Enter');
  await expect(row.getByTestId('saved-tick').first()).toBeVisible();
  await expect(row.getByTestId('pace-chip')).toContainText('25');
  await page.reload();
  await expect(page.getByTestId(`log-row-${number}`).getByLabel(`Units good for ${number}`)).toHaveValue('200');
  const after = await apiData<JobDetail>(page, `jobs/${number}`);
  expect(Number(after.stats.unitsGood)).toBe(200);
  expect(Number(after.stats.hours)).toBe(8);
  expect(watch.problems).toEqual([]);
});

test("3. see the job's profit change, with how we got it", async ({ page }) => {
  test.skip(!job, 'the job was not created');
  const watch = watchPage(page);
  const detail = await jobDetail(page);
  // 200 good units at $2.00 each.
  expect(detail.stats.revenueCents).toBe(40_000);
  expect(Number(detail.stats.hours)).toBe(8);
  expect(detail.stats.laborCents ?? 0).toBeGreaterThan(0);
  // Profit is revenue less every cost: labor, material, other costs and the share of time not on a job.
  expect(detail.stats.costCents ?? 0).toBeGreaterThanOrEqual(detail.stats.laborCents ?? 0);
  expect(detail.stats.profitCents).toBe(40_000 - (detail.stats.costCents ?? 0));
  await open(page, `/jobs/${job!.number}`);
  const tiles = page.getByTestId('job-tiles');
  await expect(tiles).toContainText('$400');
  // Every number explains itself from the same inputs.
  await tiles.getByTestId('explain').first().click();
  await expect(page.getByText('How we got this').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await open(page, `/jobs/${job!.number}/work`);
  await expect(page.getByTestId('job-work')).toContainText('200');
  expect(watch.problems).toEqual([]);
});

test('4. import a CSV file of two more days', async ({ page }) => {
  test.skip(!job || !today, 'the job was not created');
  const watch = watchPage(page);
  const number = job!.number;
  const csv = ['Date,Job,Shift,Units Good,People,Hours Each,Notes', `${addDays(today, -1)},${number},e2e,150,2,3,from the file`, `${addDays(today, -2)},${number},e2e,50,1,2,from the file`].join('\r\n');
  await open(page, '/import/new?stream=production');
  await page.getByTestId('upload-input').setInputFiles({ name: `e2e-production-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('upload-preview')).toContainText('2 rows');
  await page.getByTestId('upload-continue').click();
  await expect(page.getByTestId('mapping-ready')).toBeVisible();
  await page.getByTestId('mapping-check').click();
  await expect(page.getByTestId('count-create')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('count-error')).toHaveAttribute('data-count', '0');
  await page.getByTestId('check-save').click();
  await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'committed');
  await expect(page.getByTestId('import-result-line')).toContainText('2 new');
  batchUrl = new URL(page.url()).pathname;
  const detail = await jobDetail(page);
  expect(Number(detail.stats.unitsGood)).toBe(400);
  expect(detail.stats.revenueCents).toBe(80_000);
  expect(watch.problems).toEqual([]);
});

test('5. export a CSV file and find the same rows in it', async ({ page }) => {
  test.skip(!job || !today, 'the job was not created');
  const number = job!.number;
  await open(page, '/export');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-link-production').click()]);
  expect(file.suggestedFilename()).toMatch(/^pulse-production-.*\.csv$/);
  const lines = readFileSync(await file.path(), 'utf8').split('\r\n');
  const header = lines[0]!.replace(/^﻿/, '').split(',');
  const mine = lines.filter((line) => line.split(',').includes(number));
  expect(mine).toHaveLength(3);
  const units = header.indexOf('units_good');
  expect(units).toBeGreaterThan(-1);
  expect(mine.map((line) => Number(line.split(',')[units])).sort((a, b) => a - b)).toEqual([50, 150, 200]);
  // The jobs list exports what is on screen too.
  await open(page, `/jobs?tab=all&q=${encodeURIComponent(JOB_NAME)}`);
  const [list] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export/ }).first().click()]);
  expect(readFileSync(await list.path(), 'utf8')).toContain(number);
});

test('6. job tabs use the shared ledgers: add a cost in place, see profit move, delete, undo', async ({ page }) => {
  test.skip(!job, 'the job was not created');
  const watch = watchPage(page);
  const before = await jobDetail(page);
  // The quick action on the overview goes to the ledger on the Materials tab.
  await open(page, `/jobs/${job!.number}`);
  await page.getByTestId('quick-add-cost').click();
  await page.waitForURL(/\/materials#other-costs$/);
  await expect(page.getByTestId('usage-ledger-empty')).toBeVisible();
  const empty = page.getByTestId('cost-ledger-empty');
  await empty.getByRole('button', { name: 'Add costs' }).click();
  const dialog = page.getByTestId('cost-bulk');
  await dialog.getByTestId('cost-bulk-save').click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await dialog.getByTestId('cost-bulk-0-amount').fill('125');
  await dialog.getByTestId('cost-bulk-0-vendor').fill('E2E Freight Co');
  await dialog.getByTestId('cost-bulk-save').click();
  await expect(page.getByTestId('cost-ledger-row')).toHaveCount(1);
  await expect(page.getByTestId('cost-ledger-row')).toContainText('$125.00');
  await expect.poll(async () => (await jobDetail(page)).stats.otherCents).toBe((before.stats.otherCents ?? 0) + 12_500);
  expect((await jobDetail(page)).stats.profitCents).toBe((before.stats.profitCents ?? 0) - 12_500);
  await expect(page.getByTestId('job-materials')).toContainText('$125');

  await page.reload();
  const row = page.getByTestId('cost-ledger-row');
  await expect(row).toContainText('E2E Freight Co');
  await row.getByRole('button', { name: /^Delete the/ }).click();
  await expect(page.getByTestId('cost-ledger-row')).toHaveCount(0);
  await toast(page, /Deleted|removed/i).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('cost-ledger-row')).toHaveCount(1);
  await page.getByTestId('cost-ledger-row').getByRole('button', { name: /^Delete the/ }).click();
  await expect(page.getByTestId('cost-ledger-row')).toHaveCount(0);
  await expect.poll(async () => (await jobDetail(page)).stats.otherCents).toBe(before.stats.otherCents ?? 0);

  // Money in mounts the invoice and extra service ledgers.
  await open(page, `/jobs/${job!.number}/money-in`);
  await expect(page.getByTestId('revenue-ledger-empty')).toBeVisible();
  await expect(page.getByTestId('service-ledger-empty')).toBeVisible();
  expect(watch.problems).toEqual([]);
});

test('7. the command palette and the go to keys reach every screen', async ({ page }) => {
  await open(page, '/');
  const palette = async (text: string) => {
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByTestId('palette-input')).toBeVisible({ timeout: 2000 });
    }).toPass();
    await page.getByTestId('palette-input').fill(text);
  };
  for (const [typed, path] of [
    ['audit log', '/settings/audit'],
    ['log many days', '/log/bulk'],
    ['review the day', '/log/review'],
    ['connected apps', '/settings/apps'],
    ['extra services', '/services'],
    ['alert rules', '/alerts/rules'],
    ['calculator', '/calculator'],
    ['profit by client', '/profit'],
    ['people and roles', '/settings'],
    ['wall display', '/wall'],
  ] as const) {
    if (new URL(page.url()).pathname === '/wall') await open(page, '/');
    await palette(typed);
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
  }
  await open(page, '/');
  await page.getByTestId('app-shell').click({ position: { x: 600, y: 300 } });
  for (const [key, path] of [['r', '/reports'], ['b', '/labor'], ['t', '/target-pace'], ['c', '/calculator'], ['o', '/goals'], ['i', '/import'], ['s', '/settings'], ['a', '/alerts'], ['p', '/profit'], ['h', '/']] as const) {
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await expect(page.locator('h1').first()).toBeVisible();
  }
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toContainText('Reports');
});

test('8. list state lives in the address bar and comes back as a saved view', async ({ page }) => {
  const watch = watchPage(page);
  await open(page, '/alerts');
  await page.getByTestId('alerts-tab-snoozed').click();
  await expect(page).toHaveURL(/tab=snoozed/);
  await page.reload();
  await expect(page.getByTestId('alerts-tab-snoozed')).toHaveAttribute('data-state', 'active');
  const [alerts] = await Promise.all([page.waitForEvent('download'), page.getByTestId('alerts-tab-open').click().then(() => page.getByTestId('alerts-export').click())]);
  expect(readFileSync(await alerts.path(), 'utf8')).toContain('What happened');

  // Entries: filters in the URL, saved as a view, applied again from a clean page, then removed.
  await open(page, '/log/entries');
  await page.getByRole('switch', { name: 'Needs hours' }).click();
  await expect(page).toHaveURL(/needsHours=1/);
  const name = `E2E needs hours ${stamp}`;
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('dialog').getByRole('textbox').first().fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
  await expect(toast(page, /saved/i).first()).toBeVisible();
  await open(page, '/log/entries');
  await expect(page).not.toHaveURL(/needsHours/);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page).toHaveURL(/needsHours=1/);
  await expect(page.getByRole('switch', { name: 'Needs hours' })).toBeChecked();
  await page.getByRole('button', { name: new RegExp(`More for ${name}|Options for ${name}|${name} options`) }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(toast(page, /Deleted|removed/i).first()).toBeVisible();

  // Labor keeps its days in the address bar; the stream backed lists export the import columns.
  await open(page, '/labor?tab=cost');
  await page.getByRole('radio', { name: '90 days' }).click();
  await expect(page).toHaveURL(/range=last_90/);
  const [labor] = await Promise.all([page.waitForEvent('download'), page.getByTestId('labor-cost-export').click()]);
  expect(readFileSync(await labor.path(), 'utf8')).toContain('Labor class');
  await open(page, '/target-pace');
  const [pace] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-target_pace').click()]);
  expect(pace.suggestedFilename()).toMatch(/target_pace/);
  expect(watch.problems).toEqual([]);
});

test('9. clean up: undo the import and delete the job', async ({ page }) => {
  test.skip(!job, 'the job was not created');
  if (batchUrl) {
    await open(page, batchUrl);
    await page.getByTestId('result-undo').click();
    await page.getByRole('button', { name: 'Undo the import' }).click();
    await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'undone');
  }
  await open(page, `/jobs/${job!.number}`);
  await page.getByTestId('job-more').click();
  await page.getByTestId('job-delete').click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: /Delete/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL((url) => url.pathname === '/jobs', { timeout: 30_000 });
  const gone = await page.request.get(`/api/v1/jobs/${job!.number}`);
  expect(gone.status()).toBe(404);
});
