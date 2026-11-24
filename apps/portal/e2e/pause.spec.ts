import { expect, test } from '@playwright/test';
import { CART_PULSE, emailsTo, entitlementsOf, expectPhase, invoicesOf, paidAccount, portalAppsOpen, skipDays, runTestTool } from './support';

test.describe('pause for 1, 2 or 3 months', () => {
  test('pause 2 months: dates shown, no bill while paused, view only, then it starts again by itself', async ({ page }) => {
    const { person, orgId } = await paidAccount(page, 'pause', CART_PULSE);
    expect(await invoicesOf(orgId)).toHaveLength(1);

    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await expect(page.getByTestId('cancel-offer-pause')).toContainText('No bills while paused.');
    for (const months of [1, 2, 3]) await expect(page.getByTestId(`cancel-pause-${months}`)).toBeVisible();
    await page.getByTestId('cancel-pause-2').click();
    await expect(page.getByTestId('cancel-offer-pause')).toContainText(/Paused from [A-Z][a-z]{2} \d{1,2}, \d{4}\. Starts again on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    await page.getByTestId('cancel-pause-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'pause_scheduled');
    await expect(page.getByTestId('billing-plan-card')).toContainText(/Your plan pauses on [A-Z][a-z]{2} \d{1,2}, \d{4} and starts again on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    await expect(page.getByTestId('billing-undo-pause')).toBeVisible();
    await page.request.post('/api/billing/jobs/tick');
    const mail = await emailsTo(person.email, 'paused');
    expect(mail).toHaveLength(1);
    expect(mail[0]?.body_text).toContain('There are no bills during the pause.');

    // Past the start of the pause: view only, and no invoice was made.
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'paused');
    await expect(page.getByTestId('billing-plan-card')).toContainText(/Your plan is paused\. It starts again on/);
    // With the allow all switch on every app is open, and the Portal never says "view only" then.
    await expect(page.getByTestId('plan-notice-paused')).toContainText(
      (await portalAppsOpen(page)) ? /Your plan is paused\. It starts again on/ : 'Your plan is paused, so your apps are view only.',
    );
    expect(await invoicesOf(orgId)).toHaveLength(1);
    expect((await entitlementsOf(orgId)).map((row) => row.module)).toEqual(['pulse']);

    // Past the end of the pause: active again by itself, with full access.
    await skipDays(page, 63);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'active');
    await expect(page.getByTestId('plan-notice-paused')).toHaveCount(0);
    expect((await entitlementsOf(orgId)).map((row) => [row.module, row.status])).toEqual([['pulse', 'active']]);

    // And billed again from the next period on. (Like Stripe, the gateway bills at the first period
    // boundary after the pause ends, so one more month makes sure a boundary has passed.)
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    const invoices = await invoicesOf(orgId);
    expect(invoices.length).toBeGreaterThanOrEqual(2);
    expect(invoices.every((invoice) => invoice.status === 'paid' && invoice.total_cents === 2900)).toBe(true);
  });

  test('a pause can be undone before it starts, with one click', async ({ page }) => {
    await paidAccount(page, 'unpause', CART_PULSE);
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-pause-1').click();
    await page.getByTestId('cancel-pause-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'pause_scheduled');
    await page.getByTestId('billing-undo-pause').click();
    await expectPhase(page, 'active');
    await expect(page.getByTestId('billing-flash')).toContainText('Your pause is off. Your plan carries on as before.');
  });
});
