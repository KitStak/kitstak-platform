import { expect, test } from '@playwright/test';
import { formatMoney } from '@kitstak/billing/catalog';
import {
  CART_CRM_WMS,
  auditOf,
  cents,
  invoicesOf,
  openBilling,
  openTestCheckout,
  paidAccount,
  payWith,
  runTestTool,
  setStepper,
  sql,
  textOf,
  trialAccount,
} from './support';

/**
 * Review round 1: the number a person reads is the number the next invoice charges.
 * A promo code, and credit from a plan change, both show on every screen before they are used.
 */
test.describe('the amount shown is the amount charged', () => {
  test('a promo code: the pay page, the success page and billing home all show the first charge the first invoice makes', async ({ page }) => {
    const { orgId } = await trialAccount(page, 'promo', CART_CRM_WMS);
    await openTestCheckout(page);
    // Before the code: the plain price.
    await expect(page.getByTestId('test-first-charge')).toContainText('$395.20');
    await expect(page.getByTestId('test-promo-line')).toHaveCount(0);

    await page.getByTestId('test-promo').fill('TEST10');
    await page.getByTestId('test-promo-apply').click();
    // The moment the code is accepted the summary gains its line and the new first charge.
    await expect(page.getByTestId('test-promo-line')).toHaveText('-$39.52');
    await expect(page.getByTestId('test-first-charge')).toContainText('$355.68');
    await expect(page.getByTestId('test-due-today')).toHaveText('$0.00');

    await payWith(page, 'success');
    await page.waitForURL(/\/billing\/checkout\/success/, { timeout: 90_000 });
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('success-next-charge')).toContainText('$355.68');
    await expect(page.getByTestId('success-discount')).toHaveText('-$39.52');

    await openBilling(page);
    await expect(page.getByTestId('billing-next-charge')).toContainText('$355.68');
    await expect(page.getByTestId('billing-next-charge')).toContainText('Promo code TEST10 (10% off): $39.52 off.');
    await expect(page.getByTestId('billing-next-charge')).not.toContainText('$395.20');
    const [row] = await sql<{ next_charge_cents: number; next_discount_cents: number }>(
      'select next_charge_cents, next_discount_cents from core.billing_subscriptions where org_id = $1',
      [orgId],
    );
    expect(row).toEqual({ next_charge_cents: 35568, next_discount_cents: 3952 });

    // The end of the trial: the first invoice is the amount every screen showed, to the cent.
    await runTestTool(page, 'shift-trial-end');
    const invoices = (await invoicesOf(orgId)).filter((invoice) => invoice.total_cents > 0);
    expect(invoices.map((invoice) => invoice.total_cents)).toEqual([35568]);
    // The code was for the first charge only. The next one is the full price again.
    await page.reload();
    await expect(page.getByTestId('billing-next-charge')).toContainText('$395.20');
  });

  test('credit from a plan change: billing home shows it, the next charge is less by it, and the renewal invoice matches', async ({ page }) => {
    const { orgId } = await paidAccount(page, 'credit', { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' });
    await expect(page.getByTestId('billing-next-charge')).toContainText('$145.00');
    await expect(page.getByTestId('billing-credit')).toHaveCount(0);

    // Remove 3 seats: credit, nothing to pay.
    await page.goto('/billing/plan');
    await setStepper(page, 'plan-seats', 2);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('change-preview')).toBeVisible();
    const credit = cents(await textOf(page.getByTestId('change-credit')));
    expect(credit).toBeGreaterThan(0);
    await expect(page.getByTestId('change-due-today')).toHaveText('$0.00');
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);

    // Billing home says the credit, and the next charge is the plan price less the credit.
    const onNextBill = Math.min(credit, 5800);
    const next = 5800 - onNextBill;
    await expect(page.getByTestId('billing-credit')).toContainText('Credit: ' + formatMoney(credit) + '. It comes off your next bill');
    await expect(page.getByTestId('billing-next-charge')).toContainText(
      next === 0
        ? formatMoney(0) + '. Your credit pays this bill in full.'
        : formatMoney(next) + ' to your Visa ending 4242, after ' + formatMoney(onNextBill) + ' credit.',
    );
    expect((await auditOf(orgId)).some((entry) => entry.action === 'plan.changed' && entry.summary.includes('credit was added'))).toBe(true);
    const [row] = await sql<{ credit_cents: number; next_charge_cents: number; next_credit_cents: number }>(
      'select credit_cents, next_charge_cents, next_credit_cents from core.billing_subscriptions where org_id = $1',
      [orgId],
    );
    expect(row).toEqual({ credit_cents: credit, next_charge_cents: next, next_credit_cents: onNextBill });

    // The cancel page says what happens to the credit.
    await page.goto('/billing/cancel');
    await expect(page.getByTestId('cancel-credit')).toContainText('You have ' + formatMoney(credit) + ' credit. It stays on your account.');

    // Renewal: the invoice total is the number billing home showed.
    await openBilling(page);
    await runTestTool(page, 'shift-30');
    await runTestTool(page, 'run-due');
    const invoices = await invoicesOf(orgId);
    const renewal = invoices[invoices.length - 1];
    expect(renewal?.total_cents).toBe(next);
    expect((await auditOf(orgId)).some((entry) => entry.action === 'payment.credit_used')).toBe(true);

    // A period that began a moment ago: one more seat costs the whole $29.00 (whole days, never
    // $28.99), and the credit that is left pays its part. The panel says so.
    const left = credit - onNextBill;
    await page.goto('/billing/plan');
    await page.getByTestId('plan-seats-inc').click();
    await expect(page.getByTestId('plan-seats')).toHaveValue('3');
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('change-preview')).toBeVisible();
    await expect(page.getByTestId('change-due-today')).toHaveText(formatMoney(Math.max(0, 2900 - left)));
    if (left > 0) await expect(page.getByTestId('change-preview')).toContainText('from your credit');
  });
});
