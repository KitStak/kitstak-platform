import { expect, test } from '@playwright/test';
import type { PlanSelection } from '@kitstak/billing/catalog';
import { cents, paidAccount, textOf } from './support';

/**
 * Review round 3: removing an app can raise the bill, because the bundle discount needs 2 apps. The
 * confirm panel says so before anyone confirms, and every sentence names the real cause.
 */
const CRM_PULSE: PlanSelection = { products: ['crm', 'pulse'], seats: 7, warehouses: 1, interval: 'monthly' };

test.describe('a plan change that starts or ends the bundle discount', () => {
  test('removing Pulse from CRM and Pulse: a plain warning, the new price, and math that adds up', async ({ page }) => {
    await paidAccount(page, 'bundleend', CRM_PULSE);
    await expect(page.getByTestId('billing-cost')).toContainText('$185.60 per month');
    // A few days into the month, so there is something to prorate.
    for (let day = 0; day < 8; day += 1) await page.getByTestId('test-tool-shift-1').click().then(() => expect(page.getByTestId('test-tool-shift-1')).toBeEnabled({ timeout: 60_000 }));

    await page.goto('/billing/plan');
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'change');
    await page.getByTestId('plan-product-pulse').click();
    await expect(page.getByTestId('plan-product-pulse')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('plan-submit').click();

    const panel = page.getByTestId('change-preview');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('change-bundle-note')).toHaveText(
      'Removing Pulse ends your 20% bundle discount. Your CRM goes from $23.20 to $29 per user. Your plan goes from $185.60 to $203.00 per month. Keeping Pulse costs less.',
    );
    await expect(page.getByTestId('change-new-total')).toHaveText('$203.00');

    // The sentence under "Due today" names the cause, and its two amounts add up to what is due.
    const note = await textOf(page.getByTestId('change-due-note'));
    expect(note).toMatch(
      /^Your CRM goes from \$23\.20 to \$29 per user, because the bundle discount needs 2 apps\. For the \d+ days left in this period that is \$\d+\.\d\d more\. Less \$\d+\.\d\d back for Pulse\.$/,
    );
    const [, more, back] = [...note.matchAll(/\$(\d+\.\d\d)/g)].map((match) => Math.round(Number(match[1]) * 100));
    expect(more! - back!).toBe(cents(await textOf(page.getByTestId('change-due-today'))));
    expect(await textOf(panel)).not.toContain('what you add');
    expect(await textOf(panel)).not.toContain('what you take off');
    // Nothing was charged by looking.
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('plan-product-pulse')).toHaveAttribute('aria-checked', 'false');
  });

  test('removing WMS from CRM and WMS leaves a credit, and the reason names the app and the CRM price', async ({ page }) => {
    await paidAccount(page, 'bundlecredit', { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' });
    for (let day = 0; day < 8; day += 1) await page.getByTestId('test-tool-shift-1').click().then(() => expect(page.getByTestId('test-tool-shift-1')).toBeEnabled({ timeout: 60_000 }));
    await page.goto('/billing/plan');
    await page.getByTestId('plan-product-wms').click();
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('change-preview')).toBeVisible();
    await expect(page.getByTestId('change-bundle-note')).toHaveText(
      'Removing WMS ends your 20% bundle discount. Your CRM goes from $23.20 to $29 per user. Your plan goes from $395.20 to $145.00 per month.',
    );
    const note = await textOf(page.getByTestId('change-credit-note'));
    expect(note).toMatch(
      /^That is \$\d+\.\d\d back for WMS, for the \d+ full days left\. Your CRM goes from \$23\.20 to \$29 per user, because the bundle discount needs 2 apps\. That takes \$\d+\.\d\d off the credit\. A day that has started counts as used\.$/,
    );
    const [back, , less] = [...note.matchAll(/\$(\d+\.\d\d)/g)].map((match) => Math.round(Number(match[1]) * 100));
    expect(back! - less!).toBe(cents(await textOf(page.getByTestId('change-credit'))));
    expect(note).not.toContain('what you add');
  });
});
