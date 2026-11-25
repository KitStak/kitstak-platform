import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  APP_URLS,
  BASE_URL,
  CART_CRM_2,
  CART_PULSE,
  appIsUp,
  emailsTo,
  holdDevReloads,
  inviteLinkFor,
  invitePerson,
  joinFromInvite,
  newPerson,
  orgIdOf,
  pickPlan,
  resetRateLimits,
  sql,
  trialAccount,
  userIdOf,
  type Person,
} from './support';

/**
 * Review round 4, the server side. Each test is one blocker from the round 4 reviews, proven in a
 * real browser against the running Portal (and the CRM, the WMS, Projects and Pulse where the
 * blocker is about them; a part whose app is not running is skipped by name, never passed).
 */

const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL };

/** The newest 6 digit code of this kind mailed to the address after `after`, from the outbox table. */
async function newestCode(email: string, kind: 'sign_in' | 'verify' | 'reset', after: Date): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const rows = await sql<{ body_text: string | null }>(
          `SELECT body_text FROM core.billing_emails
            WHERE to_email = $1 AND template = $2 AND created_at > $3 AND coalesce(payload->>'purpose', '') = $4
            ORDER BY created_at DESC LIMIT 1`,
          [email.toLowerCase(), kind === 'reset' ? 'reset_password' : 'verify_email', after, kind === 'sign_in' ? 'sign_in' : ''],
        );
        code = /^\s*(\d{6})\s*$/m.exec(rows[0]?.body_text ?? '')?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a ${kind} code email for ${email}` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

/** Opens the code step of the sign in page for this address. `at` is the page to start from. */
async function askForCode(page: Page, email: string, at = '/login'): Promise<void> {
  await page.goto(at);
  await page.getByLabel('Work email').fill(email);
  await page.getByTestId('login-email-code').click();
  await expect(page.getByTestId('login-code-form')).toBeVisible();
}

async function signInWithCode(page: Page, email: string, at = '/login'): Promise<void> {
  await resetRateLimits();
  const asked = new Date();
  await askForCode(page, email, at);
  await page.getByTestId('login-code').fill(await newestCode(email, 'sign_in', asked));
  await page.waitForURL((url) => !(url.origin === BASE_URL && url.pathname.startsWith('/login')), { timeout: 90_000 });
}

async function signInWithPassword(page: Page, person: Person): Promise<void> {
  await resetRateLimits();
  await page.getByLabel('Work email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function sessionOf(context: BrowserContext): Promise<{ user?: { email?: string }; session?: { activeOrganizationId?: string | null } } | null> {
  const response = await context.request.get(`${BASE_URL}/api/auth/get-session`);
  return (await response.json()) as { user?: { email?: string }; session?: { activeOrganizationId?: string | null } } | null;
}

async function passwordRows(email: string): Promise<number> {
  const rows = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM core.account a JOIN core."user" u ON u.id = a.user_id
      WHERE u.email = $1 AND a.provider_id = 'credential' AND a.password IS NOT NULL`,
    [email.toLowerCase()],
  );
  return Number(rows[0]?.n ?? 0);
}

/** An account with no organization: the sign up endpoint only, as the reviewer made it. */
async function accountOnly(context: BrowserContext, label: string): Promise<Person> {
  await resetRateLimits();
  const person = newPerson(label, 'Noor Okafor');
  const made = await context.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
    headers: JSON_HEADERS,
    data: { name: person.name, email: person.email, password: person.password },
  });
  expect(made.status(), 'the account is made').toBe(200);
  return person;
}

/** How many times the main frame loads a document while `run` is going on. A loop shows as a big number. */
async function countLoads(page: Page, run: () => Promise<void>): Promise<number> {
  let loads = 0;
  const onNavigated = (frame: { parentFrame(): unknown }) => {
    if (frame.parentFrame() === null) loads += 1;
  };
  page.on('framenavigated', onNavigated);
  await run();
  page.off('framenavigated', onNavigated);
  return loads;
}

