import { expect, test } from '@playwright/test';
import { CART_CRM_WMS, entitlementsOf, handoffLink, newPerson, orgIdOf, totalOf } from './support';

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('signup to free trial', () => {
  test('a handoff link prefills the form, the picker shows $395.20, and the trial starts with no card', async ({ page }) => {
    const person = newPerson('trial');
    const started = Date.now();

    // The link the marketing site makes: the cart in the query, the identity after the #.
    // The wizard on the site also asked three questions. Nobody answers them twice.
    await page.goto(
      handoffLink(
        CART_CRM_WMS,
        { name: person.name, email: person.email, company: person.company },
        { businessType: '3pl', teamSize: 'small', startMode: 'fresh' },
      ),
    );
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start your free trial');

    // Name, email and company came from the fragment, and the fragment is gone from the address bar.
    await expect(page.getByTestId('signup-name')).toHaveValue(person.name);
    await expect(page.getByTestId('signup-email')).toHaveValue(person.email);
    await expect(page.getByTestId('signup-company')).toHaveValue(person.company);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(page.url()).not.toContain(encodeURIComponent(person.email));

    // Four fields, all required, each with the browser hint a password manager needs.
    const fields = page.getByTestId('signup-form').locator('input:not([type="hidden"]):not([type="checkbox"])');
    await expect(fields).toHaveCount(4);
    await expect(page.getByTestId('signup-name')).toHaveAttribute('autocomplete', 'name');
    await expect(page.getByTestId('signup-email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByTestId('signup-email')).toHaveAttribute('type', 'email');
    await expect(page.getByTestId('signup-password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByTestId('signup-company')).toHaveAttribute('autocomplete', 'organization');

    // The cart shows before the account exists, with the same total as everywhere else.
    await expect(page.getByTestId('signup-plan-summary').first()).toContainText(totalOf(CART_CRM_WMS));
    await expect(page.getByText('14 days free. No card needed.').first()).toBeVisible();

    await page.getByTestId('signup-password').fill(person.password);
    await page.getByTestId('signup-submit').click();
    await page.waitForURL(/\/signup\/plan/, { timeout: 90_000 });

    // The picker is prefilled from the cart and does the math in words.
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick your apps');
    await expect(page.getByTestId('plan-product-crm')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('plan-product-wms')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('plan-product-projects')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('plan-product-pulse')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('plan-seats')).toHaveValue('5');
    await expect(page.getByTestId('plan-warehouses')).toHaveValue('1');
    await expect(page.getByTestId('quote-line-crm').first()).toContainText('CRM: 5 users x $29 = $145 per month');
    await expect(page.getByTestId('quote-line-wms').first()).toContainText('WMS: 1 warehouse x $349 = $349 per month');
    await expect(page.getByTestId('quote-list').first()).toHaveText('$494.00');
    await expect(page.getByTestId('quote-bundle-discount').first()).toHaveText('-$98.80');
    await expect(page.getByTestId('quote-total').first()).toHaveText('$395.20');
    await expect(page.getByTestId('plan-picker')).toContainText('No charge today.');
    await expect(page.getByTestId('plan-picker')).toContainText('Cancel any time in Billing.');
    await expect(page.getByTestId('plan-picker')).toContainText('Your data stays yours.');

    // The total follows every change at once, with no page load.
    await page.getByTestId('plan-seats-inc').click();
    await expect(page.getByTestId('quote-total').first()).toHaveText('$418.40');
    await page.getByTestId('plan-seats-dec').click();
    await expect(page.getByTestId('quote-total').first()).toHaveText('$395.20');
    await page.getByTestId('plan-interval-yearly').click();
    await expect(page.getByTestId('quote-total').first()).toHaveText('$4,031.04');
    await expect(page.getByTestId('quote-monthly-equivalent').first()).toHaveText('$335.92');
    await expect(page.getByTestId('quote-yearly-discount').first()).toBeVisible();
    await page.getByTestId('plan-interval-monthly').click();
    await expect(page.getByTestId('quote-total').first()).toHaveText('$395.20');

    await expect(page.getByTestId('plan-submit')).toHaveText(/Start my free trial/);
    await page.getByTestId('plan-submit').click();

    // Verification never blocks the first session: it can be skipped.
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check your email');
    await expect(page.getByTestId('verify-code')).toHaveAttribute('autocomplete', 'one-time-code');
    await page.getByTestId('verify-skip').click();
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 90_000 });

    // The whole way in took well under the 60 seconds of must have 1 once the routes are compiled.
    // The first run of a dev server compiles each route, so the hard limit here is generous.
    expect(Date.now() - started).toBeLessThan(170_000);

    // The database has two trial rows that end 14 days out, and nothing was charged.
    const orgId = await orgIdOf(person.email);
    const rows = await entitlementsOf(orgId);
    expect(rows.map((row) => [row.module, row.status, row.source])).toEqual([
      ['crm', 'trialing', 'trial'],
      ['wms', 'trialing', 'trial'],
    ]);
    for (const row of rows) {
      const days = (new Date(row.current_period_end as Date).getTime() - Date.now()) / DAY_MS;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);
    }

    // The welcome wizard already has the answers from the site, so it opens on its last screen.
    await expect(page.getByTestId('welcome-finish')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('welcome-finish')).toHaveText(/Looks good/);
    await expect(page.getByTestId('welcome-steps')).toBeVisible();
    await page.getByTestId('welcome-finish').click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 90_000 });
    await expect(page.getByTestId('tile-crm')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('tile-wms')).toBeVisible();

    // First session: nobody is asked to pick a plan a minute into a "no card needed" trial. The
    // tiles say the trial is running. The banner starts on the second day.
    await expect(page.getByTestId('plan-notice-trial')).toHaveCount(0);
    // The quick start is the 5 steps the welcome screen promised, with the answers already ticked.
    await expect(page.getByTestId('setup-steps').locator('li')).toHaveCount(5);
    await expect(page.getByTestId('setup-progress')).toContainText('1 of 5 done');
  });
});
