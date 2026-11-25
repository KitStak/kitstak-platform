import { expect, test } from '@playwright/test';
import { CART_CRM_WMS, handoffLink, newPerson, signUp, totalOf } from './support';

test.describe('signup: resume where you left off', () => {
  test('closing the tab at the picker loses nothing: signing in again lands on the picker with the same cart', async ({ browser }) => {
    const person = newPerson('resume');
    const first = await browser.newContext();
    const page = await first.newPage();
    await signUp(page, person, { link: handoffLink(CART_CRM_WMS) });
    await expect(page.getByTestId('quote-total').first()).toHaveText(totalOf(CART_CRM_WMS));
    // The tab is closed before the trial is started.
    await first.close();

    const second = await browser.newContext();
    const again = await second.newPage();
    await again.goto('/login');
    await again.locator('input[type="email"]').fill(person.email);
    await again.locator('input[type="password"]').fill(person.password);
    await again.locator('form button[type="submit"]').click();
    await again.waitForURL(/\/signup\/plan/, { timeout: 90_000 });
    await expect(again.getByTestId('plan-picker')).toBeVisible();
    await expect(again.getByTestId('plan-product-crm')).toHaveAttribute('aria-checked', 'true');
    await expect(again.getByTestId('plan-product-wms')).toHaveAttribute('aria-checked', 'true');
    await expect(again.getByTestId('plan-seats')).toHaveValue('5');
    await expect(again.getByTestId('quote-total').first()).toHaveText(totalOf(CART_CRM_WMS));

    // A signed in visitor who opens /signup again is sent to their step, never bounced with the cart lost.
    await again.goto('/signup');
    await again.waitForURL(/\/signup\/plan/, { timeout: 90_000 });
    await expect(again.getByTestId('plan-submit')).toHaveText(/Start my free trial/);
    await second.close();
  });

  test('errors name the problem and the fix, and nothing typed is lost', async ({ page }) => {
    const person = newPerson('errors');
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('signup-name').fill('M');
    await page.getByTestId('signup-email').fill('not-an-email');
    await page.getByTestId('signup-password').fill('short');
    await page.getByTestId('signup-submit').click();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await expect(page.getByText('Enter a valid work email.')).toBeVisible();
    // The checklist names every missing rule at once, in red, and the error is not printed twice.
    await expect(page.locator('[data-testid="password-rules"] [data-state="missing"]')).toHaveCount(4);
    await expect(page.getByText('Use at least 10 characters.')).toHaveCount(0);
    await expect(page.getByText('Enter your company or team name.')).toBeVisible();
    // Focus moves to the first field with a problem, and each error is tied to its field.
    await expect(page.getByTestId('signup-name')).toBeFocused();
    await expect(page.getByTestId('signup-name')).toHaveAttribute('aria-invalid', 'true');
    expect(await page.getByTestId('signup-name').getAttribute('aria-describedby')).toBeTruthy();
    // What was typed is still there.
    await expect(page.getByTestId('signup-email')).toHaveValue('not-an-email');
    await expect(page.getByTestId('signup-password')).toHaveValue('short');
    expect(page.url()).toContain('/signup');

    // An address that already has an account says so, with a way to sign in.
    const taken = 'maya@northwind-robotics.example';
    await page.getByTestId('signup-name').fill(person.name);
    await page.getByTestId('signup-email').fill(taken);
    await page.getByTestId('signup-password').fill(person.password);
    await page.getByTestId('signup-company').fill(person.company);
    await page.getByTestId('signup-submit').click();
    await expect(page.getByText('An account with this email already exists.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(page.getByTestId('signup-company')).toHaveValue(person.company);
  });
});