test.describe('round 4: a signed in person who is in no organization', () => {
  test('every app gives one calm answer with one button to the Portal, and nothing reloads in a loop', async ({ page, context }) => {
    test.setTimeout(420_000);
    // A dev server reloads the page by itself when a file changes. That is not the loop this test is about.
    await holdDevReloads(context);
    const person = await accountOnly(context, 'noorg');
    expect(await sql(`SELECT 1 FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1`, [person.email])).toHaveLength(0);

    const apps = [
      { name: 'WMS', url: APP_URLS.wms, paths: ['/', '/setup-warehouse', '/locked', '/dashboard'], testId: 'wms-no-organization' },
      { name: 'CRM', url: APP_URLS.crm, paths: ['/', '/welcome'], testId: 'crm-no-organization' },
      { name: 'Projects', url: APP_URLS.projects, paths: ['/'], testId: null },
      { name: 'Pulse', url: APP_URLS.pulse, paths: ['/'], testId: null },
    ] as const;
    let checked = 0;
    for (const app of apps) {
      if (!(await appIsUp(page, app.url))) {
        test.info().annotations.push({ type: 'skipped part', description: `${app.name} is not running at ${app.url}` });
        continue;
      }
      for (const path of app.paths) {
        const loads = await countLoads(page, async () => {
          await page.goto(`${app.url}${path}`, { waitUntil: 'domcontentloaded' });
          await expect(page.getByRole('heading', { name: 'You are not in an organization yet' })).toBeVisible({ timeout: 90_000 });
          // The reviewer counted 61 page loads in 10 seconds here. Give a loop time to show.
          await page.waitForTimeout(4_000);
        });
        // One load for the address, plus the redirects on the way. A loop makes dozens.
        expect(loads, `${app.name} ${path} settles`).toBeLessThanOrEqual(4);
        await expect(page.getByRole('heading', { name: 'You are not in an organization yet' })).toBeVisible();
        if (app.testId) await expect(page.getByTestId(app.testId)).toBeVisible();
        const toPortal = page.getByRole('link', { name: 'Go to the Portal' });
        await expect(toPortal).toHaveCount(1);
        expect(new URL((await toPortal.getAttribute('href')) ?? '', app.url).origin).toBe(BASE_URL);
        // No setup wizard of its own, and no "not in your plan" for a person with no organization.
        await expect(page.getByText(/not in your plan/i)).toHaveCount(0);
        checked += 1;
      }
    }
    // The Portal is where one is made. A new person lands on the one screen for that, the signup
    // step, whichever page they open (review round 5: before, the launcher had a second screen
    // for the same step, with other words).
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/signup/company', { timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Name your organization' })).toBeVisible();
    expect(checked, 'at least one product app was checked').toBeGreaterThan(0);
  });
});

