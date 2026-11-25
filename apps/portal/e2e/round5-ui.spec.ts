import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  APP_URLS,
  BASE_URL,
  CART_CRM_2,
  CART_PULSE,
  appIsUp,
  emailsTo,
  handoffLink,
  holdDevReloads,
  inviteLinkFor,
  joinFromInvite,
  newPerson,
  openBilling,
  payAndSucceed,
  resetRateLimits,
  runTestTool,
  setStepper,
  signUp,
  sql,
  trialAccount,
  expectPhase,
  type Person,
} from './support';

/**
 * Review round 5, the screens: what the four reviewers called blockers on pages, components and
 * words. Each test names the finding it closes.
 *
 * Set E2E_SHOTS=1 to also save pictures of the screens at 1440 and 390 wide, light and dark, under
 * docs/billing/.review/focus-ui/ (not in git).
 */
const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL } as const;
const SHOTS = process.env.E2E_SHOTS === '1';
const SHOT_DIR = path.resolve(__dirname, '../../../docs/billing/.review/focus-ui');

/**
 * The page as it is now, in four pictures: desktop and phone, light and dark. Only with E2E_SHOTS=1.
 * `keep` leaves the page as it is (what was typed, an open error) and only swaps the theme and the size.
 */
async function snap(page: Page, name: string, options: { keep?: boolean } = {}): Promise<void> {
  if (!SHOTS) return;
  const before = page.viewportSize() ?? { width: 1280, height: 800 };
  const settle = async (): Promise<void> => {
    if (!options.keep) await page.reload({ waitUntil: 'networkidle' }).catch(() => undefined);
    await page.waitForTimeout(600);
  };
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'kitstak-theme', value: theme, domain: 'localhost', path: '/' }]);
    await page.emulateMedia({ colorScheme: theme });
    if (options.keep) await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    for (const size of [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'phone', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await settle();
      await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${size.label}-${theme}.png`), fullPage: true });
    }
  }
  await page.context().addCookies([{ name: 'kitstak-theme', value: 'light', domain: 'localhost', path: '/' }]);
  await page.emulateMedia({ colorScheme: 'light' });
  if (options.keep) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize(before);
  await settle();
}

/** Every console error on this page from now on. */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** People who are on the team without a sign in of their own: a row each, as an accepted invite leaves them. */
async function addTeammates(orgId: string, count: number, tag: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const email = `mate-${tag}-${index}-${Date.now().toString(36)}@e2e.kitstak.example`;
    const [user] = await sql<{ id: string }>(`INSERT INTO core."user" (name, email, email_verified) VALUES ($1, $2, true) RETURNING id`, [`Teammate ${index + 1}`, email]);
    await sql(`INSERT INTO core.member (id, organization_id, user_id, role, created_at) VALUES (gen_random_uuid(), $1, $2, 'member', now())`, [orgId, user?.id]);
  }
}

/** Invites a person with a role and has them join from the emailed link, in a browser of their own. */
async function joinAs(page: Page, context: BrowserContext, orgId: string, person: Person, role: 'member' | 'guest'): Promise<void> {
  const invite = await page.context().request.post(`${BASE_URL}/api/auth/organization/invite-member`, {
    headers: JSON_HEADERS,
    data: { email: person.email, role, organizationId: orgId },
  });
  expect(invite.status(), `the owner invites a ${role}`).toBe(200);
  const link = await inviteLinkFor(page, person.email);
  const joined = await context.newPage();
  await joinFromInvite(joined, link, person);
  await joined.close();
}

test.describe('review round 5: signing in', () => {
  test('the code step and the password step take the keyboard focus on a desktop, and never on a phone', async ({ page, context, browser }) => {
    test.setTimeout(420_000);
    // A dev server reloads the page when a file changes. That would wipe what this test typed.
    await holdDevReloads(page.context());
    const { person } = await trialAccount(page, 'r5focus', CART_PULSE);
    await context.clearCookies();
    await resetRateLimits();

    // By mouse: "Email me a code instead" puts the focus in the code field. Typing lands in it.
    await page.goto('/login');
    await page.getByLabel('Work email').fill(person.email);
    await page.getByTestId('login-email-code').click();
    await expect(page.getByTestId('login-code-form')).toBeVisible();
    await expect(page.getByTestId('login-code')).toBeFocused();
    await page.keyboard.type('12');
    await expect(page.getByTestId('login-code')).toHaveValue('12');
    // Still there a moment later (the reviewer measured the page body at 0.3, 1.2 and 2.5 seconds).
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('login-code')).toBeFocused();
    await snap(page, 'login-code-step');

    // "Use my password instead" puts the focus in the password field.
    await page.getByTestId('login-use-password').click();
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type('abc');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('abc');

    // By keyboard: Enter on each link does the same.
    await resetRateLimits();
    await page.getByTestId('login-email-code').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('login-code-form')).toBeVisible();
    await expect(page.getByTestId('login-code')).toBeFocused();
    await page.getByTestId('login-use-password').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

    // On a phone no field is focused by itself, so no keyboard pops up over the page.
    await resetRateLimits();
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phonePage = await phone.newPage();
    await phonePage.goto('/login');
    await phonePage.getByLabel('Work email').fill(person.email);
    await phonePage.getByTestId('login-email-code').tap();
    await expect(phonePage.getByTestId('login-code-form')).toBeVisible();
    await phonePage.waitForTimeout(1_000);
    expect(await phonePage.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName)).not.toBe('login-code');
    await phone.close();
  });

  test('a sign in that goes back to another app is a plain visit: no console error on the way', async ({ page, context }) => {
    test.setTimeout(420_000);
    const crmUp = await appIsUp(page, `${APP_URLS.crm}/login`);
    test.skip(!crmUp, 'The CRM is not running.');
    await holdDevReloads(context);
    const { person } = await trialAccount(page, 'r5door', CART_CRM_2);
    await context.clearCookies();
    await resetRateLimits();

    // Signed out, a page in the CRM: the Portal's sign in opens with the full address to go back to.
    await page.goto(`${APP_URLS.crm}/`);
    await page.waitForURL((url) => url.origin === BASE_URL && url.pathname === '/login', { timeout: 90_000 });
    expect(new URL(page.url()).searchParams.get('next') ?? '').toContain(APP_URLS.crm);
    await expect(page.getByLabel('Work email')).toBeVisible();

    const errors = consoleErrors(page);
    await page.getByLabel('Work email').fill(person.email);
    await page.getByLabel('Password', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => url.origin === APP_URLS.crm, { timeout: 120_000 });
    // The reviewer's three: the blocked fetch, the failed resource and the fallback note.
    const onTheWay = errors.filter((text) => /CORS|RSC payload|ERR_FAILED|Failed to fetch/i.test(text));
    expect(onTheWay, 'no blocked fetch on the way to the app').toEqual([]);
  });
});

test.describe('review round 5: one screen and one word for each thing', () => {
  test('a new person with no organization names it on the signup step, wherever they land', async ({ page, context }) => {
    test.setTimeout(300_000);
    await resetRateLimits();
    const person = newPerson('r5noorg', 'Noor Okafor');
    const made = await context.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
      headers: JSON_HEADERS,
      data: { name: person.name, email: person.email, password: person.password },
    });
    expect(made.status()).toBe(200);

    for (const start of ['/', '/billing']) {
      await page.goto(start);
      await page.waitForURL((url) => url.pathname === '/signup/company', { timeout: 90_000 });
      await expect(page.getByRole('heading', { name: 'Name your organization' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
      // One word for the thing: "organization". Not "workspace" here and "organization" there.
      await expect(page.locator('main')).not.toContainText(/workspace/i);
      await expect(page.getByRole('button', { name: 'Create organization' })).toHaveCount(0);
    }
    await snap(page, 'signup-company');
  });

  test('"My account" sets a password with the same field as signup, and says "verify"', async ({ page }) => {
    test.setTimeout(300_000);
    // Signed up, email never verified: the account page says so in the one word the product uses.
    // A dev server reloads the page when a file changes. That would wipe what this test typed.
    await holdDevReloads(page.context());
    const { person } = await trialAccount(page, 'r5account', CART_PULSE, { verify: false });
    await page.goto('/settings/account');
    await expect(page.getByTestId('account-email')).toContainText('Not verified');
    await expect(page.getByTestId('account-verify')).toHaveText('Verify my email');
    await expect(page.getByTestId('account-page')).not.toContainText(/confirm/i);

    // An account with no password (as "Email me a code instead" leaves it): the one place to set one.
    await sql(`DELETE FROM core.account a USING core."user" u WHERE u.id = a.user_id AND u.email = $1 AND a.provider_id = 'credential'`, [person.email]);
    await page.reload();
    const form = page.getByTestId('account-password-form');
    await expect(form).toBeVisible({ timeout: 90_000 });
    // The eye button inside the field, as on signup. No browser checkbox under it.
    await expect(form.locator('input[type="checkbox"]')).toHaveCount(0);
    await page.getByTestId('account-password').fill('whitlock12');
    await form.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByTestId('account-password')).toHaveAttribute('type', 'text');
    // The meter and the rule checklist, the same ones as signup.
    await expect(form.getByText('Password strength:')).toBeAttached();
    await expect(form.getByTestId('password-rules')).toBeVisible();
    // A weak try: the missing rules turn red right under the field. The button is under them, not beside.
    await page.getByTestId('account-password-save').click();
    await expect(form.getByTestId('password-rules').locator('[data-state="missing"]').first()).toBeVisible();
    const field = await page.getByTestId('account-password').boundingBox();
    const save = await page.getByTestId('account-password-save').boundingBox();
    expect((save?.y ?? 0) > (field?.y ?? 0) + (field?.height ?? 0), 'the button sits under the field and its rules').toBe(true);
    await snap(page, 'account-set-password', { keep: true });
    await page.getByTestId('account-password').fill(`Quiet-Harbor-${Date.now().toString(36)}-73!`);
    await page.getByTestId('account-password-save').click();
    await expect(page.getByTestId('account-password-set')).toBeVisible({ timeout: 30_000 });
  });

  test('the signup picker says only what is true for the cart on screen', async ({ page }) => {
    test.setTimeout(300_000);
    // A dev server reloads the page when a file changes. That would wipe what this test typed.
    await holdDevReloads(page.context());
    const person = newPerson('r5picker');
    await signUp(page, person, { link: handoffLink({ products: ['crm', 'pulse'], seats: 6, warehouses: 1, interval: 'monthly' }, { name: person.name, email: person.email, company: person.company }), prefilled: true });
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });

    // CRM and Pulse with 6 people: Pulse covers every seat, so nothing says "up to 5 seats".
    const picker = page.getByTestId('plan-picker');
    await expect(page.getByTestId('plan-pulse-note')).toHaveText('Pulse covers every seat in a plan with CRM or Projects. All 6 people can use it for the same flat price.');
    await expect(picker).not.toContainText(/up to 5 seats/i);
    await expect(picker).toContainText('Pulse: $29 per month for your whole team');
    await snap(page, 'picker-crm-pulse', { keep: true });

    // CRM off, before any trial or plan exists: one fact about the discount. Nothing "goes from" a price.
    await page.getByTestId('plan-product-crm').click();
    await expect(page.getByTestId('plan-bundle-note')).toHaveText('The 20% bundle discount needs 2 apps.');
    await expect(picker).not.toContainText('Removing CRM');
    await expect(picker).not.toContainText('Your plan goes from');

    // Pulse alone with the stepper at 6 and one person on the team: "you picked 6 seats", not "you have 6".
    await setStepper(page, 'plan-seats', 6);
    await expect(page.getByTestId('plan-pulse-note')).toContainText('Pulse alone covers up to 5 people, and you picked 6 seats.');
    await expect(page.getByTestId('plan-pulse-note')).not.toContainText('you have 6');
    // Alone, the limit is real and is named.
    await expect(picker).toContainText('Up to 5 seats.');
  });
});

test.describe('review round 5: billing home', () => {
  test('a team bigger than its saved cart sees the plan it can buy: one total on home, the picker and the review step', async ({ page }) => {
    test.setTimeout(420_000);
    const { orgId } = await trialAccount(page, 'r5price', CART_CRM_2);
    // Two more people joined after the cart was saved with 2 seats: 3 people now.
    await addTeammates(orgId, 2, 'r5price');

    const check = async (label: string): Promise<void> => {
      await openBilling(page);
      await expect(page.getByTestId('billing-plan-card'), `${label}: the Plan card`).toContainText('3 seats');
      await expect(page.getByTestId('billing-cost'), `${label}: the Cost card`).toContainText('$87.00');
      await expect(page.getByTestId('billing-cost')).not.toContainText('$58.00');
      await expect(page.getByTestId('billing-usage-seats')).toContainText('3 people on your team');
    };
    await check('in the trial');
    await expect(page.getByTestId('billing-cost')).toContainText('This is your price after the free trial.');

    // The trial ends. The reviewer's case: home said $58.00 and the picker $87.00.
    await runTestTool(page, 'shift-trial-end');
    await page.reload();
    await expectPhase(page, 'trial_ended');
    await check('after the trial');
    await snap(page, 'billing-home-team');

    await page.goto('/billing/plan');
    await expect(page.getByTestId('plan-picker')).toContainText('$87.00', { timeout: 90_000 });
    // The review step holds the cart as it was saved, and asks for the same 3 seats. Never $58.00.
    await page.goto('/billing/checkout');
    await expect(page.locator('main')).toContainText('You have 3 people. Pick 3 seats or more.', { timeout: 90_000 });
    await expect(page.locator('main')).not.toContainText('$58.00');

    // The seat note under the invite form says what is true now: the trial is over.
    await page.goto('/settings/organization');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('main')).toContainText('Your free trial has ended. Seats are counted when you pick a plan.');
    await expect(page.locator('main')).not.toContainText('No seat limit during your free trial');
  });

  test('picking a plan from an app ends with "Back to Pulse" as the main button', async ({ page }) => {
    test.setTimeout(420_000);
    await trialAccount(page, 'r5back', CART_PULSE);
    await runTestTool(page, 'shift-trial-end');
    await page.reload();
    await expectPhase(page, 'trial_ended');
    // The "Pick a plan" button of a view only Pulse opens the picker with the app named.
    await page.goto('/billing/plan?from=pulse');
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('plan-submit').click();
    await payAndSucceed(page);
    const back = page.getByTestId('checkout-success-back');
    await expect(back).toHaveText('Back to Pulse');
    expect(new URL((await back.getAttribute('href')) ?? '', BASE_URL).origin).toBe(APP_URLS.pulse);
    await expect(page.getByTestId('checkout-success-open-apps')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See my plan' })).toBeVisible();

    // Without an app to go back to, the main button stays "Open my apps".
    await page.context().clearCookies();
    await trialAccount(page, 'r5noback', CART_PULSE);
    await runTestTool(page, 'shift-trial-end');
    await page.reload();
    await page.goto('/billing/plan');
    await page.getByTestId('plan-submit').click();
    await payAndSucceed(page);
    await expect(page.getByTestId('checkout-success-open-apps')).toHaveText('Open my apps');
    await expect(page.getByTestId('checkout-success-back')).toHaveCount(0);
  });
});

test.describe('review round 5: people who cannot change the plan', () => {
  test('a member asks for an app with one click, and the owner gets the email', async ({ page, browser }) => {
    test.setTimeout(480_000);
    const { orgId, person: owner } = await trialAccount(page, 'r5ask', CART_CRM_2);
    const member = newPerson('r5asker', 'Ana Reyes');
    const memberContext = await browser.newContext();
    await joinAs(page, memberContext, orgId, member, 'member');
    const memberPage = await memberContext.newPage();
    const allowAll = (await sql<{ n: string }>(`SELECT count(*)::text AS n FROM core.entitlements WHERE org_id = $1`, [orgId]))[0]?.n === '0';
    expect(allowAll, 'the trial wrote its app rows').toBe(false);

    await memberPage.goto('/billing');
    const card = memberPage.getByTestId('billing-member-card');
    await expect(card).toBeVisible({ timeout: 90_000 });
    // Who manages billing, said as a fact. Not "Ask Maya Chen to manage billing."
    await expect(card).toContainText(`${owner.name} manages billing for`);
    await expect(card).not.toContainText('to manage billing');

    const asks = memberPage.getByTestId('member-ask');
    test.skip((await asks.count()) === 0, 'The Portal runs with the allow all switch on: every app is open, so there is nothing to ask for.');
    await expect(memberPage.getByTestId('member-ask-crm')).toHaveCount(0);
    const first = owner.name.split(' ')[0];
    const button = memberPage.getByTestId('member-ask-button-projects');
    await expect(button).toHaveText(`Ask ${first} to add Projects`);
    await snap(memberPage, 'member-billing');

    const asked = new Date();
    await memberPage.getByTestId('member-ask-button-projects').click();
    await expect(memberPage.getByTestId('member-asked-projects')).toHaveText('Asked today', { timeout: 30_000 });
    // The owner has the email, with the way to the picker.
    await expect
      .poll(async () => (await emailsTo(owner.email, 'app_request')).length, { timeout: 30_000 })
      .toBe(1);
    const mail = (await emailsTo(owner.email, 'app_request'))[0];
    expect(mail?.subject).toBe(`${member.name} asked for Projects`);
    expect(mail?.body_text ?? '').toContain('/billing/plan?add=projects');
    expect(mail?.body_text ?? '').toContain(`org=${orgId}`);
    expect(asked.getTime()).toBeLessThanOrEqual(Date.now());

    // Once a day: after a reload the button is still "Asked today", and a second ask sends nothing.
    await memberPage.reload();
    await expect(memberPage.getByTestId('member-asked-projects')).toHaveText('Asked today');
    await expect(memberPage.getByTestId('member-ask-button-projects')).toHaveCount(0);
    expect(await emailsTo(owner.email, 'app_request')).toHaveLength(1);

    // A lock screen sends the member here with its app in focus.
    await memberPage.goto('/billing?ask=pulse&from=pulse');
    await expect(memberPage.getByTestId('member-ask-button-pulse')).toBeFocused();

    // The lock screen of an app that is not in the plan has that one button, for a member.
    if (await appIsUp(memberPage, `${APP_URLS.pulse}/login`)) {
      await memberPage.goto(`${APP_URLS.pulse}/`, { timeout: 120_000 });
      const lock = memberPage.getByTestId('plan-lock');
      const primary = memberPage.getByTestId('plan-lock-primary');
      await expect(lock.or(memberPage.getByRole('heading', { name: /Hello|not in an organization/ })).first()).toBeVisible({ timeout: 120_000 });
      if (await lock.isVisible()) {
        await expect(primary).toHaveText(`Ask ${first} to add Pulse`);
        await primary.click();
        await memberPage.waitForURL((url) => url.origin === BASE_URL && url.pathname === '/billing', { timeout: 90_000 });
        await expect(memberPage.getByTestId('member-ask-button-pulse')).toBeFocused();
      } else {
        test.info().annotations.push({ type: 'skipped part', description: 'Pulse runs with the allow all switch on: it has no lock screen.' });
      }
    } else {
      test.info().annotations.push({ type: 'skipped part', description: 'Pulse is not running.' });
    }
    await memberContext.close();
  });

  test('a guest sees no setup steps, in the Portal or in the CRM, and the CRM asks for nothing a guest is refused', async ({ page, browser }) => {
    test.setTimeout(480_000);
    const { orgId } = await trialAccount(page, 'r5guest', CART_CRM_2);
    const guest = newPerson('r5guestp', 'Lucas Silva');
    const guestContext = await browser.newContext();
    await holdDevReloads(guestContext);
    await joinAs(page, guestContext, orgId, guest, 'guest');
    const guestPage = await guestContext.newPage();

    // The launcher is the apps and nothing else. No guide.
    await guestPage.goto('/');
    await expect(guestPage.getByRole('heading', { name: 'Your apps' })).toBeVisible({ timeout: 90_000 });
    await expect(guestPage.getByText(/Set up /)).toHaveCount(0);

    // Organization settings: one line for a guest where the owner has the setup guide.
    await guestPage.goto('/settings/organization');
    await expect(guestPage.getByTestId('org-guest-note')).toHaveText('You are a guest. You see what your team adds you to.', { timeout: 90_000 });
    await expect(guestPage.locator('#setup')).toHaveCount(0);
    await snap(guestPage, 'guest-organization');

    const crmUp = await appIsUp(guestPage, `${APP_URLS.crm}/login`);
    if (!crmUp) {
      test.info().annotations.push({ type: 'skipped part', description: 'The CRM is not running.' });
      await guestContext.close();
      return;
    }
    const errors = consoleErrors(guestPage);
    const refused: string[] = [];
    guestPage.on('response', (response) => {
      if (response.status() === 403 && response.url().includes('/api/v1/')) refused.push(new URL(response.url()).pathname);
    });
    await guestPage.goto(`${APP_URLS.crm}/`, { timeout: 120_000 });
    const home = guestPage.getByTestId('home-page');
    const lock = guestPage.getByTestId('plan-lock');
    await expect(home.or(lock).first()).toBeVisible({ timeout: 120_000 });
    if (await home.isVisible()) {
      await expect(guestPage.getByTestId('home-guest-note')).toHaveText('You are a guest. You see what your team adds you to.');
      await expect(guestPage.getByText('Getting started')).toHaveCount(0);
      await guestPage.waitForLoadState('networkidle').catch(() => undefined);
      await guestPage.waitForTimeout(2_000);
      expect(refused, 'the CRM home asks for nothing a guest is refused').toEqual([]);
      expect(errors.filter((text) => /403|Forbidden/i.test(text)), 'no refused request in the console').toEqual([]);
      await snap(guestPage, 'guest-crm-home');
    } else {
      test.info().annotations.push({ type: 'skipped part', description: 'The CRM home did not open for the guest.' });
    }
    await guestContext.close();
  });
});

test.describe('review round 5: the signup page', () => {
  test('one line says what you get, the small pictures are buttons, and each theme has its own pictures', async ({ page, browser }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handoffLink({ products: ['wms'], seats: 1, warehouses: 1, interval: 'monthly' }));
    const hero = page.getByTestId('hero-signup');
    await expect(hero).toBeVisible({ timeout: 90_000 });
    // The line and the picture follow the app in the cart.
    await expect(page.getByTestId('signup-shots')).toHaveAttribute('data-app', 'wms');
    await expect(page.getByTestId('hero-line')).toHaveText('See every open order and how long it has waited.');
    // The four small pictures are real buttons. Each swaps the big picture and the line.
    for (const [app, line] of [
      ['crm', 'See every deal and what it is worth.'],
      ['projects', 'See what is due today and what is late.'],
      ['pulse', 'See the profit on every job.'],
    ] as const) {
      const button = page.getByTestId(`hero-shot-${app}`);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('signup-shots')).toHaveAttribute('data-app', app);
      await expect(page.getByTestId('hero-line')).toHaveText(line);
    }
    // Light page, light picture. Dark page, dark picture. Never a white picture on a black page.
    const shown = async (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('[data-testid="signup-shots"] figure img')]
          .filter((img) => img.offsetParent !== null)
          .map((img) => new URL(img.src).pathname),
      );
    await page.context().addCookies([{ name: 'kitstak-theme', value: 'light', domain: 'localhost', path: '/' }]);
    await page.reload();
    await expect(hero).toBeVisible({ timeout: 90_000 });
    expect(await shown()).toEqual(['/signup/wms-light.webp']);
    await page.context().addCookies([{ name: 'kitstak-theme', value: 'dark', domain: 'localhost', path: '/' }]);
    await page.reload();
    await expect(hero).toBeVisible({ timeout: 90_000 });
    expect(await shown()).toEqual(['/signup/wms-dark.webp']);
    // Every picture file is there.
    for (const app of ['crm', 'wms', 'projects', 'pulse']) {
      for (const theme of ['light', 'dark']) {
        expect((await page.request.get(`/signup/${app}-${theme}.webp`)).status(), `${app} ${theme}`).toBe(200);
      }
    }
    // Nothing under the picture is cut off on a 1440 by 900 screen.
    await expect(page.getByTestId('signup-promises').locator('li').last()).toBeInViewport({ ratio: 1 });

    // A phone has no brand panel: one small picture and the line sit above the form, and every
    // field and the button are still on the first screen.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phonePage = await phone.newPage();
    await phonePage.goto(handoffLink({ products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' }));
    await expect(phonePage.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect(phonePage.getByTestId('signup-teaser')).toContainText('See the profit on every job.');
    await expect(phonePage.getByTestId('signup-teaser').locator('img:visible')).toHaveCount(1);
    await expect(phonePage.getByTestId('signup-submit')).toBeInViewport({ ratio: 1 });
    // A small phone (360 by 740) with no cart has room for it too.
    await phonePage.setViewportSize({ width: 360, height: 740 });
    await phonePage.goto('/signup');
    await expect(phonePage.getByTestId('signup-teaser')).toBeVisible({ timeout: 90_000 });
    await expect(phonePage.getByTestId('signup-submit')).toBeInViewport({ ratio: 1 });
    // With a cart on that small phone the row steps aside: the button stays on the first screen.
    await phonePage.goto(handoffLink({ products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' }));
    await expect(phonePage.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect(phonePage.getByTestId('signup-teaser')).toBeHidden();
    await expect(phonePage.getByTestId('signup-submit')).toBeInViewport({ ratio: 1 });
    await phone.close();
  });
});
