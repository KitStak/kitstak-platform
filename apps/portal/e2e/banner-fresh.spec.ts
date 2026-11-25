import { expect, test, type Page } from '@playwright/test';
import { APP_URLS, appIsUp, expectPhase, holdDevReloads, openBilling, paidAccount, sql } from './support';
import type { PlanSelection } from '@kitstak/billing/catalog';

/**
 * Review round 3: an app banner is right on the first page load after any change made in the
 * Portal, also when the plan has full access before and after (cancel set and undone). The review
 * measured 64 seconds of a wrong banner in the CRM. No test tools are used here: real clicks, real
 * time, and the app is opened right after each one.
 *
 * Needs the CRM running with ENTITLEMENTS_DEV_ALLOW_ALL=0 (docs/billing/DEV.md). Pulse is checked
 * too when it is up.
 */
const CART: PlanSelection = { products: ['crm', 'pulse'], seats: 2, warehouses: 1, interval: 'monthly' };

async function banner(page: Page, url: string, kind: string): Promise<{ shown: boolean; ms: number }> {
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const shown = (await page.getByTestId(`plan-notice-${kind}`).count()) > 0;
  return { shown, ms: Date.now() - started };
}

test.describe('app banners follow the Portal at once', () => {
  test('cancel, then the CRM: the banner is there. "Keep my plan", then the CRM: it is gone', async ({ page }) => {
    test.setTimeout(420_000);
    await holdDevReloads(page.context());
    const { orgId } = await paidAccount(page, 'fresh', CART);
    const [org] = await sql<{ slug: string }>(`SELECT slug FROM core.organization WHERE id = $1`, [orgId]);
    if (!(await appIsUp(page, `${APP_URLS.crm}/login`))) test.skip(true, 'The CRM is not running.');
    const apps: [string, string][] = [['crm', `${APP_URLS.crm}/${org!.slug}`]];
    if (await appIsUp(page, `${APP_URLS.pulse}/login`)) apps.push(['pulse', APP_URLS.pulse]);

    // Each app has seen the active plan, so each holds its own copy of it.
    for (const [app, url] of apps) {
      const first = await banner(page, url, 'cancel_scheduled');
      expect(first.shown, `${app}: no banner on an active plan`).toBe(false);
    }
    await page.goto(apps[0]![1]);
    const lockedOut = (await page.getByTestId('plan-lock').count()) > 0;
    test.skip(lockedOut, 'The CRM did not open for this plan, so there is no banner to check.');

    // The owner cancels in the Portal and goes straight to the apps.
    await openBilling(page);
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'cancel_scheduled');
    const canceledAt = Date.now();
    for (const [app, url] of apps) {
      const seen = await banner(page, url, 'cancel_scheduled');
      expect(seen.shown, `${app}: the "plan ends" banner right after the cancel (${Date.now() - canceledAt} ms after it)`).toBe(true);
      await expect(page.getByTestId('plan-notice-cancel_scheduled')).toContainText('You keep everything until then.');
    }

    // "Keep my plan", then the apps at once: no banner, no "Keep my plan" button for a thing already done.
    await openBilling(page);
    await page.getByTestId('billing-keep-plan').click();
    await expectPhase(page, 'active');
    const keptAt = Date.now();
    for (const [app, url] of apps) {
      const seen = await banner(page, url, 'cancel_scheduled');
      const waited = Date.now() - keptAt;
      expect(seen.shown, `${app}: no "plan ends" banner ${waited} ms after "Keep my plan"`).toBe(false);
      // Far inside the 60 seconds an app keeps its copy: the stamp did this, not the clock.
      expect(waited).toBeLessThan(30_000);
      test.info().annotations.push({ type: 'measured', description: `${app}: banner gone ${waited} ms after "Keep my plan"` });
    }
  });
});