test.describe('round 4: links that name their organization', () => {
  test('a person in two organizations lands in the one the email is about, and a new session starts in the one they own', async ({ page, context }) => {
    test.setTimeout(420_000);
    const { person, orgId: owned } = await trialAccount(page, 'twoorg', CART_PULSE);
    const userId = await userIdOf(person.email);
    // A second organization, earlier in the alphabet, where this person is only a member.
    const other = randomUUID();
    const tag = Date.now().toString(36);
    await sql(`INSERT INTO core.organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())`, [other, `AAA Other Team ${tag}`, `aaa-other-team-${tag}`]);
    await sql(`INSERT INTO core.member (id, organization_id, user_id, role, created_at) VALUES (gen_random_uuid(), $1, $2, 'member', now())`, [other, userId]);
    const ownedName = (await sql<{ name: string }>(`SELECT name FROM core.organization WHERE id = $1`, [owned]))[0]?.name ?? '';

    try {
      // Every billing email carries the organization it is about.
      const welcome = (await emailsTo(person.email, 'welcome')).at(-1);
      expect(welcome?.body_text ?? '').toContain(`org=${owned}`);

      // Signed out, from the failed payment email. The other organization was the one used last.
      await sql(`INSERT INTO core.user_last_org (user_id, org_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id`, [userId, other]);
      await context.clearCookies();
      await page.goto(`/billing?fix=payment&org=${owned}`);
      await page.waitForURL(/\/login\?next=/);
      await signInWithPassword(page, person);
      await page.waitForURL((url) => url.pathname === '/billing', { timeout: 90_000 });
      await expect(page.getByTestId('billing-home')).toBeVisible({ timeout: 90_000 });
      // The page is the one from the link, for the organization from the link, with the key gone.
      expect(new URL(page.url()).searchParams.get('fix')).toBe('payment');
      expect(new URL(page.url()).searchParams.get('org')).toBeNull();
      expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(owned);
      await expect(page.locator('header').first()).toContainText(ownedName);
      await expect(page.getByText('Ask ')).toHaveCount(0);

      // A live session that is in the other organization: a receipt link switches, then shows the page.
      const switched = await context.request.post(`${BASE_URL}/api/auth/organization/set-active`, { headers: JSON_HEADERS, data: { organizationId: other } });
      expect(switched.status()).toBe(200);
      expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(other);
      await page.goto(`/billing/invoices?org=${owned}`);
      await page.waitForURL((url) => url.pathname === '/billing/invoices' && !url.searchParams.has('org'), { timeout: 90_000 });
      expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(owned);
      await expect(page.locator('header').first()).toContainText(ownedName);

      // A link for an organization this person is not in: one plain sentence, nobody else's page.
      const stranger = randomUUID();
      await sql(`INSERT INTO core.organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())`, [stranger, `Stranger Co ${tag}`, `stranger-co-${tag}`]);
      try {
        await page.goto(`/billing?fix=payment&org=${stranger}`);
        await expect(page.getByTestId('org-not-a-member')).toBeVisible({ timeout: 90_000 });
        await expect(page.getByRole('heading', { name: 'This link is for another organization.' })).toBeVisible();
        await expect(page.getByTestId('org-not-a-member-text')).toContainText(person.email);
        await expect(page.locator('body')).not.toContainText(`Stranger Co ${tag}`);
        expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(owned);
      } finally {
        await sql(`DELETE FROM core.organization WHERE id = $1`, [stranger]);
      }

      // A new session with no note of the last organization starts in the one this person owns,
      // not in the first by name.
      await sql(`DELETE FROM core.user_last_org WHERE user_id = $1`, [userId]);
      await context.clearCookies();
      await page.goto('/login');
      await signInWithPassword(page, person);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
      expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(owned);

      // And the organization picked last is where the next session starts.
      await context.request.post(`${BASE_URL}/api/auth/organization/set-active`, { headers: JSON_HEADERS, data: { organizationId: other } });
      await expect.poll(async () => (await sql<{ org_id: string }>(`SELECT org_id FROM core.user_last_org WHERE user_id = $1`, [userId]))[0]?.org_id).toBe(other);
      await context.clearCookies();
      await page.goto('/login');
      await signInWithPassword(page, person);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
      expect((await sessionOf(context))?.session?.activeOrganizationId).toBe(other);
    } finally {
      await sql(`DELETE FROM core.organization WHERE id = $1`, [other]);
    }
  });
});

