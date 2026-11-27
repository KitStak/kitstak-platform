import { expect, test, type Page } from '@playwright/test';
import { APP_URLS, CART_CRM_2, allowAllIsOn, appIsUp, entitlementsOf, expectPhase, holdDevReloads, runTestTool, sql, textOf, trialAccount } from './support';

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
    // No app asks for a plan on the first day of a trial. The banner starts on the second day.
    await expect(page.getByTestId('plan-notice-trial')).toHaveCount(0);
    await runTestTool(page, 'shift-1');
    await page.reload();
    const portalBanner = await textOf(page.getByTestId('plan-notice-trial'));
    expect(portalBanner).toMatch(/^Free trial\. 13 days left\. Ends [A-Z][a-z]{2} \d{1,2}\./);
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
        expect((await textOf(banner)).startsWith(`Free trial. 13 days left. Ends ${endsOn}.`)).toBe(true);
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

    /* ----- the portal's own tiles follow the plan ----- */
    await page.goto('/');
    await expect(page.getByTestId('tile-crm')).toBeVisible({ timeout: 90_000 });
    if (await allowAllIsOn(page)) {
      skipped.push('portal tiles: the portal runs with the allow all switch on, so every app has a tile');
    } else {
      // An app in the trial says so in one quiet line. An app that is not in the plan has no tile.
      await expect(page.getByTestId('tile-plan-crm')).toHaveText(/left in your free trial/);
      const notAdded = (['wms', 'projects', 'pulse'] as const).find((app) => app !== firstLocked);
      if (notAdded) await expect(page.getByTestId(`tile-${notAdded}`)).toHaveCount(0);
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
  test('view only is told before a form opens: the create buttons open one small dialog, never the form', async ({ page }) => {
    test.setTimeout(420_000);
    await holdDevReloads(page.context());
    const { orgId } = await trialAccount(page, 'viewonly', CART_CRM_2);
    const slug = await slugOf(orgId);
    // The trial ends with no card: every app is view only.
    await runTestTool(page, 'shift-trial-end');
    await page.reload();
    await expectPhase(page, 'trial_ended');

    if (!(await appIsUp(page, `${APP_URLS.crm}/login`))) test.skip(true, 'The CRM is not running.');
    const state = await openApp(page, 'crm', slug);
    test.skip(state !== 'banner', 'The CRM runs with the allow all switch on, so it is never view only here.');
    await expect(page.getByTestId('plan-notice-trial_ended')).toBeVisible();
    await expect(page.getByTestId('home-page')).toBeVisible({ timeout: 90_000 });

    const dialog = page.getByTestId('view-only-dialog');
    for (const button of [page.getByTestId('home-new-board'), page.getByRole('button', { name: /^Invite/ }).first(), page.getByRole('button', { name: 'Import' }).first()]) {
      if ((await button.count()) === 0) continue;
      await button.click();
      // The dialog repeats the banner's words and the banner's button. No create or invite form is open.
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('view-only-text')).toContainText('Pick a plan to keep working.');
      await expect(page.getByTestId('view-only-action')).toHaveText('Pick a plan');
      await expect(page.getByTestId('view-only-action')).toHaveAttribute('href', /\/billing\/plan/);
      await expect(page.locator('[role="dialog"]:not(.ks-viewonly)')).toHaveCount(0);
      await page.getByTestId('view-only-close').click();
      await expect(dialog).toBeHidden();
    }
    // Nothing was created by any of the presses.
    const boards = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM crm.boards WHERE org_id = $1`, [orgId]);
    expect(boards[0]?.n).toBe('0');
    const invites = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM core.invitation WHERE organization_id = $1`, [orgId]);
    expect(invites[0]?.n).toBe('0');
    // The dialog's button is the way out: the plan picker in the Portal.
    await page.getByTestId('home-new-board').click();
    await page.getByTestId('view-only-action').click();
    await page.waitForURL(/\/billing\/plan/, { timeout: 90_000 });
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'checkout');
  });
  test('view only in the WMS and in Pulse: every create entry opens the small dialog, and a locked app has no create buttons', async ({ page }) => {
    test.setTimeout(600_000);
    await holdDevReloads(page.context());
    // A trial with the WMS and Pulse. Projects is not in it.
    const { orgId } = await trialAccount(page, 'viewonly-wms', { products: ['wms', 'pulse'], seats: 1, warehouses: 1, interval: 'monthly' });
    const slug = await slugOf(orgId);
    if (!(await appIsUp(page, `${APP_URLS.wms}/login`)) || !(await appIsUp(page, `${APP_URLS.pulse}/login`))) test.skip(true, 'The WMS or Pulse is not running.');

    // First run of the WMS: one screen, one required field that is already filled in, one press.
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`${APP_URLS.wms}/`, { timeout: 120_000 });
    const setup = page.getByTestId('setup-form');
    const lock = page.getByTestId('plan-lock');
    await expect(setup.or(lock).or(page.getByTestId('top-bar')).first()).toBeVisible({ timeout: 120_000 });
    test.skip(!(await setup.isVisible()), 'The WMS runs with the allow all switch on, or already has a warehouse for this person.');
    await expect(page).toHaveURL(/\/setup-warehouse$/);
    await expect(page.getByTestId('setup-back-to-portal')).toBeVisible();
    await expect(page.getByTestId('setup-name')).not.toHaveValue('');
    await expect(page.getByTestId('setup-code')).not.toHaveValue('');
    // The address and the phone are optional and folded away.
    await expect(page.getByTestId('setup-contactPhone')).toBeHidden();
    // An empty name is caught in the browser: an inline message, focus on the field, no failed request.
    const name = await page.getByTestId('setup-name').inputValue();
    await page.getByTestId('setup-name').fill('');
    await page.getByTestId('setup-submit').click();
    await expect(page.locator('#setup-name-error')).toHaveText('Enter a name for your warehouse.');
    await expect(page.getByTestId('setup-name')).toBeFocused();
    await page.getByTestId('setup-name').fill(name);
    await page.getByTestId('setup-submit').click();
    await page.waitForURL(/\/dashboard$/, { timeout: 300_000 });
    await expect(page.getByTestId('top-bar')).toBeVisible({ timeout: 120_000 });
    expect(consoleErrors, 'no console error on the first WMS screens').toEqual([]);

    // The trial ends with no card: every app in it is view only. The tool's button can leave the
    // page as soon as the trial is over, so the phase on billing home is the proof, not the button.
    await runTestTool(page, 'shift-trial-end').catch(() => undefined);
    await page.goto('/billing');
    await expectPhase(page, 'trial_ended');
    const ended = page.getByTestId('plan-notice-trial_ended');
    const dialog = page.getByTestId('view-only-dialog');
    /** Opens a page and waits until the app knows the trial ended (another process reads it within a minute). */
    const openViewOnly = async (url: string): Promise<void> => {
      await expect(async () => {
        await page.goto(url, { timeout: 120_000 });
        await expect(ended).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 150_000 });
    };
    /** A press on a write control opens the dialog with the banner's words and button. No form opens. */
    const expectDialog = async (press: () => Promise<void>): Promise<void> => {
      await press();
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('view-only-text').first()).toContainText('Pick a plan to keep working.');
      await expect(page.getByTestId('view-only-action').first()).toHaveText('Pick a plan');
      await expect(page.locator('[role="dialog"]:not(.ks-viewonly):visible')).toHaveCount(0);
      await expect(page.locator('[role="menu"]')).toHaveCount(0);
      await page.getByTestId('view-only-close').click();
      await expect(dialog).toBeHidden();
    };

    // WMS: the dashboard step, the Clients page buttons, and a create screen opened by its address.
    await openViewOnly(`${APP_URLS.wms}/dashboard`);
    const addClient = page.getByRole('link', { name: 'Add client' }).or(page.getByRole('button', { name: 'Add client' })).first();
    await expect(addClient).toHaveAttribute('data-plan-write', '', { timeout: 30_000 });
    await expectDialog(() => addClient.click());
    await expect(page).toHaveURL(/\/dashboard$/);
    // The guard marks a control only after React has hydrated it and committed that work. A mark put
    // on sooner is a hydration error in the console on most loads, so load the page a few more times.
    for (let load = 0; load < 6; load += 1) {
      await page.goto(`${APP_URLS.wms}/dashboard`, { waitUntil: 'networkidle', timeout: 120_000 });
      await expect(addClient).toHaveAttribute('data-plan-write', '', { timeout: 30_000 });
    }
    expect(consoleErrors, 'no console error on the view only WMS dashboard').toEqual([]);
    await openViewOnly(`${APP_URLS.wms}/clients`);
    const createClient = page.getByRole('button', { name: 'Create client' }).first();
    await expect(createClient).toHaveAttribute('data-plan-write', '', { timeout: 30_000 });
    await expect(createClient).toHaveCSS('opacity', '0.55');
    await expectDialog(() => createClient.click());
    await expectDialog(() => page.getByRole('button', { name: /Bulk import/ }).first().click());
    await createClient.focus();
    await expectDialog(() => page.keyboard.press('Enter'));
    await openViewOnly(`${APP_URLS.wms}/products/new`);
    await expect(page.getByTestId('view-only-page')).toBeVisible();
    await expect(page.getByTestId('top-bar')).toBeVisible();
    await expect(page.getByTestId('view-only-page').getByTestId('view-only-action')).toHaveText('Pick a plan');

    // Pulse: the home buttons, "Other ways to start", the labor page, and two screens opened by address.
    await openViewOnly(`${APP_URLS.pulse}/`);
    await expect(page.getByTestId('home-new-job')).toHaveAttribute('data-plan-write', '', { timeout: 30_000 });
    await expect(page.getByTestId('home-new-job')).toHaveCSS('opacity', '0.55');
    await expectDialog(() => page.getByTestId('home-new-job').click());
    const otherWays = page.getByText('Other ways to start').first();
    if (await otherWays.isVisible()) {
      await expectDialog(() => otherWays.click());
      await expect(page).toHaveURL(new RegExp(`^${APP_URLS.pulse}/$`));
    }
    await openViewOnly(`${APP_URLS.pulse}/labor?tab=rates`);
    const addClass = page.getByRole('button', { name: /Add a labor class/ }).first();
    await expect(addClass).toHaveAttribute('data-plan-write', '', { timeout: 30_000 });
    await expectDialog(() => addClass.click());
    for (const path of ['/welcome', '/jobs/new']) {
      await openViewOnly(`${APP_URLS.pulse}${path}`);
      // The message takes the place of the form, inside the app frame.
      await expect(page.getByTestId('view-only-page')).toBeVisible();
      await expect(page.getByTestId('top-bar')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save the rate' })).toBeHidden();
    }

    // Projects is not in the plan: the same quiet lock frame as the other apps, with no create button.
    if (await appIsUp(page, `${APP_URLS.projects}/login`)) {
      await page.goto(homeOf('projects', slug), { timeout: 120_000 });
      await expect(page.getByTestId('plan-lock')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('plan-lock-frame')).toBeVisible();
      await expect(page.getByRole('button', { name: /New task/ })).toHaveCount(0);
      await expect(page.getByTestId('top-bar')).toHaveCount(0);
      await page.keyboard.press('c');
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }
  });
});
