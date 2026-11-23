import { expect, test } from '@playwright/test';
import { CART_CRM_WMS, entitlementsOf, expectPhase, openBilling, openTestCheckout, payWith, totalOf, trialAccount } from './support';

test.describe('checkout: a card that does not work', () => {
  test('a declined card says so, keeps what was typed, and changes no access row', async ({ page }) => {
    const { orgId } = await trialAccount(page, 'decline', CART_CRM_WMS);
    const before = await entitlementsOf(orgId);

    await openTestCheckout(page);
    const payUrl = page.url();
    await payWith(page, 'declined');
    await expect(page.getByTestId('test-error')).toHaveText('That card was declined. Try another card or call your bank.');
    // Still on the pay page, and the typed card number is still there.
    expect(page.url()).toBe(payUrl);
    await expect(page.getByTestId('test-card-number')).toHaveValue('4000 0000 0000 0002');
    expect(await entitlementsOf(orgId)).toEqual(before);

    // A second kind of decline reads the same way: the problem and the fix, nothing technical.
    await payWith(page, 'insufficient_funds');
    await expect(page.getByTestId('test-error')).toBeVisible();
    await expect(page.getByTestId('test-error')).not.toContainText(/error|code|exception/i);
    expect(await entitlementsOf(orgId)).toEqual(before);

    // Back: the canceled page says no charge was made and the cart is kept.
    await page.getByTestId('test-back').click();
    await page.waitForURL(/\/billing\/checkout\/canceled/);
    await expect(page.getByTestId('checkout-canceled')).toContainText('No charge was made.');
    await expect(page.getByTestId('checkout-canceled')).toContainText('Your cart is saved.');
    await page.getByTestId('checkout-resume').click();
    await page.waitForURL(/\/billing\/checkout(\?|$)/);
    await expect(page.getByTestId('quote-total').first()).toHaveText(totalOf(CART_CRM_WMS));

    // Nothing was granted and nothing was lost: still the same free trial.
    await openBilling(page);
    await expectPhase(page, 'trial');
    expect(await entitlementsOf(orgId)).toEqual(before);

    // The same person can still pay with a card that works. Nobody is stranded.
    await openTestCheckout(page);
    await payWith(page, 'success');
    await page.waitForURL(/\/billing\/checkout\/success/);
    await expect(page.getByTestId('checkout-success')).toBeVisible();
  });
});