test.describe('round 4: an old session after a password reset', () => {
  test('reset in one browser, and the other browser is signed out on its very next request', async ({ browser, page, context }) => {
    test.setTimeout(420_000);
    const { person, orgId } = await trialAccount(page, 'resetold', CART_PULSE);
    await page.goto('/billing/cancel');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 90_000 });
    expect((await sessionOf(context))?.user?.email).toBe(person.email);

    // Browser two: forgot password, the code, a new password.
    await resetRateLimits();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const asked = new Date();
    await otherPage.goto('/forgot-password');
    await otherPage.getByLabel(/email/i).first().fill(person.email);
    await otherPage.getByRole('button', { name: /Send code/ }).click();
    await otherPage.waitForURL(/reset-password/, { timeout: 60_000 });
    await otherPage.locator('input[autocomplete="one-time-code"]').fill(await newestCode(person.email, 'reset', asked));
    await otherPage.locator('input[type=password]').first().fill(`${person.password}x`);
    await otherPage.getByRole('button', { name: 'Save new password' }).click();
    await otherPage.waitForURL((url) => !url.pathname.startsWith('/reset-password'), { timeout: 60_000 });
    const sessions = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM core.session s JOIN core."user" u ON u.id = s.user_id WHERE u.email = $1`, [person.email]);
    expect(sessions[0]?.n, 'only the new session is left').toBe('1');

    // Browser one, at once (the reviewer could still cancel the plan for 5 minutes here).
    expect(await sessionOf(context), 'the old session is refused by the sign in layer').toBeNull();
    const csv = await context.request.get(`${BASE_URL}/billing/activity/export`, { maxRedirects: 0 });
    expect(csv.status(), 'the activity file is not handed out').not.toBe(200);
    const before = await sql(`SELECT action FROM core.billing_audit_log WHERE org_id = $1 ORDER BY created_at`, [orgId]);
    await page.goto('/billing/cancel');
    await page.waitForURL(/\/login\?next=%2Fbilling%2Fcancel/, { timeout: 60_000 });
    await page.goto('/billing');
    await page.waitForURL(/\/login/, { timeout: 60_000 });
    // Nothing was written by the old session.
    expect(await sql(`SELECT action FROM core.billing_audit_log WHERE org_id = $1 ORDER BY created_at`, [orgId])).toEqual(before);
    await other.close();
  });
});

test.describe('round 4: sign in with a code, again and again', () => {
  test('an account that never confirmed its email: the second and third code arrive, and the removed password is said out loud', async ({ page, context }) => {
    test.setTimeout(420_000);
    const { person } = await trialAccount(page, 'codetwice', CART_PULSE, { verify: false });
    expect(await passwordRows(person.email)).toBe(1);
    await context.clearCookies();

    // First code sign in. The email was never proven, so the password set before goes away.
    await signInWithCode(page, person.email);
    await page.waitForURL((url) => url.pathname === '/settings/account', { timeout: 60_000 });
    await expect(page.getByTestId('account-password-removed')).toContainText('Your old password no longer works');
    await expect(page.getByTestId('account-password-removed')).toContainText('Set a new one below, or keep signing in with a code.');
    expect(await passwordRows(person.email)).toBe(0);
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: true }]);

    // The old password is refused, in the usual words.
    await context.clearCookies();
    await page.goto('/login');
    await signInWithPassword(page, person);
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await sessionOf(context)).toBeNull();

    // Second and third code: both are mailed, both sign in (the reviewer got no second code at all).
    for (const round of ['second', 'third']) {
      await context.clearCookies();
      await signInWithCode(page, person.email);
      expect((await sessionOf(context))?.user?.email, `${round} code sign in`).toBe(person.email);
      // Nothing more to say: the notice is only for the sign in that removed the password.
      expect(new URL(page.url()).searchParams.get('notice')).toBeNull();
    }

    // "Set a password" on My account, reached from the account menu.
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByTestId('menu-account').click();
    await page.waitForURL((url) => url.pathname === '/settings/account', { timeout: 60_000 });
    await expect(page.getByTestId('account-email')).toContainText(person.email);
    await expect(page.getByTestId('account-email')).toContainText('Verified');
    await expect(page.getByTestId('account-no-password')).toBeVisible();
    // A weak one is refused in plain words, and nothing is saved.
    await page.getByTestId('account-password').fill('short');
    await page.getByTestId('account-password-save').click();
    // The same password field as signup (review round 5): the eye button, the meter and the rules,
    // and the rules that are still missing turn red. No browser checkbox.
    const passwordForm = page.getByTestId('account-password-form');
    await expect(passwordForm.getByRole('alert')).toHaveText(/.+/);
    await expect(passwordForm.getByTestId('password-rules').locator('[data-state="missing"]').first()).toBeVisible();
    await expect(passwordForm.getByText('Password strength:')).toBeAttached();
    await expect(passwordForm.locator('input[type="checkbox"]')).toHaveCount(0);
    await passwordForm.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByTestId('account-password')).toHaveAttribute('type', 'text');
    expect(await passwordRows(person.email)).toBe(0);
    const fresh = `Quiet-Harbor-${Date.now().toString(36)}-73!`;
    await page.getByTestId('account-password').fill(fresh);
    await page.getByTestId('account-password-save').click();
    await expect(page.getByTestId('account-password-set')).toBeVisible({ timeout: 30_000 });
    expect(await passwordRows(person.email)).toBe(1);

    // The new password signs in. So does a code, still.
    await context.clearCookies();
    await page.goto('/login');
    await signInWithPassword(page, { ...person, password: fresh });
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
    await context.clearCookies();
    await signInWithCode(page, person.email);
    expect((await sessionOf(context))?.user?.email).toBe(person.email);
    expect(await passwordRows(person.email), 'a confirmed account keeps its password on a code sign in').toBe(1);
  });

  test('a "no password" signup that skipped the code: every code arrives, and there is no password row to remove', async ({ page, context }) => {
    test.setTimeout(420_000);
    await resetRateLimits();
    const person = newPerson('nopass2', 'Dana Whitlock');
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
    await page.getByTestId('signup-name').fill(person.name);
    await page.getByTestId('signup-email').fill(person.email);
    await page.getByTestId('signup-company').fill(person.company);
    await page.getByTestId('signup-email-code').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    // "No password needed" is simply true: the account has no password row at all.
    await expect.poll(() => passwordRows(person.email)).toBe(0);
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: false }]);

    for (const round of ['first', 'second', 'third']) {
      await context.clearCookies();
      await signInWithCode(page, person.email);
      expect((await sessionOf(context))?.user?.email, `${round} code sign in`).toBe(person.email);
      // No password was ever chosen, so nothing is said about one.
      expect(new URL(page.url()).searchParams.get('notice')).toBeNull();
    }
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: true }]);
    await page.goto('/settings/account');
    await expect(page.getByTestId('account-no-password')).toContainText('You have no password.');
  });
});

test.describe('round 4: a person who was switched off', () => {
  test('gets no reset code and no sign in code, cannot reset, and reads the same words as an address with no account', async ({ page, context }) => {
    test.setTimeout(420_000);
    const { person } = await trialAccount(page, 'switchedoff', CART_PULSE);
    const userId = await userIdOf(person.email);
    await context.clearCookies();
    // Switched off the way the WMS does it (`switchOffSignIn`): the block row, no password row, no sessions.
    await sql(`INSERT INTO core.sign_in_blocks (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    await sql(`DELETE FROM core.account WHERE user_id = $1 AND provider_id = 'credential'`, [userId]);
    await sql(`DELETE FROM core.session WHERE user_id = $1`, [userId]);
    await resetRateLimits();
    const off = new Date();

    // "Forgot password": the same screen as for anyone, and no email.
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).first().fill(person.email);
    await page.getByRole('button', { name: /Send code/ }).click();
    await page.waitForURL(/reset-password/, { timeout: 60_000 });
    await page.locator('input[autocomplete="one-time-code"]').fill('123456');
    await page.locator('input[type=password]').first().fill(`Quiet-Harbor-${Date.now().toString(36)}-73!`);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible({ timeout: 30_000 });

    // "Email me a code instead": the same screen as for anyone, and no email.
    await askForCode(page, person.email);
    await expect(page.getByTestId('login-code-form')).toContainText('a code is on its way');
    await page.getByTestId('login-code').fill('123456');
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible();

    // The raw endpoints, each with the answer an address with no account gets.
    const stranger = `e2e-nobody-${Date.now().toString(36)}@kitstak-e2e.example`;
    for (const [path, body] of [
      ['/email-otp/request-password-reset', {}],
      ['/forget-password/email-otp', {}],
      ['/email-otp/send-verification-otp', { type: 'email-verification' }],
      ['/email-otp/send-verification-otp', { type: 'forget-password' }],
    ] as const) {
      await resetRateLimits();
      const blocked = await context.request.post(`${BASE_URL}/api/auth${path}`, { headers: JSON_HEADERS, data: { email: person.email, ...body } });
      const unknown = await context.request.post(`${BASE_URL}/api/auth${path}`, { headers: JSON_HEADERS, data: { email: stranger, ...body } });
      expect([blocked.status(), await blocked.text()], path).toEqual([unknown.status(), await unknown.text()]);
    }
    await resetRateLimits();
    const reset = await context.request.post(`${BASE_URL}/api/auth/email-otp/reset-password`, {
      headers: JSON_HEADERS,
      data: { email: person.email, otp: '123456', password: `Quiet-Harbor-${Date.now().toString(36)}-73!` },
    });
    expect(reset.status()).toBe(400);
    const signIn = await context.request.post(`${BASE_URL}/api/auth/sign-in/email`, { headers: JSON_HEADERS, data: { email: person.email, password: person.password } });
    expect(signIn.status()).toBe(401);

    await page.waitForTimeout(2_000);
    expect(await sql(`SELECT template FROM core.billing_emails WHERE to_email = $1 AND created_at > $2`, [person.email.toLowerCase(), off]), 'no email of any kind').toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core.account WHERE user_id = $1`, [userId]), 'no password row came back').toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core.session WHERE user_id = $1`, [userId]), 'no session').toHaveLength(0);

    // Switched on again: "Forgot password" works, like for anyone.
    await sql(`DELETE FROM core.sign_in_blocks WHERE user_id = $1`, [userId]);
    await resetRateLimits();
    const on = new Date();
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).first().fill(person.email);
    await page.getByRole('button', { name: /Send code/ }).click();
    await page.waitForURL(/reset-password/, { timeout: 60_000 });
    await page.locator('input[autocomplete="one-time-code"]').fill(await newestCode(person.email, 'reset', on));
    await page.locator('input[type=password]').first().fill(`Quiet-Harbor-${Date.now().toString(36)}-73!`);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/reset-password'), { timeout: 60_000 });
    expect((await sessionOf(context))?.user?.email).toBe(person.email);
  });
});

