import { expect, test, type Page } from '@playwright/test';
import {
  CART_CRM_WMS,
  CART_PULSE,
  entitlementsOf,
  handoffLink,
  newPerson,
  openBilling,
  openTestCheckout,
  orgIdOf,
  payAndSucceed,
  payWith,
  resetRateLimits,
  scrollsSideways,
  trialAccount,
} from './support';

const PHONE = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  // Let fonts and late layout settle before measuring.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  expect(await scrollsSideways(page), `${label} scrolls sideways at 360 px`).toBe(false);
}

async function expectTapTarget(page: Page, testId: string): Promise<void> {
  // Wait for the control first: right after a navigation it may not be on the page yet.
  await expect(page.getByTestId(testId).first(), testId).toBeVisible({ timeout: 90_000 });
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, testId).not.toBeNull();
  expect(box!.height, `${testId} is ${box!.height} px tall`).toBeGreaterThanOrEqual(44);
}

/** Presses Tab until the element with this test id has focus. Fails if it never does. */
async function tabTo(page: Page, testId: string, max = 60): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
    if (focused === testId) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${testId}.`);
}

test.describe('phones, keyboards and reduced motion', () => {
  test('at 360 px nothing scrolls sideways and the main buttons are 44 px tall', async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    const person = newPerson('phone');

    await resetRateLimits();
    await page.goto(handoffLink(CART_CRM_WMS, { name: person.name, email: person.email, company: person.company }));
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/signup');
    await expectTapTarget(page, 'signup-submit');
    // On a phone the first field is not focused by itself, so the keyboard does not cover the form.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
    // The email field asks the phone for the email keyboard and leaves the text alone.
    await expect(page.getByTestId('signup-email')).toHaveAttribute('inputmode', 'email');
    await expect(page.getByTestId('signup-email')).toHaveAttribute('autocapitalize', /none|off/);

    await page.getByTestId('signup-password').fill(person.password);
    await page.getByTestId('signup-submit').click();
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/signup/plan');
    await expectTapTarget(page, 'plan-submit');
    await expectTapTarget(page, 'plan-seats-inc');
    await expectTapTarget(page, 'plan-seats-dec');
    // The total and the button stay on screen while the list scrolls.
    await page.mouse.wheel(0, 600);
    await expect(page.getByTestId('plan-submit')).toBeInViewport();

    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/verify-email');
    await page.getByTestId('verify-skip').click();
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/welcome');

    await openBilling(page);
    await expectNoSidewaysScroll(page, '/billing');
    for (const path of ['/billing/plan', '/billing/checkout', '/billing/invoices', '/billing/details', '/billing/team', '/billing/activity']) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 90_000 });
      await expectNoSidewaysScroll(page, path);
      // The browser tab names the page and the product on every billing page.
      await expect(page).toHaveTitle(/\S · KitStak Portal$/);
    }
    await page.goto('/billing/checkout');
    await expectTapTarget(page, 'review-pay');

    // The developer pages too: the outbox and the template gallery.
    for (const path of [`/dev/outbox?to=${encodeURIComponent(person.email)}`, '/dev/outbox/templates?t=receipt']) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 90_000 });
      await expectNoSidewaysScroll(page, path);
    }
    await context.close();
  });

  test('the cancel screen and the activity list fit a phone on a paid plan', async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await trialAccount(page, 'phonepaid', CART_CRM_WMS);
    // The test pay page with a two app summary, the card chips and the promo field: it fits too.
    await openTestCheckout(page);
    await expectNoSidewaysScroll(page, 'the test pay page');
    await expectTapTarget(page, 'test-pay');
    await expectTapTarget(page, 'test-promo');
    await payWith(page, 'success');
    await page.waitForURL(/\/billing\/checkout\/success/, { timeout: 90_000 });
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 30_000 });
    await expectNoSidewaysScroll(page, 'the success page');
    await page.goto('/billing/cancel');
    await expect(page.getByTestId('cancel-confirm')).toBeVisible({ timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/billing/cancel');
    await expectTapTarget(page, 'cancel-confirm');
    await expectTapTarget(page, 'cancel-back');
    await page.goto('/billing/activity');
    await expect(page.getByTestId('activity-row').first()).toBeVisible({ timeout: 90_000 });
    await expectNoSidewaysScroll(page, '/billing/activity');
    await expectTapTarget(page, 'activity-filter-payments');
    await context.close();
  });

  test('signup to a free trial with the keyboard alone', async ({ page }) => {
    const person = newPerson('keys');
    await resetRateLimits();
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });

    await tabTo(page, 'signup-name');
    await page.keyboard.type(person.name);
    await tabTo(page, 'signup-email');
    await page.keyboard.type(person.email);
    await tabTo(page, 'signup-password');
    await page.keyboard.type(person.password);
    await tabTo(page, 'signup-company');
    await page.keyboard.type(person.company);
    // Enter in the last field sends the form.
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });

    // With no cart nothing is picked, and the button says what to do.
    await expect(page.getByTestId('plan-submit')).toBeDisabled();
    await expect(page.getByText('Pick at least one app.').first()).toBeVisible();

    // App rows are real switches: Space turns one on. The stepper takes arrow keys.
    await tabTo(page, 'plan-product-crm');
    await expect(page.getByTestId('plan-product-crm')).toHaveAttribute('role', 'switch');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('plan-product-crm')).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, 'plan-seats');
    const before = Number(await page.getByTestId('plan-seats').inputValue());
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('plan-seats')).toHaveValue(String(before + 1));
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('plan-seats')).toHaveValue(String(before));

    // Focus is always visible.
    await tabTo(page, 'plan-submit');
    const outline = await page.getByTestId('plan-submit').evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await tabTo(page, 'verify-skip');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 90_000 });

    const rows = await entitlementsOf(await orgIdOf(person.email));
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([['crm', 'trialing', 'trial']]);
  });

  test('reduced motion: the success page shows no confetti, and still says the plan is set', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await trialAccount(page, 'calm', CART_PULSE);
    await payAndSucceed(page);
    await expect(page.getByTestId('checkout-success')).toContainText('You are all set.');
    await page.waitForTimeout(600);
    // The pieces are in the page but their holder is hidden, so nothing moves.
    const moving = await page.locator('.animate-confetti-fall').evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).offsetParent !== null).length);
    expect(moving).toBe(0);
    await context.close();

    // With motion allowed the burst is there, so the check above tests something real.
    const lively = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1280, height: 800 } });
    const second = await lively.newPage();
    await trialAccount(second, 'lively', CART_PULSE);
    await payAndSucceed(second);
    await expect(second.locator('.animate-confetti-fall').first()).toBeAttached({ timeout: 5_000 });
    await lively.close();
  });
});
