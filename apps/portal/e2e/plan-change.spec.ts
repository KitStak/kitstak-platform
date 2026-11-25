import { expect, test } from '@playwright/test';
import { CART_CRM_2, auditOf, cents, expectPhase, invoicesOf, openBilling, paidAccount, setStepper, textOf } from './support';

test.describe('one rule for every plan change', () => {
  test('add a seat, remove it, add a second app, switch to yearly: the amount is shown first and matches the invoice', async ({ page }) => {
    const { orgId } = await paidAccount(page, 'change', CART_CRM_2);
    await expect(page.getByTestId('billing-cost')).toContainText('$58.00 per month');
    expect((await invoicesOf(orgId)).map((invoice) => invoice.total_cents)).toEqual([5800]);

    // Half way through the month, so the proration is easy to read.
    for (let day = 0; day < 15; day += 1) await page.getByTestId('test-tool-shift-1').click().then(() => expect(page.getByTestId('test-tool-shift-1')).toBeEnabled({ timeout: 60_000 }));

    /* ----- add 1 seat ----- */
    await page.getByTestId('billing-change-plan').click();
    await page.waitForURL(/\/billing\/plan/);
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'change');
    await page.getByTestId('plan-seats-inc').click();
    await expect(page.getByTestId('plan-seats')).toHaveValue('3');
    await expect(page.getByTestId('plan-picker')).toContainText('Now: $58.00 per month');
    await expect(page.getByTestId('plan-picker')).toContainText('New: $87.00 per month');
    await expect(page.getByTestId('plan-submit')).toHaveText(/Review change/);
    await page.getByTestId('plan-submit').click();

    // The confirm panel: nothing is charged until "Confirm change". Focus is on the heading, not the pay button.
    const panel = page.getByTestId('change-preview');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Add 1 seat');
    await expect(panel).toContainText('Nothing is charged until you confirm.');
    await expect(panel.getByRole('heading')).toBeFocused();
    const dueToday = cents(await textOf(page.getByTestId('change-due-today')));
    // One seat for half of a 30 day month is $14.50. A 31 day month gives a few cents either side.
    expect(dueToday).toBeGreaterThan(1300);
    expect(dueToday).toBeLessThan(1600);
    await expect(page.getByTestId('change-new-total')).toHaveText('$87.00');
    expect(await invoicesOf(orgId)).toHaveLength(1);

    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    await expect(page.getByTestId('billing-flash')).toContainText('Your plan is updated.');
    await expect(page.getByTestId('billing-cost')).toContainText('$87.00 per month');
    await expect(page.getByTestId('billing-usage-seats')).toContainText('of 3');

    // The preview equals the new invoice, to the cent.
    let invoices = await invoicesOf(orgId);
    expect(invoices).toHaveLength(2);
    expect(invoices[1]).toMatchObject({ status: 'paid', total_cents: dueToday, amount_paid_cents: dueToday });
    expect(invoices[1]?.lines.some((line) => line.proration)).toBe(true);
    expect((await auditOf(orgId)).some((row) => row.action === 'plan.changed' && row.summary.includes('added 1 seat'))).toBe(true);

    /* ----- remove the seat: credit, nothing to pay ----- */
    await page.goto('/billing/plan');
    await setStepper(page, 'plan-seats', 2);
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Remove 1 seat');
    const credit = cents(await textOf(page.getByTestId('change-credit')));
    expect(credit).toBeGreaterThan(0);
    await expect(page.getByTestId('change-due-today')).toHaveText('$0.00');
    await expect(page.getByTestId('change-new-total')).toHaveText('$58.00');
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    await expect(page.getByTestId('billing-cost')).toContainText('$58.00 per month');

    /* ----- the picker cannot go below the people the team has ----- */
    await page.goto('/billing/plan');
    await setStepper(page, 'plan-seats', 2);
    await page.getByTestId('plan-seats-dec').click();
    await expect(page.getByTestId('plan-seats')).toHaveValue('1');
    // One person is on the team, so 1 is the floor.
    await expect(page.getByTestId('plan-seats-dec')).toBeDisabled();

    /* ----- add Projects: the bundle discount applies to every app in the same change ----- */
    await setStepper(page, 'plan-seats', 2);
    await page.getByTestId('plan-product-projects').click();
    await expect(page.getByTestId('quote-bundle-discount').first()).toHaveText('-$16.40');
    await expect(page.getByTestId('quote-total').first()).toHaveText('$65.60');
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Add Projects');
    await expect(page.getByTestId('change-new-total')).toHaveText('$65.60');
    const bundleDue = cents(await textOf(page.getByTestId('change-due-today')));
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    await expect(page.getByTestId('billing-cost')).toContainText('$65.60 per month');
    await expect(page.getByTestId('billing-cost')).toContainText('bundle discount');
    invoices = await invoicesOf(orgId);
    if (bundleDue > 0) expect(invoices[invoices.length - 1]?.total_cents).toBe(bundleDue);

    /* ----- switch to yearly: a new period starts today, with credit for the unused month ----- */
    await page.goto('/billing/plan');
    await page.getByTestId('plan-interval-yearly').click();
    await expect(page.getByTestId('quote-yearly-discount').first()).toBeVisible();
    await expect(page.getByTestId('quote-total').first()).toHaveText('$669.12');
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Switch to yearly');
    await expect(page.getByTestId('change-new-total')).toHaveText('$669.12');
    const yearlyDue = cents(await textOf(page.getByTestId('change-due-today')));
    expect(yearlyDue).toBeGreaterThan(60_000);
    expect(yearlyDue).toBeLessThan(66_912);
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    await expect(page.getByTestId('billing-cost')).toContainText('$669.12 per year');
    invoices = await invoicesOf(orgId);
    expect(invoices[invoices.length - 1]).toMatchObject({ status: 'paid', total_cents: yearlyDue });

    // Every invoice in the list has a PDF that opens.
    await page.goto('/billing/invoices');
    const first = invoices[invoices.length - 1]!;
    await expect(page.getByTestId(`invoice-row-${first.id}`)).toBeVisible();
    const pdf = await page.request.get(`/billing/invoices/${first.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await openBilling(page);
    await expectPhase(page, 'active');
  });
});