/** Signs up with the sign up endpoint only, in a browser context of its own. */
async function signUpByApi(browser: Browser, person: Person): Promise<BrowserContext> {
  await resetRateLimits();
  const context = await browser.newContext();
  const made = await context.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
    headers: JSON_HEADERS,
    data: { name: person.name, email: person.email, password: person.password },
  });
  expect(made.status()).toBe(200);
  return context;
}

test.describe('round 4: invites', () => {
  test('an invite email is out the moment the page says sent, with no job run', async ({ page }) => {
    test.setTimeout(300_000);
    const { orgId } = await trialAccount(page, 'invitenow', CART_CRM_2);
    const invited = newPerson('invitedfast', 'Casey Lane');
    const asked = new Date();
    await invitePerson(page, invited.email, 'member');
    await expect(page.getByText(new RegExp(`Invite sent to ${invited.email.replace(/[.+]/g, '\\$&')}`))).toBeVisible({ timeout: 30_000 });
    // No call to the one minute job anywhere in this test: the email has already left.
    const rows = await sql<{ status: string; sent: boolean; org_id: string | null }>(
      `SELECT status, sent_at IS NOT NULL AS sent, org_id FROM core.billing_emails WHERE to_email = $1 AND template = 'invitation' AND created_at > $2`,
      [invited.email.toLowerCase(), asked],
    );
    expect(rows).toEqual([{ status: 'sent', sent: true, org_id: orgId }]);
  });

  test('nobody but the invited mailbox can take an invite: an admin who makes the account is refused, the real person joins with one click', async ({ browser, page, context }) => {
    test.setTimeout(420_000);
    const { orgId, person: owner } = await trialAccount(page, 'takeover', CART_CRM_2);
    const bookkeeper = newPerson('bookkeeper', 'Riley Ortiz');
    // The owner invites a bookkeeper with the billing role.
    const invite = await context.request.post(`${BASE_URL}/api/auth/organization/invite-member`, {
      headers: JSON_HEADERS,
      data: { email: bookkeeper.email, role: 'billing', organizationId: orgId },
    });
    expect(invite.status(), `owner ${owner.email} invites`).toBe(200);
    const invitationId = ((await invite.json()) as { id: string }).id;
    const link = await inviteLinkFor(page, bookkeeper.email);
    expect(link).toContain(`/invite/${invitationId}?t=`);

    // Someone who knows the invitation id (any admin can list it) makes the account for that address.
    const thief = await signUpByApi(browser, bookkeeper);
    const raw = await thief.request.post(`${BASE_URL}/api/auth/organization/accept-invitation`, { headers: JSON_HEADERS, data: { invitationId } });
    expect(raw.status(), 'the raw endpoint refuses').toBe(403);
    expect(((await raw.json()) as { code?: string; message?: string })).toMatchObject({
      code: 'INVITE_NEEDS_PROVEN_MAILBOX',
      message: 'Open the link in your invite email to join. That shows the email is yours.',
    });
    // The Portal's own invite page, opened by id only (no proof from the email): the same sentence.
    // Review round 5: the page checks before it draws anything to press. No "Accept invite" button.
    const thiefPage = await thief.newPage();
    await thiefPage.goto(`/invite/${invitationId}`);
    // Review round 5, second pass: the screen offers a code, mailed to the invited address only. The
    // thief has the account and not the mailbox, so the code never reaches them and a guess is refused.
    await expect(thiefPage.getByTestId('invite-needs-link').getByTestId('invite-code-door')).toBeVisible({ timeout: 90_000 });
    await expect(thiefPage.getByTestId('invite-accept')).toHaveCount(0);
    await resetRateLimits();
    await thiefPage.getByTestId('invite-email-code').click();
    await expect(thiefPage.getByTestId('invite-code-form')).toBeVisible({ timeout: 30_000 });
    const mailed = await newestCode(bookkeeper.email, 'verify', new Date(Date.now() - 60_000));
    await thiefPage.getByTestId('invite-code').fill(mailed === '000000' ? '000001' : '000000');
    await thiefPage.getByTestId('invite-accept').click();
    await expect(thiefPage.locator('#invite-code-error')).toContainText('That code is not right. Check it and try again.', { timeout: 30_000 });
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [bookkeeper.email])).toEqual([{ email_verified: false }]);
    expect(await sql(`SELECT 1 FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1`, [bookkeeper.email]), 'nothing was written').toHaveLength(0);
    expect(await sql(`SELECT status FROM core.invitation WHERE id = $1`, [invitationId])).toEqual([{ status: 'pending' }]);
    await thief.close();
    // Take that account away again, so the real person starts clean.
    await sql(`DELETE FROM core."user" WHERE email = $1`, [bookkeeper.email]);

    // A person with no account and no emailed link: refused before any account is made.
    const noLink = await browser.newContext();
    const noLinkPage = await noLink.newPage();
    await resetRateLimits();
    // Review round 5: no form is drawn, so nobody fills in a name and a password for nothing.
    await noLinkPage.goto(`/invite/${invitationId}`);
    await expect(noLinkPage.getByTestId('invite-needs-link').getByTestId('invite-code-door')).toBeVisible({ timeout: 90_000 });
    await expect(noLinkPage.getByTestId('invite-name')).toHaveCount(0);
    await expect(noLinkPage.getByTestId('invite-password')).toHaveCount(0);
    await expect(noLinkPage.getByTestId('invite-accept')).toHaveCount(0);
    // The code goes to the invited mailbox. A person who does not have it gets nowhere.
    await noLinkPage.getByTestId('invite-email-code').click();
    await expect(noLinkPage.getByTestId('invite-code-form')).toBeVisible({ timeout: 30_000 });
    const sent = await newestCode(bookkeeper.email, 'sign_in', new Date(Date.now() - 60_000));
    await noLinkPage.getByTestId('invite-name').fill('Not Riley');
    await noLinkPage.getByTestId('invite-code').fill(sent === '000000' ? '000001' : '000000');
    await noLinkPage.getByTestId('invite-accept').click();
    await expect(noLinkPage.locator('#invite-code-error')).toContainText('That code is not right. Check it and try again.', { timeout: 30_000 });
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [bookkeeper.email]), 'no account was made').toHaveLength(0);
    await noLink.close();

    // The real person, from the link in the email: in with one click, no code, email confirmed.
    const real = await browser.newContext();
    const realPage = await real.newPage();
    const joining = new Date();
    await joinFromInvite(realPage, link, bookkeeper);
    expect(await sql(`SELECT m.role, u.email_verified FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1 AND m.organization_id = $2`, [bookkeeper.email, orgId])).toEqual([
      { role: 'billing', email_verified: true },
    ]);
    // The real person is never asked for a code. (The account the other person made did mail one.)
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND template = 'verify_email' AND created_at > $2`, [bookkeeper.email.toLowerCase(), joining])).toHaveLength(0);
    await real.close();
  });
});

test.describe('round 4: one front door', () => {
  test('sign up with a code, sign out, open a CRM link: the Portal signs the person in with a code and they land on that CRM page', async ({ page, context }) => {
    test.setTimeout(480_000);
    test.skip(!(await appIsUp(page, APP_URLS.crm)), `the CRM is not running at ${APP_URLS.crm}`);
    await resetRateLimits();
    const person = newPerson('frontdoor', 'Dana Whitlock');
    // Sign up with "Email me a code instead": no password exists.
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
    await page.getByTestId('signup-name').fill(person.name);
    await page.getByTestId('signup-email').fill(person.email);
    await page.getByTestId('signup-company').fill(person.company);
    await page.getByTestId('signup-email-code').click();
    await page.getByTestId('signup-submit').click();
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 90_000 });
    await pickPlan(page, CART_CRM_2);
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email' || url.pathname === '/welcome', { timeout: 90_000 });
    const orgId = await orgIdOf(person.email);
    const slug = (await sql<{ slug: string }>(`SELECT slug FROM core.organization WHERE id = $1`, [orgId]))[0]?.slug ?? '';
    await context.clearCookies();

    // A CRM link, signed out: the one sign in page, with the full CRM address to come back to.
    const deepLink = `${APP_URLS.crm}/${slug}?from=email`;
    await page.goto(deepLink);
    await page.waitForURL((url) => url.origin === BASE_URL && url.pathname === '/login', { timeout: 90_000 });
    expect(new URL(page.url()).searchParams.get('next')).toBe(deepLink);
    // It has the code door. The password field is not the only way in.
    await expect(page.getByTestId('login-email-code')).toBeVisible();

    await resetRateLimits();
    const asked = new Date();
    await page.getByLabel('Work email').fill(person.email);
    await page.getByTestId('login-email-code').click();
    await expect(page.getByTestId('login-code-form')).toBeVisible();
    await page.getByTestId('login-code').fill(await newestCode(person.email, 'sign_in', asked));
    // Back in the CRM, on the page that was asked for, signed in.
    await page.waitForURL((url) => url.origin === APP_URLS.crm && url.pathname.startsWith(`/${slug}`), { timeout: 120_000 });
    expect(new URL(page.url()).searchParams.get('from')).toBe('email');
    await expect(page.locator('body')).not.toContainText('Enter your password.');

    // Every other app sends a signed out person to the same page, and "Forgot password" to the Portal's.
    await context.clearCookies();
    for (const [name, url] of Object.entries(APP_URLS)) {
      if (!(await appIsUp(page, url))) continue;
      const login = await context.request.get(`${url}/login?next=${encodeURIComponent('/some/page?x=1')}`, { maxRedirects: 0 });
      expect([name, login.status()]).toEqual([name, 307]);
      const to = new URL(login.headers().location ?? '');
      expect([name, to.origin, to.pathname]).toEqual([name, BASE_URL, '/login']);
      expect(to.searchParams.get('next'), name).toBe(`${url}/some/page?x=1`);
      const forgot = await context.request.get(`${url}/forgot-password`, { maxRedirects: 0 });
      expect([name, forgot.headers().location]).toEqual([name, `${BASE_URL}/forgot-password`]);
      // The app's own form is still there for tests and for the day the Portal is down.
      const local = await context.request.get(`${url}/login?local=1`, { maxRedirects: 0 });
      expect([name, local.status()]).toEqual([name, 200]);
    }
  });

  test('the Portal only goes on to a trusted KitStak address, and never bounces a person between two apps', async ({ page, context }) => {
    test.setTimeout(300_000);
    const { person } = await trialAccount(page, 'nextsafe', CART_PULSE);
    // Signed in, with an outside address in `next`: dropped, the person stays in the Portal.
    await page.goto(`/login?next=${encodeURIComponent('https://evil.example/steal')}`);
    await page.waitForURL((url) => url.origin === BASE_URL && !url.pathname.startsWith('/login'), { timeout: 60_000 });
    // Signed in, with an app address: through that app's own door, marked as coming from the Portal.
    const viaPortal = await context.request.get(`${BASE_URL}/login?next=${encodeURIComponent(`${APP_URLS.crm}/some/page?x=1`)}`, { maxRedirects: 0 });
    expect(viaPortal.status()).toBe(307);
    const entry = new URL(viaPortal.headers().location ?? '');
    expect([entry.origin, entry.pathname, entry.searchParams.get('from'), entry.searchParams.get('next')]).toEqual([APP_URLS.crm, '/login', 'portal', '/some/page?x=1']);
    // An app that is told "the Portal sent you" and sees no session shows its own form. It does not send the person back.
    if (await appIsUp(page, APP_URLS.crm)) {
      const anonymous = await page.context().browser()?.newContext();
      if (anonymous) {
        const stop = await anonymous.request.get(entry.toString(), { maxRedirects: 0 });
        expect(stop.status(), 'no redirect back to the Portal').toBe(200);
        await anonymous.close();
      }
    }
    // Signed out, an outside address is dropped before the form is shown.
    await context.clearCookies();
    await page.goto(`/login?next=${encodeURIComponent('https://evil.example/steal')}`);
    await signInWithPassword(page, person);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
    expect(new URL(page.url()).origin).toBe(BASE_URL);
  });
});
