import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Data team screens: the import flow (paste, match, check, fix a cell, leave a row out, save,
 * undo), saved mappings, exports and the round trip, settings sections, people and roles, the
 * audit log with saved views, and the welcome page. Each test does the thing, reloads the page to
 * prove it was saved, then puts the data back, so the suite can run next to a seeded demo.
 *   E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/data.spec.ts
 * The suite starts five imports. One person may start 20 an hour, so three runs in an hour fit.
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';
type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

/** Signs in once per worker and reuses the cookie: the auth server rate limits sign-ins. */
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

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]', { hasText: text });
const undo = (page: Page, text: string | RegExp) => toast(page, text).getByRole('button', { name: 'Undo' });
const stamp = Date.now().toString(36).slice(-5).toUpperCase();

async function firstJob(page: Page): Promise<{ number: string; id: string }> {
  const response = await page.request.get('/api/v1/jobs?tab=open&limit=5');
  const body = (await response.json()) as { data: { number: string; id: string; pricingModel: string }[] };
  const job = body.data.find((row) => row.pricingModel === 'per_unit') ?? body.data[0];
  expect(job, 'the demo org has an open job').toBeTruthy();
  return job as { number: string; id: string };
}

async function pasteRows(page: Page, stream: string, text: string) {
  await page.goto(`/import/new?stream=${stream}`);
  await page.getByTestId('upload-mode-paste').click();
  await page.getByTestId('upload-paste').fill(text);
  await page.getByTestId('upload-paste-use').click();
  await expect(page.getByTestId('upload-preview')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => signIn(page));

test('import: paste rows, see problems on the cell, fix one, leave one out, save, reload, undo', async ({ page }) => {
  const job = await firstJob(page);
  const shift = `e2e${stamp.toLowerCase()}`;
  const rows = ['Date\tJob\tShift\tUnits Good\tPeople\tHours Each\tNotes', `2026-11-10\t${job.number}\t${shift}\t120\t2\t9x\tfirst`, `2026-11-11\tJ-NOPE-${stamp}\t${shift}\t50\t1\t8\tsecond`, `2026-11-12\t${job.number}\t${shift}\t80\t2\t4\t=SUM(A1)`].join('\n');
  await pasteRows(page, 'production', rows);
  await expect(page.getByTestId('upload-preview')).toContainText('3 rows');
  await page.getByTestId('upload-continue').click();

  // Step 2: every header matched itself, including the loose ones.
  await expect(page.getByTestId('mapping-ready')).toBeVisible();
  await expect(page.getByTestId('map-row-3')).toContainText('Matched for you');
  await page.getByTestId('mapping-check').click();

  // Step 3: two problems, each in plain words on its own cell.
  await expect(page.getByTestId('count-error')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('count-create')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('row-2')).toContainText('9x');
  await expect(page.getByTestId('row-3')).toContainText(`There is no job J-NOPE-${stamp}`);
  await expect(page.getByTestId('check-save')).toBeDisabled();
  await expect(page.getByTestId('check-verdict')).toContainText('Nothing can be saved');

  // The error report is a file with the bad rows and a problem column.
  const [report] = await Promise.all([page.waitForEvent('download'), page.getByTestId('error-report').click()]);
  const reportText = readFileSync(await report.path(), 'utf8');
  expect(reportText).toContain('problem');
  expect(reportText).toContain('9x');

  // Fix the bad hours in place, leave the unknown job out.
  await page.getByTestId('row-fix-2').click();
  await page.getByTestId('cell-2-5').fill('8');
  await page.getByTestId('row-save-2').click();
  await expect(page.getByTestId('count-error')).toHaveAttribute('data-count', '1');
  await page.getByTestId('row-skip-3').click();
  await expect(page.getByTestId('count-error')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('count-skip')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('check-save')).toHaveText(/Save 2 rows/);
  await page.getByTestId('check-save').click();
  await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'committed');
  await expect(page.getByTestId('import-result-line')).toContainText('2 new');

  // Reload: the batch is saved and the rows are in Pulse (the formula like note came through as text).
  await page.reload();
  await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'committed');
  const saved = (await (await page.request.get(`/api/v1/production?job=${job.id}&from=2026-11-10&to=2026-11-12&limit=200`)).json()) as { data: { shift: string; note: string | null; hours: string }[] };
  const mine = saved.data.filter((row) => row.shift === shift);
  expect(mine).toHaveLength(2);
  expect(mine.map((row) => row.note).sort()).toEqual(['=SUM(A1)', 'first']);
  expect(mine.map((row) => Number(row.hours)).sort((a, b) => a - b)).toEqual([8, 16]);

  // Undo the whole batch.
  await page.getByTestId('result-undo').click();
  await page.getByRole('button', { name: 'Undo the import' }).click();
  await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'undone');
  await page.reload();
  await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'undone');
  const after = (await (await page.request.get(`/api/v1/production?job=${job.id}&from=2026-11-10&to=2026-11-12&limit=200`)).json()) as { data: { shift: string }[] };
  expect(after.data.filter((row) => row.shift === shift)).toHaveLength(0);
});

