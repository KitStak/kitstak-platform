import { expect, test } from '@playwright/test';
import type { PlanSelection } from '@kitstak/billing/catalog';
import {
  APP_URLS,
  appIsUp,
  emailsTo,
  inviteLinkFor,
  invoicesOf,
  joinFromInvite,
  newPerson,
  paidAccount,
  sql,
  totalOf,
  userIdOf,
} from './support';

/** Every app is in the plan, so an app that turns the bookkeeper away does it for their role, not for the plan. */
const CART_ALL: PlanSelection = { products: ['crm', 'wms', 'projects', 'pulse'], seats: 2, warehouses: 1, interval: 'monthly' };

/**
 * Review round 2. The person who pays the bills does not need a paid seat. An owner invites them by
 * email on the Billing team page. They get Billing only: free, no seat, no access to the apps.
 */
test.describe('a billing manager who holds no seat', () => {
  test('invited by email for billing only: free, sees and manages billing, cannot open the apps, and can be removed', async ({ browser, page }) => {
    test.setTimeout(360_000);
    // A plan with every app, 2 seats and one person, so there is exactly one seat left.
    const { person: owner, orgId } = await paidAccount(page, 'bookowner', CART_ALL);
    const books = newPerson('books', 'Robin Vale');

    await page.goto('/billing/team');
    await expect(page.getByText('Billing only. Free. No access to your apps. Good for a bookkeeper.')).toBeVisible();
    await page.getByTestId('team-invite-email').fill(books.email);
    await page.getByTestId('team-invite').click();
    await expect(page.getByText(`We sent an invite to ${books.email}.`)).toBeVisible({ timeout: 30_000 });
    const inviteRow = page.getByTestId('team-invite-row');
    await expect(inviteRow).toContainText(books.email);
    await expect(inviteRow).toContainText('Billing only');
    const invites = await sql<{ role: string; status: string }>(
      `SELECT role, status FROM core.invitation WHERE organization_id = $1 AND email = $2`,
      [orgId, books.email],
    );
    expect(invites).toEqual([{ role: 'billing', status: 'pending' }]);

    // The open invite holds no seat: the plan can still not go below 1, and 1 is fine.
    const link = await inviteLinkFor(page, books.email);

    /* ----- the bookkeeper joins ----- */
    const booksContext = await browser.newContext();
    const booksPage = await booksContext.newPage();
    await booksPage.goto(link);
    await expect(booksPage.locator('body')).toContainText('as a billing manager');
    await joinFromInvite(booksPage, link, books);
    // Billing is their home. The launcher sends them there.
    await booksPage.goto('/');
    await booksPage.waitForURL((url) => url.pathname === '/billing', { timeout: 60_000 });
    await expect(booksPage.getByTestId('billing-home')).toBeVisible({ timeout: 90_000 });
    await expect(booksPage.getByTestId('billing-cost')).toContainText(`${totalOf(CART_ALL)} per month`);
    await expect(booksPage.getByTestId('billing-change-plan')).toBeVisible();

    const booksId = await userIdOf(books.email);
    const roles = await sql<{ role: string }>(`SELECT role FROM core.member WHERE organization_id = $1 AND user_id = $2`, [orgId, booksId]);
    expect(roles).toEqual([{ role: 'billing' }]);

    // Review round 3: she opened the link from the invite email, which only her mailbox has. That
    // proves the address, for this role like for any other: it is marked verified, no code email
    // goes out, no "enter the 6 digit code" bar shows, and the plan page is not locked.
    expect(link).toMatch(/\/invite\/[0-9a-f-]{36}\?t=[A-Za-z0-9_-]{43}$/);
    expect(await sql<{ email_verified: boolean }>(`SELECT email_verified FROM core."user" WHERE id = $1`, [booksId])).toEqual([{ email_verified: true }]);
    expect(await emailsTo(books.email, 'verify_email')).toHaveLength(0);
    await expect(booksPage.getByText('6 digit code')).toHaveCount(0);
    await booksPage.goto('/billing/plan');
    await expect(booksPage.locator('main').first()).toBeVisible({ timeout: 90_000 });
    await expect(booksPage.getByText('Verify your email first')).toHaveCount(0);
    await expect(booksPage.getByText('6 digit code')).toHaveCount(0);

    // They can do what a billing manager does: an invoice file and the activity log.
    const invoice = (await invoicesOf(orgId))[0]!;
    const pdf = await booksPage.request.get(`/billing/invoices/${invoice.id}/pdf`);
    expect(pdf.status()).toBe(200);
    await booksPage.goto('/billing/activity');
    await expect(booksPage.getByTestId('billing-activity')).toBeVisible({ timeout: 90_000 });
    // They cannot add or remove billing managers. Only an owner can.
    await booksPage.goto('/billing/team');
    await expect(booksPage.getByTestId('team-invite-form')).toHaveCount(0);

    /* ----- no seat is used ----- */
    await page.goto('/billing/team');
    const row = page.getByTestId(`team-row-${booksId}`);
    await expect(row).toContainText('Billing only');
    await expect(row).toContainText('Free. No seat and no access to your apps.');
    // The plan has 2 seats and still only 1 is in use: the picker lets the owner go down to 1.
    await page.goto('/billing/plan');
    await expect(page.getByTestId('plan-seats')).toHaveValue('2');
    await page.getByTestId('plan-seats-dec').click();
    await expect(page.getByTestId('plan-seats')).toHaveValue('1');
    await expect(page.getByTestId('plan-seats-dec')).toBeDisabled();

    /* ----- no access to the apps ----- */
    for (const [app, url] of Object.entries(APP_URLS)) {
      if (!(await appIsUp(booksPage, url))) {
        test.info().annotations.push({ type: 'skipped part', description: `${app} is not running at ${url}` });
        continue;
      }
      const response = await booksPage.goto(url, { waitUntil: 'domcontentloaded' });
      await booksPage.waitForLoadState('networkidle').catch(() => undefined);
      const landed = booksPage.url();
      const text = (await booksPage.locator('body').innerText()).toLowerCase();
      // No access reads as one of three things: the app answers with an error, it sends the person
      // away (to the Portal or to its sign in page), or it says in words that they have no access.
      const sentAway = !landed.startsWith(url) || /\/(login|sign-in|signin|no-access|no-workspace|forbidden)\b/.test(new URL(landed).pathname);
      const saysNo = /no access|not have access|do not have access|don.t have access|ask an? (owner|admin)|not a member|access denied|forbidden|not allowed|no workspace|not part of|not in an organization|you need access|request access|ask an? (owner|admin|teammate)/.test(text);
      const denied = (response?.status() ?? 200) >= 400 || sentAway || saysNo;
      test.info().annotations.push({ type: 'app answer', description: `${app}: ${landed} | ${text.replace(/\s+/g, ' ').slice(0, 160)}` });
      expect({ app, denied, landed, sample: text.replace(/\s+/g, ' ').slice(0, 200) }).toMatchObject({ app, denied: true });
    }

    /* ----- the owner removes them ----- */
    await page.goto('/billing/team');
    await page.getByRole('button', { name: `Remove ${books.name} as billing manager` }).click();
    await expect(page.getByText(`${books.name} is removed and can no longer manage billing.`)).toBeVisible({ timeout: 30_000 });
    expect(await sql(`SELECT 1 FROM core.member WHERE organization_id = $1 AND user_id = $2`, [orgId, booksId])).toEqual([]);
    await booksPage.goto('/billing');
    await expect(booksPage.getByTestId('billing-home')).toHaveCount(0);
    await booksContext.close();
    void owner;
  });
});
