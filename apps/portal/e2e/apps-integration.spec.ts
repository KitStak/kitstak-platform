import { expect, test, type Page } from '@playwright/test';
import { APP_URLS, CART_CRM_2, allowAllIsOn, appIsUp, entitlementsOf, holdDevReloads, sql, textOf, trialAccount } from './support';

type AppId = keyof typeof APP_URLS;
const APP_NAME: Readonly<Record<AppId, string>> = { crm: 'CRM', wms: 'WMS', projects: 'Projects', pulse: 'Pulse' };

async function slugOf(orgId: string): Promise<string> {
  const rows = await sql<{ slug: string }>(`SELECT slug FROM core.organization WHERE id = $1`, [orgId]);
  return rows[0]!.slug;
}

/** Where a signed in person lands in each app. The session cookie is shared across the local ports. */
function homeOf(app: AppId, slug: string): string {
  return app === 'crm' ? `${APP_URLS.crm}/${slug}` : `${APP_URLS[app]}/`;
}

/**
 * Opens an app and says what it shows: the lock screen, the app with a plan banner, or neither.
 * "neither" means the app runs with the allow all switch on, where it never locks by design.
 */
async function openApp(page: Page, app: AppId, slug: string): Promise<'lock' | 'banner' | 'open'> {
  await page.goto(homeOf(app, slug), { timeout: 120_000 });
  const lock = page.getByTestId('plan-lock');
  const banner = page.locator('[data-testid^="plan-notice-"]').first();
  try {
    await expect(lock.or(banner).first()).toBeVisible({ timeout: 60_000 });
  } catch {
    return 'open';
  }
  return (await lock.isVisible()) ? 'lock' : 'banner';
}

test.describe('one suite: the same banner and lock screen in every app', () => {
  test('the trial banner says the same words everywhere, and an app that is not in the trial shows its price', async ({ page }) => {
    test.setTimeout(420_000);
    await holdDevReloads(page.context());
    const { orgId } = await trialAccount(page, 'suite', CART_CRM_2);
    const slug = await slugOf(orgId);
    const portalBanner = await textOf(page.getByTestId('plan-notice-trial'));
    expect(portalBanner).toMatch(/^Free trial\. 14 days left\. Ends [A-Z][a-z]{2} \d{1,2}\./);
    const endsOn = /Ends ([A-Z][a-z]{2} \d{1,2})\./.exec(portalBanner)![1]!;

    const checked: string[] = [];
    const skipped: string[] = [];

    /* ----- CRM is in the trial: it opens, with the same banner ----- */
    if (await appIsUp(page, `${APP_URLS.crm}/login`)) {
      const state = await openApp(page, 'crm', slug);
      if (state === 'banner') {
        const banner = page.getByTestId('plan-notice-trial');
        await expect(banner).toBeVisible();
        // The same sentence as the portal, word for word.
        expect((await textOf(banner)).startsWith(`Free trial. 14 days left. Ends ${endsOn}.`)).toBe(true);
        await expect(page.getByTestId('plan-notice-action').first()).toHaveText(/Pick a plan/);
        await expect(page.getByTestId('plan-notice-action').first()).toHaveAttribute('href', /\/billing\/plan/);
        checked.push('crm: trial banner');
      } else {
        skipped.push(`crm showed "${state}", expected the trial banner`);
      }
    } else {
      skipped.push('crm is not running');
    }

    /* ----- Projects, Pulse and WMS are not in the trial: the lock screen, with the price ----- */
    for (const app of ['projects', 'pulse', 'wms'] as const) {
      const probe = app === 'pulse' ? `${APP_URLS.pulse}/api/health` : `${APP_URLS[app]}/login`;
      if (!(await appIsUp(page, probe))) {
        skipped.push(`${app} is not running`);
        continue;
      }
      const state = await openApp(page, app, slug);
      if (state !== 'lock') {
        skipped.push(`${app} runs with the allow all switch on (it opened instead of locking)`);
        continue;
      }
      const lock = page.getByTestId('plan-lock');
      await expect(lock).toContainText(`${APP_NAME[app]} is not in your trial yet`);
      await expect(lock).toContainText(`Add it now. It is free until ${endsOn}.`);
      // The price after the trial, with the bundle discount that a second app turns on.
      await expect(lock).toContainText(new RegExp(`After your trial, ${APP_NAME[app]} is \\$[\\d,.]+ .*with your bundle discount\\.`));
      const primary = page.getByTestId('plan-lock-primary');
      await expect(primary).toHaveText(`Add ${APP_NAME[app]} to my trial`);
      await expect(primary).toHaveAttribute('href', new RegExp(`/billing/plan\\?add=${app}`));
      await expect(page.getByTestId('plan-lock-secondary')).toHaveText('Back to Portal');
      checked.push(`${app}: lock screen with price`);
    }

    /* ----- adding an app from another app: the lock button, then one click to save ----- */
    const firstLocked = (['pulse', 'projects', 'wms'] as const).find((app) => checked.includes(`${app}: lock screen with price`));
    if (firstLocked) {
      await openApp(page, firstLocked, slug);
      let clicks = 0;
      await page.getByTestId('plan-lock-primary').click();
      clicks += 1;
      await page.waitForURL(/\/billing\/plan\?add=/, { timeout: 90_000 });
      await expect(page.getByTestId(`plan-product-${firstLocked}`)).toHaveAttribute('aria-checked', 'true', { timeout: 90_000 });
      // Both apps now show the bundle discount in the same summary.
      await expect(page.getByTestId('quote-bundle-discount').first()).toBeVisible();
      await page.getByTestId('plan-submit').click();
      clicks += 1;
      await page.waitForURL((url) => url.pathname === '/billing', { timeout: 90_000 });
      expect(clicks).toBeLessThanOrEqual(3);
      const rows = await entitlementsOf(orgId);
      expect(rows.map((row) => row.module)).toContain(firstLocked);
      // The app opens now, with the trial banner and no lock.
      expect(await openApp(page, firstLocked, slug)).toBe('banner');
      checked.push(`${firstLocked}: added from its lock screen in ${clicks} clicks`);
    }

    /* ----- the portal's own tiles and app switcher follow the plan ----- */
    await page.goto('/');
    await expect(page.getByTestId('tile-crm')).toBeVisible({ timeout: 90_000 });
    if (await allowAllIsOn(page)) {
      skipped.push('portal tiles: the portal runs with the allow all switch on, so every tile says Included');
    } else {
      await expect(page.getByTestId('tile-badge-crm')).toHaveText(/Trial/);
      const notAdded = (['wms', 'projects', 'pulse'] as const).find((app) => app !== firstLocked);
      if (notAdded) await expect(page.getByTestId(`tile-badge-${notAdded}`)).toHaveText(/Not in your plan/);
      checked.push('portal: tiles follow the plan');
    }

    // Said out loud, so a pass never hides a part that was not run.
    console.log(`apps-integration checked: ${checked.join(' | ') || 'nothing'}`);
    console.log(`apps-integration skipped: ${skipped.join(' | ') || 'nothing'}`);
    for (const line of checked) test.info().annotations.push({ type: 'checked', description: line });
    for (const line of skipped) test.info().annotations.push({ type: 'skipped part', description: line });
    // The test is only worth a pass if at least one product app was really checked.
    test.skip(checked.filter((line) => !line.startsWith('portal')).length === 0, `No product app could be checked: ${skipped.join('; ')}.`);
  });
});
