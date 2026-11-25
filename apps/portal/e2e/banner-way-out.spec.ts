import { expect, test, type Page } from '@playwright/test';
import { APP_URLS, appIsUp, entitlementsOf, expectPhase, holdDevReloads, openBilling, payAndSucceed, runTestTool, skipDays, trialAccount } from './support';

/**
 * Review round 4: the plan banner's button is the way out of view only, so it must never be held
 * back by the view only guard. In the WMS (and in Pulse, which passes the same label rule) the
 * guard marked "Add WMS" and "Update card" as write controls: the button was dimmed to 55% and the
 * first press only opened the "Your plan is view only" dialog. Adding the WMS back took 4 clicks.
 *
 * One organization walks through every banner kind that shows in a view only app, plus the late
 * payment banner. For each kind, in the WMS and in Pulse: the button is at full strength, carries
 * no write mark, and ONE press lands on the right Portal page.
 *
 * Needs the WMS and Pulse running with ENTITLEMENTS_DEV_ALLOW_ALL=0 (docs/billing/TESTING.md). An
 * app that is not up, or that runs with the switch on, is skipped by name.
 */

type AppId = 'wms' | 'pulse';
const HOME: Readonly<Record<AppId, string>> = { wms: `${APP_URLS.wms}/dashboard`, pulse: `${APP_URLS.pulse}/` };
const NAME: Readonly<Record<AppId, string>> = { wms: 'WMS', pulse: 'Pulse' };

/** Opens an app page until its plan banner of this kind is there (another process reads the plan within a minute). */
async function openWithBanner(page: Page, url: string, kind: string): Promise<void> {
  await expect(async () => {
    await page.goto(url, { timeout: 120_000 });
    await expect(page.getByTestId(`plan-notice-${kind}`)).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
}

/**
 * The banner button of this kind in this app: full strength, no write mark, and one press goes to
 * the Portal. Returns the address it landed on.
 */
async function pressBannerButton(page: Page, app: AppId, kind: string, label: RegExp, lands: RegExp, viewOnly: boolean): Promise<string> {
  await openWithBanner(page, HOME[app], kind);
  const banner = page.getByTestId(`plan-notice-${kind}`);
  const action = banner.getByTestId('plan-notice-action');
  await expect(action, `${app} ${kind}: the banner has its button`).toHaveText(label);
  if (viewOnly) {
    // The guard is on (the page is view only) and has had time to mark the page's write controls.
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.planViewOnly), { timeout: 30_000 }).toBe('true');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1_500);
  }
  expect(await action.evaluate((element) => element.hasAttribute('data-plan-write')), `${app} ${kind}: the banner button is not marked as a write control`).toBe(false);
  await expect(action, `${app} ${kind}: the banner button is at full strength`).toHaveCSS('opacity', '1');
  expect(await banner.evaluate((element) => element.querySelectorAll('[data-plan-write]').length), `${app} ${kind}: nothing in the banner is marked`).toBe(0);

  // One press. No dialog in between.
  await action.click();
  await page.waitForURL(lands, { timeout: 120_000 });
  await expect(page.getByTestId('view-only-dialog')).toHaveCount(0);
  return page.url();
}

