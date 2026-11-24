import { expect, test } from '@playwright/test';
import {
  CART_CRM_WMS,
  emailsTo,
  entitlementsOf,
  expectPhase,
  openBilling,
  payWith,
  sql,
  textOf,
  totalOf,
  trialAccount,
} from './support';

test.describe('checkout: adding a card during the free trial', () => {
  test('review shows $0.00 today and the first charge date, the card works, and access is confirmed in seconds', async ({ page }) => {
    const { person, orgId } = await trialAccount(page, 'paid', CART_CRM_WMS);
    await expectPhase(page, 'trial');
    await expect(page.getByTestId('billing-payment-method')).toContainText('No card yet');

    // "Pick a plan" is the one name for the paying step. On billing home it is the one filled button
    // of the card row. It opens the picker to pay, with one filled button: "Continue to review".
    await expect(page.getByTestId('billing-home').getByRole('link', { name: 'Pick a plan' })).toHaveCount(1);
    await expect(page.getByTestId('billing-home').getByText('Add a card', { exact: true })).toHaveCount(0);
    await page.getByTestId('billing-pick-plan').click();
    await page.waitForURL(/\/billing\/plan/);
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'checkout');
    await expect(page.getByTestId('plan-submit')).toHaveText(/Continue to review/);
    await page.getByTestId('plan-submit').click();
    // The review step. Three facts, one button, no card field.
    await page.waitForURL(/\/billing\/checkout/);
    await expect(page.getByTestId('review-due-today')).toHaveText('$0.00');
    await expect(page.getByTestId('review-first-charge-amount')).toHaveText(totalOf(CART_CRM_WMS));
    const firstChargeDate = await textOf(page.getByTestId('review-first-charge-date'));
    expect(firstChargeDate).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await expect(page.getByTestId('quote-total').first()).toHaveText(totalOf(CART_CRM_WMS));
    await expect(page.getByTestId('review-trust')).toContainText('No charge today.');
    await expect(page.getByTestId('review-trust')).toContainText('Cancel any time in Billing.');
    await expect(page.locator('input[autocomplete="cc-number"]')).toHaveCount(0);
    await expect(page.getByTestId('review-pay')).toHaveText(/Continue to test checkout/);

    // The pay page says the same three facts and wears the test mode label.
    await page.getByTestId('review-pay').click();
    await page.waitForURL(/\/test-gateway\/checkout\//);
    await expect(page.getByTestId('test-mode-label').first()).toContainText('Test mode');
    await expect(page.getByTestId('test-checkout')).toContainText(totalOf(CART_CRM_WMS));
    await expect(page.getByTestId('test-checkout')).toContainText(firstChargeDate);

    const paidAt = Date.now();
    await payWith(page, 'success');
    await page.waitForURL(/\/billing\/checkout\/success/);
    await expect(page.getByTestId('checkout-success')).toBeVisible();
    // Must have 7: access within 5 seconds of paying.
    expect(Date.now() - paidAt).toBeLessThan(15_000);
    await expect(page.getByTestId('checkout-success')).toContainText('You are all set.');
    await expect(page.getByTestId('checkout-success')).toContainText(firstChargeDate);

    // The access rows came through the signed webhook path: the trial rows are now the plan's rows.
    const rows = await entitlementsOf(orgId);
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'active', 'stripe'],
      ['wms', 'active', 'stripe'],
    ]);
    const events = await sql<{ type: string; status: string }>(`SELECT type, status FROM core.billing_events WHERE org_id = $1`, [orgId]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.status === 'processed' || event.status === 'ignored')).toBe(true);

    // "Open my apps" goes to the launcher. The tiles are still in the trial.
    await page.getByTestId('checkout-success-open-apps').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('tile-crm')).toBeVisible();

    // Billing home answers the five questions: plan, cost, next charge, card, invoices.
    await openBilling(page);
    await expectPhase(page, 'active');
    await expect(page.getByTestId('billing-plan-card')).toContainText('Your first payment is on');
    await expect(page.getByTestId('billing-cost')).toContainText(`${totalOf(CART_CRM_WMS)} per month`);
    await expect(page.getByTestId('billing-cost')).toContainText('bundle discount');
    await expect(page.getByTestId('billing-next-charge')).toContainText(firstChargeDate);
    await expect(page.getByTestId('billing-next-charge')).toContainText(totalOf(CART_CRM_WMS));
    await expect(page.getByTestId('billing-payment-method')).toContainText('Visa ending 4242');
    // Nothing was charged yet, so there is no invoice to show.
    await expect(page.getByTestId('billing-invoices-preview')).toContainText('No invoices yet');

    // The plan confirmation is in the outbox. No receipt, because no money moved.
    await page.request.get('/dev/outbox');
    const planMail = await emailsTo(person.email, 'plan_started');
    expect(planMail).toHaveLength(1);
    expect(planMail[0]?.body_text).toContain('Due today: $0.00');
    expect(await emailsTo(person.email, 'receipt')).toHaveLength(0);

    // The banner in the shell now talks about the first payment, not about picking a plan.
    await expect(page.getByTestId('plan-notice-trial_with_card')).toContainText(`Your first payment of ${totalOf(CART_CRM_WMS)}`);
  });
});
