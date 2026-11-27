import { expect, test } from '@playwright/test';
import { CART_PULSE, entitlementsOf, expectPhase, openBilling, openTestCheckout, payWith, trialAccount } from './support';

test.describe('checkout: a card that needs bank approval', () => {
  test('failing the bank step shows the decline message and grants nothing; approving finishes the checkout', async ({ page }) => {
    const { orgId } = await trialAccount(page, 'bank', CART_PULSE);
    const before = await entitlementsOf(orgId);

    await openTestCheckout(page);
    await payWith(page, 'requires_action');
    await expect(page.getByTestId('test-3ds-approve')).toBeVisible();
    await expect(page.getByTestId('test-3ds-fail')).toBeVisible();

    // Fail at the bank: a plain message with the fix, still on the pay page, nothing granted.
    await page.getByTestId('test-3ds-fail').click();
    await expect(page.getByTestId('test-error')).toHaveText('Your bank did not approve the payment. Try again or use another card.');
    expect(page.url()).toContain('/test-gateway/checkout/');
    expect(await entitlementsOf(orgId)).toEqual(before);

    // Try again and approve: success.
    await payWith(page, 'requires_action');
    await page.getByTestId('test-3ds-approve').click();
    await page.waitForURL(/\/billing\/checkout\/success/);
    await expect(page.getByTestId('checkout-success')).toContainText('You are all set.');

    await openBilling(page);
    await expectPhase(page, 'active');
    await expect(page.getByTestId('billing-payment-method')).toContainText('ending 3184');
    const rows = await entitlementsOf(orgId);
    expect(rows.map((row) => [row.module, row.source])).toEqual([['pulse', 'stripe']]);
  });
});