test.describe('the plan banner button is the way out, in one press', () => {
  test('WMS and Pulse, every banner kind: full strength, no dialog, the right Portal page', async ({ page }) => {
    test.setTimeout(1_500_000);
    await holdDevReloads(page.context());
    const wmsUp = await appIsUp(page, `${APP_URLS.wms}/login`);
    const pulseUp = await appIsUp(page, `${APP_URLS.pulse}/login`);
    test.skip(!wmsUp && !pulseUp, 'Neither the WMS nor Pulse is running.');

    const { orgId } = await trialAccount(page, 'wayout', { products: ['wms', 'pulse'], seats: 1, warehouses: 1, interval: 'monthly' });
    const apps: AppId[] = [];

    // First run of the WMS: one screen, one press. Without a warehouse there is no dashboard to stand on.
    if (wmsUp) {
      await page.goto(`${APP_URLS.wms}/`, { timeout: 120_000 });
      const setup = page.getByTestId('setup-form');
      await expect(setup.or(page.getByTestId('plan-lock')).or(page.getByTestId('top-bar')).first()).toBeVisible({ timeout: 120_000 });
      if (await setup.isVisible()) {
        await page.getByTestId('setup-submit').click();
        await page.waitForURL(/\/dashboard$/, { timeout: 300_000 });
        await expect(page.getByTestId('top-bar')).toBeVisible({ timeout: 120_000 });
        apps.push('wms');
      }
    }
    if (pulseUp) apps.push('pulse');
    const skipped = (['wms', 'pulse'] as const).filter((app) => !apps.includes(app));
    for (const app of skipped) test.info().annotations.push({ type: 'skipped app', description: `${NAME[app]} is not running, or has no first screen for this person.` });

    const checked: string[] = [];
    const eachApp = async (kind: string, label: RegExp, lands: RegExp, viewOnly: boolean): Promise<void> => {
      for (const app of apps) {
        const url = await pressBannerButton(page, app, kind, label, lands, viewOnly);
        // The Portal knows which app the person came from, so it can offer the way back.
        expect(new URL(url).searchParams.get('from'), `${app} ${kind}: the link names the app`).toBe(app);
        checked.push(`${app}:${kind}`);
      }
    };

    /* ----- the trial ended: "Pick a plan" ----- */
    await runTestTool(page, 'shift-trial-end').catch(() => undefined);
    await page.goto('/billing');
    await expectPhase(page, 'trial_ended');
    // An app that still opens in full here runs with the allow all switch: nothing is view only in it.
    for (const app of [...apps]) {
      await page.goto(HOME[app], { timeout: 120_000 });
      const banner = page.getByTestId('plan-notice-trial_ended');
      await expect(banner).toBeVisible({ timeout: 120_000 });
      const guarded = await page
        .waitForFunction(() => document.documentElement.dataset.planViewOnly === 'true', undefined, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!guarded) {
        apps.splice(apps.indexOf(app), 1);
        test.info().annotations.push({ type: 'skipped app', description: `${NAME[app]} runs with the allow all switch on: it is never view only.` });
      }
    }
    test.skip(apps.length === 0, 'No app runs in enforced mode (ENTITLEMENTS_DEV_ALLOW_ALL=0), so no app is view only.');
    await eachApp('trial_ended', /^Pick a plan$/, /\/billing\/plan\?/, true);

    /* ----- pay, with a card that fails at every renewal (for the late payment kinds below) ----- */
    await page.goto('/billing');
    await payAndSucceed(page, 'fails_on_renewal');
    await openBilling(page);
    await expectPhase(page, 'active');

    /* ----- an app that left the plan: "Add WMS", and adding it back is 3 clicks from inside the app ----- */
    for (const app of apps) {
      const other = app === 'wms' ? 'pulse' : 'wms';
      await page.goto('/billing/plan');
      await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'change', { timeout: 90_000 });
      await page.getByTestId(`plan-product-${app}`).click();
      await page.getByTestId('plan-submit').click();
      await page.getByTestId('change-confirm').click();
      await page.waitForURL(/\/billing\?.*notice=plan_updated/, { timeout: 90_000 });
      expect((await entitlementsOf(orgId)).filter((row) => row.status === 'active').map((row) => row.module)).toEqual([other]);

      // Click 1: the banner button, straight to the picker with the app switched on.
      const url = await pressBannerButton(page, app, 'app_removed', new RegExp(`^Add ${NAME[app]}$`), /\/billing\/plan\?/, true);
      expect(new URL(url).searchParams.get('add')).toBe(app);
      expect(new URL(url).searchParams.get('from')).toBe(app);
      await expect(page.getByTestId(`plan-product-${app}`)).toBeChecked({ timeout: 90_000 });
      // Click 2 and click 3: "Review change", "Confirm change".
      await page.getByTestId('plan-submit').click();
      await page.getByTestId('change-confirm').click();
      await page.waitForURL(/\/billing\?.*notice=plan_updated/, { timeout: 90_000 });
      expect((await entitlementsOf(orgId)).filter((row) => row.status === 'active').map((row) => row.module).sort()).toEqual(['pulse', 'wms']);
      checked.push(`${app}:app_removed`);
    }

    /* ----- the renewal fails: "Update card" while access is still full ----- */
    await openBilling(page);
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');
    await eachApp('payment_failed', /^Update card$/, /\/billing\?(.*&)?fix=payment/, false);

    /* ----- not fixed in 7 days: view only, and "Update card" is still one press ----- */
    await openBilling(page);
    await skipDays(page, 8);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'unpaid');
    for (const app of apps) {
      await openWithBanner(page, HOME[app], 'unpaid');
      // The sentence and the button use one name for the fix.
      await expect(page.getByTestId('plan-notice-unpaid')).toContainText('Your payment is late, so your apps are view only. Update your card to turn them back on.');
      await expect(page.getByTestId('plan-notice-unpaid')).not.toContainText('Pay now');
    }
    await eachApp('unpaid', /^Update card$/, /\/billing\?(.*&)?fix=payment/, true);

    /* ----- a new card pays the bill. Then a pause: "Start again now" ----- */
    await openBilling(page);
    await page.getByTestId('billing-update-card').click();
    await page.waitForURL(/\/test-gateway\/card\//, { timeout: 90_000 });
    await page.getByTestId('test-card-chip-success').click();
    await page.getByTestId('test-pay').click();
    // Back on billing home the bill is paid at once (the page loads once more to say so).
    await page.waitForURL(/\/billing\?.*notice=card_paid/, { timeout: 90_000 });
    await expect(page.getByTestId('billing-home')).toBeVisible({ timeout: 90_000 });
    await expectPhase(page, 'active');
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-pause-1').click();
    await page.getByTestId('cancel-pause-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'pause_scheduled');
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'paused');
    await eachApp('paused', /^Start again now$/, /\/billing\?/, true);

    /* ----- started again, canceled, and past the end: "Pick a plan" ----- */
    await openBilling(page);
    await page.getByTestId('billing-undo-pause').click();
    await expectPhase(page, 'active');
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'cancel_scheduled');
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'ended');
    await eachApp('ended', /^Pick a plan$/, /\/billing\/plan\?/, true);

    test.info().annotations.push({ type: 'checked', description: checked.join(', ') });
    console.log(`banner way out: checked ${checked.join(', ')}${skipped.length > 0 ? `. Skipped apps: ${skipped.join(', ')}` : ''}`);
  });
});
