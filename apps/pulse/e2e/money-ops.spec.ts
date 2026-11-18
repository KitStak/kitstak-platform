import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Money ops screens: goals, alert rules, the alert inbox, month close with company costs, and the
 * wall with its TV link. Each test does the thing, reloads the page to prove it was saved, then
 * puts the data back, so the suite can run next to a seeded demo.
 *   E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/money-ops.spec.ts
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

const undo = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]', { hasText: text }).getByRole('button', { name: 'Undo' });

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => signIn(page));

test('goals: add a goal, reload, change it, delete it', async ({ page }) => {
  await page.goto('/goals');
  await page.getByTestId('goal-add').or(page.getByTestId('goal-add-empty')).first().click();
  await page.getByLabel('What to measure').click();
  await page.getByRole('option', { name: /^Cost per unit/ }).click();
  await page.getByTestId('goal-save').click();
  await expect(page.getByText('Type a number above zero')).toBeVisible();
  await page.getByTestId('goal-value-input').fill('1.85');
  await expect(page.getByTestId('goal-sentence')).toContainText('Cost per unit at or under $1.85');
  await page.getByTestId('goal-save').click();
  const card = page.getByTestId('goal-cost_per_unit-org');
  await expect(card.getByTestId('goal-value')).toHaveText('$1.85');
  await page.reload();
  await expect(card.getByTestId('goal-value')).toHaveText('$1.85');
  await card.getByTestId('goal-edit').click();
  await page.getByTestId('goal-value-input').fill('2.10');
  await page.getByTestId('goal-save').click();
  await expect(card.getByTestId('goal-value')).toHaveText('$2.10');
  await card.getByTestId('how').click();
  await expect(page.getByTestId('how-body')).toContainText('gap to the goal');
  await page.keyboard.press('Escape');
  await card.getByTestId('goal-delete').click();
  await expect(page.getByText('Goal deleted')).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('goal-cost_per_unit-org')).toHaveCount(0);
});

test('alert rules: build a rule with a preview, reload, turn it off, delete it', async ({ page }) => {
  await page.goto('/alerts/rules');
  await page.getByTestId('rule-add').click();
  await page.getByTestId('rule-threshold').fill('');
  await page.getByTestId('rule-save').click();
  await expect(page.getByText('Type a percent, like 15.').first()).toBeVisible();
  await page.getByTestId('rule-threshold').fill('17');
  await expect(page.getByTestId('rule-preview-sentence')).toContainText("Tell me when a job's margin is heading under 17%.");
  await expect(page.getByTestId('rule-preview-total')).toBeVisible();
  await page.getByTestId('rule-quiet').click();
  await page.getByTestId('rule-save').click();
  const row = page.getByTestId('rules-mine-list').getByTestId('rule-row').filter({ hasText: 'heading under 17%' });
  await expect(row).toHaveCount(1);
  await page.reload();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Quiet from 6:00 PM to 6:00 AM');
  await row.getByTestId('rule-toggle').click();
  await expect(row).toHaveAttribute('data-enabled', 'false');
  await row.getByTestId('rule-delete').click();
  await expect(page.getByText('Rule deleted')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('rule-row').filter({ hasText: 'heading under 17%' })).toHaveCount(0);
});

test('alerts: mark one done, see it leave, open it again', async ({ page }) => {
  await page.goto('/alerts');
  const first = page.getByTestId('alert-row').first();
  await expect(first.getByTestId('alert-why')).not.toBeEmpty();
  const id = await first.getAttribute('data-alert-id');
  const mine = page.locator(`[data-alert-id="${id}"]`);
  await mine.getByTestId('alert-resolve').click();
  await expect(mine).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`[data-alert-id="${id}"]`)).toHaveCount(0);
  await page.getByTestId('alerts-tab-done').click();
  await expect(mine).toHaveCount(1);
  await mine.getByTestId('alert-reopen').click();
  await page.getByTestId('alerts-tab-open').click();
  await expect(mine).toHaveCount(1);
});

test('month close: add a company cost, reload, edit in place, delete with undo', async ({ page }) => {
  const stamp = String(Date.now()).slice(-4);
  const amount = `1,9${stamp.slice(0, 2)}.${stamp.slice(2)}`;
  await page.goto('/settings/close');
  await expect(page.getByTestId('close-items').getByRole('listitem')).toHaveCount(6);
  await page.getByTestId('cost-add').or(page.getByTestId('cost-empty').getByRole('button')).first().click();
  const dialog = page.getByTestId('cost-bulk');
  await dialog.locator('input[inputmode="decimal"]').first().fill(amount);
  await dialog.getByRole('button', { name: /^Add 1 cost/ }).click();
  const row = page.getByTestId('cost-ledger').locator('tr', { hasText: `$${amount}` });
  await expect(row).toHaveCount(1);
  await page.reload();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /^Edit paid to/ }).click();
  await page.keyboard.type('Test landlord');
  await page.keyboard.press('Enter');
  await expect(row).toContainText('Test landlord');
  await row.getByRole('button', { name: /^Delete/ }).click();
  await expect(row).toHaveCount(0);
  await undo(page, 'Cost deleted').click();
  await expect(row).toHaveCount(1);
  await page.reload();
  await page.getByTestId('cost-ledger').locator('tr', { hasText: `$${amount}` }).getByRole('button', { name: /^Delete/ }).click();
  await expect(page.getByText('Cost deleted')).toBeVisible();
});

test('wall: big status, no money, and a TV link that works with no login until it is turned off', async ({ page, browser }) => {
  await page.goto('/wall');
  await expect(page.getByTestId('wall-title')).toBeVisible();
  await expect(page.getByTestId('wall')).not.toContainText('$');
  await page.getByTestId('wall-setup').click();
  await page.getByTestId('wall-link-name').fill('E2E line TV');
  await page.getByTestId('wall-link-create').click();
  const url = await page.getByTestId('wall-link-url').inputValue();
  expect(url).toMatch(/\/wall\/t\/[\w-]{20,}$/);
  const tvContext = await browser.newContext();
  const tv = await tvContext.newPage();
  await tv.goto(`${url}?money=1`);
  await expect(tv.getByTestId('wall-title')).toBeVisible();
  await expect(tv.getByTestId('wall')).not.toContainText('$');
  await expect(tv.getByTestId('wall-controls')).toHaveCount(0);
  await page.getByTestId('wall-links').locator('li', { hasText: 'E2E line TV' }).first().getByTestId('wall-link-off').click();
  await expect(page.getByText('E2E line TV is turned off')).toBeVisible();
  await tv.goto(url);
  await expect(tv.getByTestId('wall')).toContainText('This wall link is not active');
  await tvContext.close();
});
