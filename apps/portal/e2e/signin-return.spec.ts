import { expect, test, type Page } from '@playwright/test';
import { BASE_URL, CART_PULSE, expectPhase, paidAccount, type Person } from './support';

/**
 * Review round 3: every button in a billing email works for a person whose session has ended. A
 * signed out visit goes to sign in and back to the page that was asked for, with its query.
 */
async function signIn(page: Page, person: Person): Promise<void> {
  await page.getByLabel('Work email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('a signed out link keeps where it was going', () => {
  test('the "Update card" button of the failed payment email: sign in, land on billing with the card in focus', async ({ page, context }) => {
    const { person } = await paidAccount(page, 'returnto', CART_PULSE);

    // The session ends (the email is opened days later, or on another device).
    await context.clearCookies();

    // 1. The redirect itself carries the page and the query for each link the emails use.
    const targets = ['/billing?fix=payment', '/billing/plan?add=projects', '/billing/invoices', '/settings/organization'];
    for (const target of targets) {
      const response = await page.request.get(`${BASE_URL}${target}`, { maxRedirects: 0 });
      expect(response.status(), target).toBe(307);
      expect(response.headers().location, target).toBe(`/login?next=${encodeURIComponent(target)}`);
    }

    // 2. The whole way for the failed payment email: open the link, sign in, land on the card.
    await page.goto('/billing?fix=payment');
    await page.waitForURL(/\/login\?next=%2Fbilling%3Ffix%3Dpayment/);
    await signIn(page, person);
    await page.waitForURL(/\/billing\?(.*&)?fix=payment/);
    await expect(page.getByTestId('billing-home')).toBeVisible();
    await expectPhase(page, 'active');
    // The Payment method card is brought into view and its "Update card" button holds the focus.
    await expect(page.getByTestId('billing-payment-method').getByRole('button', { name: 'Update card' })).toBeFocused();

    // 3. And for "Pick a plan" style links with their own query.
    await context.clearCookies();
    await page.goto('/billing/plan?add=projects');
    await page.waitForURL(/\/login\?next=%2Fbilling%2Fplan%3Fadd%3Dprojects/);
    await signIn(page, person);
    await page.waitForURL(/\/billing\/plan\?(.*&)?add=projects/);

    // 4. A receipt's "View invoice", which has no query but is not the launcher either.
    await context.clearCookies();
    await page.goto('/billing/invoices');
    await page.waitForURL(/\/login\?next=%2Fbilling%2Finvoices/);
    await signIn(page, person);
    await page.waitForURL(/\/billing\/invoices$/);
  });

  test('an address that points outside is never used as the place to return to', async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}/billing`, { maxRedirects: 0, headers: { 'x-kitstak-return-to': 'https://evil.example/' } });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/login?next=%2Fbilling');
  });
});
