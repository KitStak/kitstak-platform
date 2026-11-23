import { expect, test } from '@playwright/test';
import { CART_CRM_WMS, emailsTo, entitlementsOf, expectPhase, invoicesOf, openBilling, payWith, totalOf, trialAccount, runTestTool } from './support';

test.describe('the free trial ends with no card', () => {
  test('a soft landing: view only, nothing deleted, and paying turns everything back on at once', async ({ page }) => {
    const { person, orgId } = await trialAccount(page, 'trialend', CART_CRM_WMS);
    await expect(page.getByTestId('plan-notice-trial')).toContainText('Free trial. 14 days left.');

    // 11 days in: 3 days left. The banner turns into a warning and the reminder emails have gone out.
    await runTestTool(page, 'shift-7');
    await runTestTool(page, 'shift-1');
    await runTestTool(page, 'shift-1');
    await runTestTool(page, 'shift-1');
    await runTestTool(page, 'shift-1');
    await page.request.post('/api/billing/jobs/tick');
    await page.reload();
    await expect(page.getByTestId('plan-notice-trial_ending')).toContainText('Your free trial ends in 3 days');
    await expect(page.getByTestId('billing-plan-card')).toContainText('3 days left');
    const reminders = await emailsTo(person.email, 'trial_ending');
    expect(reminders.map((mail) => mail.subject)).toContain('Your KitStak trial ends in 3 days');
    const threeDays = reminders.find((mail) => mail.subject === 'Your KitStak trial ends in 3 days');
    expect(threeDays?.body_text).toContain(`Price after the trial: ${totalOf(CART_CRM_WMS)} per month`);
    expect(threeDays?.body_text).toContain('Nothing is deleted if you wait.');

    // The trial ends. No cron is needed for access: it is worked out from the date.
    await runTestTool(page, 'shift-trial-end');
    await page.reload();
    await expectPhase(page, 'trial_ended');
    await expect(page.getByTestId('billing-plan-card')).toContainText('Your free trial ended on');
    await expect(page.getByTestId('billing-plan-card')).toContainText('Your apps are view only. Your data is safe.');
    await expect(page.getByTestId('plan-notice-trial_ended')).toContainText('Your data is safe. Pick a plan to keep working.');
    // Nothing was deleted: the rows are still there, and no invoice was made.
    expect((await entitlementsOf(orgId)).map((row) => row.module)).toEqual(['crm', 'wms']);
    expect(await invoicesOf(orgId)).toHaveLength(0);

    // The "trial has ended" email goes out once, from the one minute job.
    await page.request.post('/api/billing/jobs/tick');
    await page.request.post('/api/billing/jobs/tick');
    const ended = await emailsTo(person.email, 'trial_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.subject).toBe('Your KitStak trial has ended. Your data is safe.');

    // The launcher still opens: a view only app is never a wall.
    await page.goto('/');
    await expect(page.getByTestId('tile-crm')).toBeVisible();
    await expect(page.getByTestId('tile-badge-crm')).toHaveText(/View only|Included/);

    // "Pick a plan" from the banner: the picker with the old cart, then review, then pay. Charged today.
    await page.getByTestId('plan-notice-action').first().click();
    await page.waitForURL(/\/billing\/plan/);
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'checkout');
    await expect(page.getByTestId('quote-total').first()).toHaveText(totalOf(CART_CRM_WMS));
    await expect(page.getByTestId('plan-submit')).toHaveText(/Continue to review/);
    await page.getByTestId('plan-submit').click();
    await page.waitForURL(/\/billing\/checkout/);
    await expect(page.getByTestId('review-due-today')).toHaveText(totalOf(CART_CRM_WMS));
    await expect(page.getByTestId('review-trust')).toContainText(`You pay ${totalOf(CART_CRM_WMS)} today.`);
    await page.getByTestId('review-pay').click();
    await page.waitForURL(/\/test-gateway\/checkout\//);

    const paidAt = Date.now();
    await payWith(page, 'success');
    await page.waitForURL(/\/billing\/checkout\/success/);
    await expect(page.getByTestId('checkout-success')).toBeVisible();
    expect(Date.now() - paidAt).toBeLessThan(15_000);

    // Full access again, at once, with one paid invoice for the same amount.
    await openBilling(page);
    await expectPhase(page, 'active');
    await expect(page.getByTestId('billing-plan-card')).toContainText('Your plan is active.');
    const rows = await entitlementsOf(orgId);
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'active', 'stripe'],
      ['wms', 'active', 'stripe'],
    ]);
    const invoices = await invoicesOf(orgId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'paid', total_cents: 39520, amount_paid_cents: 39520 });
    await expect(page.getByTestId('billing-invoices-preview')).toContainText('$395.20');

    // The receipt is in the outbox, with the same total.
    await page.request.post('/api/billing/jobs/tick');
    const receipts = await emailsTo(person.email, 'receipt');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.subject).toBe('Your KitStak receipt for $395.20');
    expect(receipts[0]?.body_text).toContain('Total paid: $395.20');
  });
});
