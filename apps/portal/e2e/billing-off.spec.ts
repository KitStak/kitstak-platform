import { expect, test } from '@playwright/test';
import { newPerson, resetRateLimits } from './support';

/**
 * Fail closed. A portal in production mode with no Stripe key must say billing is off, charge nothing
 * and fake nothing. This needs a second server, so it runs only when its address is given:
 *
 *   deploy/dev/stop.sh portal && pnpm -F kitstak-portal build
 *   cd apps/portal && BETTER_AUTH_URL=http://localhost:3310 NEXT_PUBLIC_APP_URL=http://localhost:3310 \
 *     NEXT_PUBLIC_PORTAL_URL=http://localhost:3310 TRUSTED_ORIGINS=http://localhost:3310 pnpm exec next start -p 3310
 *   deploy/dev/app-start.sh portal
 *   E2E_BILLING_OFF_URL=http://localhost:3310 pnpm -F kitstak-portal e2e billing-off
 *
 * The port goes on the `next start` line itself: the package's `start` script is fixed to 3300. The dev
 * portal on 3300 must be up as well, because the suite checks it before any spec runs. See
 * docs/billing/TESTING.md.
 */
const OFF_URL = process.env.E2E_BILLING_OFF_URL?.replace(/\/+$/, '');

test.describe('billing is off in production with no key', () => {
  test.skip(!OFF_URL, 'Set E2E_BILLING_OFF_URL to a portal started in production mode with no Stripe key (docs/billing/TESTING.md).');

  test('pay buttons are off with the plain message, the test doors do not exist, and a trial still starts', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: OFF_URL });
    const page = await context.newPage();

    // The test gateway, its webhook and the dev outbox do not exist here.
    expect((await page.request.post('/api/billing/webhooks/test', { data: '{}' })).status()).toBe(404);
    expect((await page.request.get('/dev/outbox')).status()).toBe(404);
    expect((await page.request.get('/test-gateway/checkout/cs_test_anything')).status()).toBe(404);
    // The Stripe webhook says billing is not set up, and the job needs its secret.
    expect((await page.request.post('/api/billing/webhooks/stripe', { data: '{}' })).status()).toBe(503);
    expect([401, 503]).toContain((await page.request.get('/api/billing/jobs/tick')).status());

    // Signing up and starting a trial needs no gateway.
    await resetRateLimits();
    const person = newPerson('off');
    await page.goto('/signup?products=pulse');
    await page.getByTestId('signup-name').fill(person.name);
    await page.getByTestId('signup-email').fill(person.email);
    await page.getByTestId('signup-password').fill(person.password);
    await page.getByTestId('signup-company').fill(person.company);
    await page.getByTestId('signup-submit').click();
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email' || url.pathname === '/welcome', { timeout: 90_000 });

    // Billing home says so, calmly, and no screen wears a "Test mode" label.
    await page.goto('/billing');
    await expect(page.getByTestId('billing-home')).toBeVisible();
    await expect(page.getByTestId('billing-phase')).toHaveAttribute('data-phase', 'trial');
    await expect(page.getByText('Billing is not available right now. Nothing will be charged. Please try again later.').first()).toBeVisible();
    await expect(page.getByTestId('test-mode-label')).toHaveCount(0);
    await expect(page.getByTestId('test-tools')).toHaveCount(0);
    await expect(page.getByTestId('billing-pick-plan')).toBeDisabled();

    // The review step cannot be used to pay either.
    await page.goto('/billing/checkout');
    await expect(page.getByTestId('review-pay')).toBeDisabled();
    await context.close();
  });
});
