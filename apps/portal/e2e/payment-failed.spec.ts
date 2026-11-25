import { expect, test } from '@playwright/test';
import { CART_PULSE, auditOf, emailsTo, entitlementsOf, expectPhase, invoicesOf, openBilling, paidAccount, portalAppsOpen, skipDays, runTestTool } from './support';

test.describe('a payment fails at renewal', () => {
  test('email and banner with the amount, card, retry date and access date; a new card restores everything at once', async ({ page }) => {
    // The card pays the first charge and fails every charge after that.
    const { person, orgId } = await paidAccount(page, 'pastdue', CART_PULSE, 'fails_on_renewal');
    await expect(page.getByTestId('billing-payment-method')).toContainText('ending 0341');

    // One month later the renewal fails.
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');

    // Full access continues during the 7 days. The banner names the amount, the card and both dates.
    expect((await entitlementsOf(orgId)).map((row) => [row.module, row.status])).toEqual([['pulse', 'past_due']]);
    const banner = page.getByTestId('plan-notice-payment_failed');
    await expect(banner).toContainText('We could not charge your Visa ending 0341 for $29.00.');
    await expect(banner).toContainText(/We will try again on [A-Z][a-z]{2} \d{1,2}\./);
    await expect(banner).toContainText(/Update your card by [A-Z][a-z]{2} \d{1,2} to keep full access\./);
    await expect(page.getByTestId('plan-notice-action').first()).toHaveText(/Update card/);
    await expect(page.getByTestId('billing-plan-card')).toContainText('We could not charge your Visa ending 0341 for $29.00.');

    // Home says it in one quiet line on the tile. The app still opens.
    await page.goto('/');
    await expect(page.getByTestId('tile-pulse')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('tile-plan-pulse')).toHaveText(/^Payment past due\. Open until [A-Z][a-z]{2} \d{1,2}\.$/);
    await expect(page.getByTestId('plan-notice-payment_failed')).toBeVisible();
    await openBilling(page);

    // The email says the same four things.
    await page.request.post('/api/billing/jobs/tick');
    const failed = await emailsTo(person.email, 'payment_failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.subject).toBe('We could not charge your card for KitStak');
    expect(failed[0]?.body_text).toContain('We could not charge the card ending 0341 for $29.00.');
    expect(failed[0]?.body_text).toMatch(/We try again on: [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(failed[0]?.body_text).toMatch(/Full access until: [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(failed[0]?.body_text).toContain('/billing?fix=payment');

    // "Pay now" with the same card fails again and says so. Nothing changes.
    await page.getByTestId('billing-pay-now').click();
    await expect(page.getByText('That card was declined. Try another card or call your bank.').first()).toBeVisible();
    await expectPhase(page, 'past_due');

    // One click fix: "Update card" from the banner goes to billing home with the card in focus.
    await page.getByTestId('plan-notice-action').first().click();
    await page.waitForURL(/\/billing\?.*fix=payment/);
    await page.getByTestId('billing-update-card').click();
    await page.waitForURL(/\/test-gateway\/card\//);
    // The card page names what saving will charge (review round 3).
    await expect(page.getByTestId('test-card-due')).toHaveText('You have an unpaid bill of $29.00. We charge it to the new card right after you save.');
    await page.getByTestId('test-card-chip-success').click();
    const fixedAt = Date.now();
    await page.getByTestId('test-pay').click();

    // Back on billing home the open invoice is paid at once and the banner is gone.
    await page.waitForURL(/\/billing/);
    await expect(page.getByTestId('billing-home')).toBeVisible();
    await expect(page.getByTestId('billing-flash')).toContainText('Card updated. Your payment went through.');
    expect(Date.now() - fixedAt).toBeLessThan(15_000);
    await expectPhase(page, 'active');
    // The banner under the top bar is drawn while the payment is still being taken, so it goes
    // away with the next page load.
    await openBilling(page);
    await expect(page.getByTestId('plan-notice-payment_failed')).toHaveCount(0);
    await expect(page.getByTestId('billing-payment-method')).toContainText('Visa ending 4242');
    expect((await entitlementsOf(orgId)).map((row) => [row.module, row.status])).toEqual([['pulse', 'active']]);

    const invoices = await invoicesOf(orgId);
    expect(invoices.map((invoice) => [invoice.status, invoice.total_cents])).toEqual([
      ['paid', 2900],
      ['paid', 2900],
    ]);
    // A receipt for each payment, and the story is in the activity log in plain words.
    await page.request.post('/api/billing/jobs/tick');
    expect(await emailsTo(person.email, 'receipt')).toHaveLength(2);
    const actions = (await auditOf(orgId)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['payment.failed', 'card.updated', 'payment.succeeded']));
  });

  test('not fixed in 7 days: the last day reminder, then view only, and nothing is deleted', async ({ page }) => {
    const { person, orgId } = await paidAccount(page, 'unpaid', CART_PULSE, 'fails_on_renewal');
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');

    // Day 6 of the 7: one day of full access is left, and the last day email goes out once.
    await skipDays(page, 5);
    await runTestTool(page, 'run-due');
    await page.request.post('/api/billing/jobs/tick');
    await page.request.post('/api/billing/jobs/tick');
    const lastDay = await emailsTo(person.email, 'grace_ending');
    expect(lastDay).toHaveLength(1);
    expect(lastDay[0]?.subject).toBe('Last day to fix your KitStak payment');
    expect(lastDay[0]?.body_text).toContain('We still could not collect $29.00');

    // Day 8: view only. The plan is still open and can be paid.
    await skipDays(page, 2);
    await page.reload();
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'unpaid');
    // With the allow all switch on every app is open, and the Portal never says "view only" then.
    const appsOpen = await portalAppsOpen(page);
    await expect(page.getByTestId('billing-plan-card')).toContainText(appsOpen ? 'Your payment is late.' : 'Your payment is late, so your apps are view only.');
    await expect(page.getByTestId('plan-notice-unpaid')).toContainText(
      appsOpen ? 'Your payment is late. Update your card to keep your apps open.' : 'Your payment is late, so your apps are view only. Update your card to turn them back on.',
    );
    // The sentence and the button use one name for the fix (review round 4).
    await expect(page.getByTestId('plan-notice-unpaid')).not.toContainText('Pay now');
    // Home: the tile is still there (a view only app opens) and names the same fix.
    await page.goto('/');
    await expect(page.getByTestId('tile-pulse')).toBeVisible({ timeout: 90_000 });
    if (appsOpen) await expect(page.getByTestId('tile-plan-pulse')).toHaveCount(0);
    else await expect(page.getByTestId('tile-plan-pulse')).toHaveText('View only. Update your card to make changes.');
    await openBilling(page);
    expect((await entitlementsOf(orgId)).map((row) => row.module)).toEqual(['pulse']);
    expect((await invoicesOf(orgId)).filter((invoice) => invoice.status === 'open')).toHaveLength(1);

    // Paying turns everything back on at once.
    await page.getByTestId('billing-update-card').click();
    await page.waitForURL(/\/test-gateway\/card\//);
    await page.getByTestId('test-card-chip-success').click();
    await page.getByTestId('test-pay').click();
    await page.waitForURL(/\/billing/);
    await expect(page.getByTestId('billing-home')).toBeVisible();
    await expectPhase(page, 'active');
    await openBilling(page);
    await expect(page.getByTestId('plan-notice-unpaid')).toHaveCount(0);
  });
});