test('import: wrong kind of file, title row above the headers, saved mapping, discard', async ({ page }) => {
  await page.goto('/import/new?stream=clients');
  // A spreadsheet file is refused in plain words.
  await page.getByTestId('upload-input').setInputFiles({ name: 'clients.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
  await expect(page.getByTestId('upload-error')).toContainText('Save as');
  // The template downloads from the same screen.
  const [template] = await Promise.all([page.waitForEvent('download'), page.getByTestId('upload-template').click()]);
  expect(template.suggestedFilename()).toBe('clients.csv');
  expect(readFileSync(await template.path(), 'utf8')).toContain('client_code,name');

  // A file with a title row: Pulse finds the header row by itself. Odd header names need a hand.
  const csv = ['Client list for the year', `Customer Ref;Company;Main person`, `E2E-${stamp};E2E Import Co ${stamp};Pat Lee`].join('\n');
  await page.getByTestId('upload-input').setInputFiles({ name: `clients-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('upload-preview')).toContainText('1 row');
  await expect(page.getByLabel('Row with the column names')).toContainText('Row 2');
  await expect(page.getByLabel('Columns are split by')).toContainText('semicolon');
  await page.getByTestId('upload-continue').click();
  await expect(page.getByTestId('mapping-missing')).toContainText('Still needed');
  await expect(page.getByTestId('mapping-check')).toBeDisabled();
  await page.getByLabel('What "Customer Ref" is').click();
  await page.getByRole('option', { name: /^Client code/ }).click();
  await page.getByLabel('What "Company" is').click();
  await page.getByRole('option', { name: /^Client name|^Name/ }).first().click();
  await expect(page.getByTestId('mapping-ready')).toBeVisible();
  await page.getByTestId('preset-remember').click();
  await page.getByTestId('preset-name').fill(`E2E clients ${stamp}`);
  await page.getByTestId('mapping-check').click();
  await expect(page.getByTestId('count-create')).toHaveAttribute('data-count', '1');
  // Nothing is saved: discard it.
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/import$/);
  expect(((await (await page.request.get(`/api/v1/clients?q=E2E-${stamp}`)).json()) as { data: unknown[] }).data).toHaveLength(0);

  // The same headers again: the saved mapping is applied, no hand matching needed.
  await page.goto('/import/new?stream=clients');
  await page.getByTestId('upload-input').setInputFiles({ name: `clients-${stamp}-b.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByTestId('upload-continue').click();
  await expect(page.getByTestId('mapping-ready')).toBeVisible();
  // Clean up: rename and delete the saved mapping, then discard the batch.
  await page.getByTestId('presets-manage').click();
  const dialog = page.getByTestId('presets-dialog');
  await dialog.getByLabel(`Name of the mapping E2E clients ${stamp}`).fill(`E2E renamed ${stamp}`);
  await dialog.getByRole('button', { name: 'Rename' }).first().click();
  await expect(toast(page, 'Mapping renamed')).toBeVisible();
  await dialog.getByRole('button', { name: `Delete the mapping E2E renamed ${stamp}` }).click();
  await expect(toast(page, /Deleted/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/import$/);
});

test('export: filters in the address, a CSV in template columns, a zip of everything, and a lossless round trip', async ({ page }) => {
  await page.goto('/export');
  await page.getByTestId('range-month').click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
  await page.getByTestId('export-clear').click();
  await expect(page).not.toHaveURL(/from=/);

  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-link-clients').click()]);
  expect(file.suggestedFilename()).toMatch(/^pulse-clients-kitstak\.csv$/);
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('client_code,name,status,contact_name');
  expect(csv).toContain('\r\n');

  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-everything').click()]);
  expect(zip.suggestedFilename()).toMatch(/^pulse-everything-kitstak\.zip$/);
  const bytes = readFileSync(await zip.path());
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
  expect(bytes.toString('latin1')).toContain('pulse-jobs-kitstak.csv');

  // Money can be left out of a file.
  const noMoney = await page.request.get('/api/v1/export/jobs.csv?money=0');
  const header = (await noMoney.text()).split('\r\n')[0] ?? '';
  expect(header).toContain('job_number');
  expect(header).not.toContain('unit_price');

  // Round trip: the exported clients file imports back with every row reading "No change".
  await page.goto('/import/new?stream=clients');
  await page.getByTestId('upload-input').setInputFiles({ name: file.suggestedFilename(), mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByTestId('upload-continue').click();
  await page.getByTestId('mapping-check').click();
  const total = csv.trim().split('\r\n').length - 1;
  await expect(page.getByTestId('count-unchanged')).toHaveAttribute('data-count', String(total));
  for (const id of ['create', 'update', 'error', 'lookalike']) await expect(page.getByTestId(`count-${id}`)).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('check-verdict')).toContainText('saving changes nothing');
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/import$/);
});

test('import center: cards, templates, history and a real 404 for an unknown import', async ({ page }) => {
  await page.goto('/import');
  await expect(page.getByTestId('stream-production')).toBeVisible();
  await expect(page.getByTestId('stream-production-state')).toContainText('rows in Pulse');
  const [template] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-production').click()]);
  expect(template.suggestedFilename()).toBe('production.csv');
  await expect(page.getByTestId('import-history').or(page.getByTestId('import-history-cards')).first()).toBeVisible();
  const missing = await page.request.get('/import/00000000-0000-4000-8000-000000000000');
  expect(missing.status()).toBe(404);
  const api = await page.request.get('/api/v1/export/not_a_stream.csv');
  expect(api.status()).toBe(404);
});

test('settings: change the shift length, reload, undo; a bad value is refused in plain words', async ({ page }) => {
  await page.goto('/settings?section=general');
  const field = page.getByTestId('settings-general-defaultShiftHours');
  const before = await field.inputValue();
  await field.fill('99');
  await page.getByTestId('settings-general-save').click();
  await expect(page.getByText('Type a number from 0.25 to 24.')).toBeVisible();
  const next = before === '7.5' ? '8' : '7.5';
  await field.fill(next);
  await page.getByTestId('settings-general-save').click();
  await expect(toast(page, 'Settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('settings-general-defaultShiftHours')).toHaveValue(next);
  // Put it back with a second save and use Undo on that one to prove Undo works.
  await page.getByTestId('settings-general-defaultShiftHours').fill('6');
  await page.getByTestId('settings-general-save').click();
  await undo(page, 'Settings saved').click();
  await expect(toast(page, 'Settings put back')).toBeVisible();
  await expect(page.getByTestId('settings-general-defaultShiftHours')).toHaveValue(next);
  await page.getByTestId('settings-general-defaultShiftHours').fill(before);
  await page.getByTestId('settings-general-save').click();
  await expect(toast(page, 'Settings saved').last()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('settings-general-defaultShiftHours')).toHaveValue(before);
});

test('settings: sites, job types and catalogs can be added, changed and removed', async ({ page }) => {
  // A site.
  await page.goto('/settings?section=sites');
  await page.getByTestId('site-add').click();
  await page.getByTestId('site-save').click();
  await expect(page.getByTestId('site-dialog')).toContainText('Give the site a name.');
  await page.getByTestId('site-name').fill(`E2E dock ${stamp}`);
  await page.getByTestId('site-code').fill(`E2E${stamp}`);
  await page.getByTestId('site-save').click();
  await expect(page.getByTestId('site-dialog')).toBeHidden();
  const site = page.getByTestId(`site-E2E${stamp}`);
  await expect(site).toContainText(`E2E dock ${stamp}`);
  await page.reload();
  await page.getByTestId(`site-edit-E2E${stamp}`).click();
  await page.getByTestId('site-name').fill(`E2E dock ${stamp} north`);
  await page.getByTestId('site-save').click();
  await expect(page.getByTestId('site-dialog')).toBeHidden();
  await expect(site).toContainText('north');
  await page.getByTestId(`site-delete-E2E${stamp}`).click();
  await page.getByRole('button', { name: 'Delete site' }).click();
  await expect(site).toHaveCount(0);

  // A job type.
  await page.goto('/settings?section=job-types');
  await page.getByTestId('job-type-add').click();
  await page.getByTestId('job-type-name').fill(`E2E type ${stamp}`);
  await page.getByLabel('Short code').fill(`E2ET${stamp}`);
  await page.getByLabel('Target margin').fill('31.5');
  await page.getByTestId('job-type-save').click();
  await expect(page.getByTestId('job-type-dialog')).toBeHidden();
  const type = page.getByTestId(`job-type-E2ET${stamp}`);
  await expect(type).toContainText('target margin 31.5%');
  await page.reload();
  await expect(type).toBeVisible();
  await page.getByTestId(`job-type-delete-E2ET${stamp}`).click();
  await page.getByRole('button', { name: 'Delete job type' }).click();
  await expect(type).toHaveCount(0);

  // A client: add, edit, delete, undo, delete.
  await page.goto('/settings?section=catalogs');
  await page.getByTestId('client-add').click();
  await page.getByTestId('client-name').fill(`E2E Client ${stamp}`);
  await page.getByTestId('client-code').fill(`E2EC${stamp}`);
  await page.getByTestId('client-save').click();
  await expect(page.getByTestId('client-dialog')).toBeHidden();
  const client = page.getByTestId(`client-E2EC${stamp}`);
  await expect(client).toBeVisible();
  await page.getByTestId(`client-edit-E2EC${stamp}`).click();
  await page.getByLabel('Contact name').fill('Robin Vale');
  await page.getByTestId('client-save').click();
  await expect(page.getByTestId('client-dialog')).toBeHidden();
  await expect(client).toContainText('Robin Vale');
  await page.getByTestId(`client-delete-E2EC${stamp}`).click();
  await expect(client).toHaveCount(0);
  await undo(page, `Deleted E2E Client ${stamp}`).click();
  await expect(client).toBeVisible();
  await page.reload();
  await page.getByTestId(`client-delete-E2EC${stamp}`).click();
  await expect(client).toHaveCount(0);

  // An item.
  await page.getByTestId('catalog-tab-items').click();
  await page.getByTestId('item-add').click();
  await page.getByTestId('item-sku').fill('bad sku');
  await page.getByTestId('item-name').fill(`E2E label ${stamp}`);
  await page.getByTestId('item-save').click();
  await expect(page.getByTestId('item-dialog')).toContainText('cannot hold spaces');
  await page.getByTestId('item-sku').fill(`E2EI-${stamp}`);
  await page.getByTestId('item-cost').fill('0.0425');
  await page.getByTestId('item-save').click();
  await expect(page.getByTestId('item-dialog')).toBeHidden();
  const item = page.getByTestId(`item-E2EI-${stamp}`);
  await expect(item).toContainText('$0.0425');
  await page.getByTestId(`item-delete-E2EI-${stamp}`).click();
  await page.getByRole('button', { name: 'Delete item' }).click();
  await expect(item).toHaveCount(0);
});

test('settings: who sees money, with undo, and your own notification switches', async ({ page }) => {
  await page.goto('/settings?section=people');
  await expect(page.getByTestId('money-summary')).toContainText('Who can see money?');
  const viewer = page.locator('[data-testid^="money-switch-"]').first();
  await expect(viewer).toBeVisible();
  const was = await viewer.getAttribute('data-state');
  await viewer.click();
  await expect(viewer).toHaveAttribute('data-state', was === 'checked' ? 'unchecked' : 'checked');
  await page.reload();
  await expect(page.locator('[data-testid^="money-switch-"]').first()).toHaveAttribute('data-state', was === 'checked' ? 'unchecked' : 'checked');
  await page.locator('[data-testid^="money-switch-"]').first().click();
  await expect(page.locator('[data-testid^="money-switch-"]').first()).toHaveAttribute('data-state', was ?? 'unchecked');

  await page.goto('/settings?section=notifications');
  const digest = page.getByTestId('notify-digest');
  const digestWas = await digest.getAttribute('data-state');
  await digest.click();
  await expect(digest).not.toHaveAttribute('data-state', digestWas ?? '');
  await page.reload();
  await expect(page.getByTestId('notify-digest')).not.toHaveAttribute('data-state', digestWas ?? '');
  await page.getByTestId('notify-digest').click();
  await undo(page, /Daily summary/).first().waitFor();
  await expect(page.getByTestId('notify-digest')).toHaveAttribute('data-state', digestWas ?? 'checked');
});

test('audit log: search, before and after, saved views and the CSV export', async ({ page }) => {
  await page.goto('/settings/audit');
  await expect(page.getByTestId('audit-table')).toBeVisible();
  await page.getByLabel('What kind of change').click();
  await page.getByRole('option', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/action=settings\./);
  await expect(page.getByTestId('audit-row').first()).toHaveAttribute('data-verb', 'settings.changed');
  await page.getByRole('button', { name: 'Show the before and after' }).first().click();
  await expect(page.getByTestId('audit-detail')).toContainText('Default shift hours');

  // Save this filter as a view, reload, rename it, make it the default, delete it and undo.
  await page.getByTestId('view-save').click();
  await page.getByTestId('view-submit').click();
  await expect(page.getByTestId('view-dialog')).toContainText('Give the view a name.');
  await page.getByTestId('view-name').fill(`E2E settings ${stamp}`);
  await page.getByTestId('view-submit').click();
  const view = page.getByTestId(`view-E2E settings ${stamp}`);
  await expect(view).toHaveAttribute('data-active', 'yes');
  await page.goto('/settings/audit');
  await expect(view).toHaveAttribute('data-active', 'no');
  await view.getByRole('button', { name: `E2E settings ${stamp}`, exact: true }).click();
  await expect(page).toHaveURL(/action=settings\./);
  await page.getByTestId(`view-menu-E2E settings ${stamp}`).click();
  await page.getByRole('menuitem', { name: 'Rename and options' }).click();
  await page.getByTestId('view-name').fill(`E2E renamed ${stamp}`);
  await page.getByTestId('view-default').click();
  await page.getByTestId('view-shared').click();
  await page.getByTestId('view-submit').click();
  const renamed = page.getByTestId(`view-E2E renamed ${stamp}`);
  await expect(renamed).toBeVisible();
  // The default view opens by itself on a bare address.
  await page.goto('/settings/audit');
  await expect(page).toHaveURL(/action=settings\./);
  await page.getByTestId(`view-menu-E2E renamed ${stamp}`).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(renamed).toHaveCount(0);
  await undo(page, /Deleted/).click();
  await expect(renamed).toBeVisible();
  await page.getByTestId(`view-menu-E2E renamed ${stamp}`).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(renamed).toHaveCount(0);

  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('audit-export').click()]);
  expect(file.suggestedFilename()).toMatch(/^pulse-audit-log-kitstak/);
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv).toContain('when,who,what,record_type');
  expect(csv).toContain('Changed settings');

  // Search finds nothing for nonsense, and says so.
  await page.getByTestId('audit-search').fill(`zzz-no-such-thing-${stamp}`);
  await expect(page.getByTestId('audit-empty')).toContainText('Nothing matches those filters');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('audit-table')).toBeVisible();
});

test('welcome and the rest of settings render with real state', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('welcome-progress')).toContainText('of 5 done');
  await expect(page.getByTestId('sample-card')).toBeVisible();
  for (const section of ['labor', 'cost-rules', 'devices', 'sample-data', 'danger', 'math']) {
    await page.goto(`/settings?section=${section}`);
    await expect(page.getByTestId('settings')).toHaveAttribute('data-section', section);
  }
  await expect(page.getByTestId('math')).toContainText('Real cost of an hour');
  await page.goto('/settings?section=danger');
  await page.getByTestId('purge-open').click();
  await expect(page.getByTestId('purge-run')).toBeDisabled();
  await page.getByTestId('purge-confirm').fill('not the name');
  await expect(page.getByTestId('purge-run')).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my data' }).click();
  await page.goto('/settings?section=labor');
  await expect(page.getByTestId('labor-example')).toContainText('a $16.00 wage really costs');
});
