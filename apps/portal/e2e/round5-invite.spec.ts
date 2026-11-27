import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { APP_URLS, BASE_URL, CART_CRM_2, appIsUp, holdDevReloads, inviteLinkFor, invitePerson, newPerson, resetRateLimits, sql, trialAccount } from './support';

/**
 * Review round 5, invites:
 *  - a teammate joins from the emailed link with a name and NO password, and signs in with a code
 *    the next time (the owner can start with no password, so the people they invite can too),
 *  - an invite opened without the emailed proof (a copied link, a link from the CRM) is not a dead
 *    end: "Email me a code" mails a code to the invited address, and the code proves the mailbox.
 */

const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL };

async function newestCode(email: string, kind: 'sign_in' | 'verify', after: Date): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const rows = await sql<{ body_text: string | null }>(
          `SELECT body_text FROM core.billing_emails
            WHERE to_email = $1 AND template = 'verify_email' AND created_at > $2 AND coalesce(payload->>'purpose', '') = $3
            ORDER BY created_at DESC LIMIT 1`,
          [email.toLowerCase(), after, kind === 'sign_in' ? 'sign_in' : ''],
        );
        code = /^\s*(\d{6})\s*$/m.exec(rows[0]?.body_text ?? '')?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a ${kind} code email for ${email}` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await holdDevReloads(context);
  return context;
}

async function passwordRows(email: string): Promise<number> {
  const rows = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.account a JOIN core."user" u ON u.id = a.user_id WHERE u.email = $1 AND a.password IS NOT NULL`,
    [email.toLowerCase()],
  );
  return rows[0]?.n ?? 0;
}

async function memberOf(email: string, orgId: string): Promise<{ role: string; email_verified: boolean }[]> {
  return sql<{ role: string; email_verified: boolean }>(
    `SELECT m.role, u.email_verified FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1 AND m.organization_id = $2`,
    [email.toLowerCase(), orgId],
  );
}

async function sessionEmail(context: BrowserContext): Promise<string | null> {
  const session = (await (await context.request.get(`${BASE_URL}/api/auth/get-session`)).json()) as { user?: { email?: string } } | null;
  return session?.user?.email ?? null;
}

async function onLauncher(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.startsWith('/invite') && !url.pathname.startsWith('/login'), { timeout: 90_000 });
  await expect(page.locator('main').first()).toBeVisible({ timeout: 90_000 });
}

test.describe('round 5: joining a team needs no password', () => {
  test('from the emailed link: a name, "Join", the launcher. Then sign out and sign in with a code', async ({ browser, page }) => {
    test.setTimeout(420_000);
    const { orgId } = await trialAccount(page, 'r5inviter', CART_CRM_2);
    const mate = newPerson('r5mate', 'Sam Rivera');
    await invitePerson(page, mate.email, 'member');
    const link = await inviteLinkFor(page, mate.email);

    const context = await freshContext(browser);
    const matePage = await context.newPage();
    await resetRateLimits();
    const joining = new Date();
    await matePage.goto(link);
    await expect(matePage.getByTestId('invite-org-name')).toBeVisible({ timeout: 90_000 });
    // One field. No password field, and one quiet row that offers one.
    await expect(matePage.getByTestId('invite-password')).toHaveCount(0);
    await expect(matePage.getByTestId('invite-no-password')).toContainText('No password needed.');
    await expect(matePage.getByTestId('invite-set-password')).toBeVisible();
    await matePage.getByTestId('invite-name').fill(mate.name);
    await matePage.getByTestId('invite-accept').click();
    await onLauncher(matePage);

    expect(await memberOf(mate.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    expect(await passwordRows(mate.email), 'no password row at all').toBe(0);
    expect(await sql(`SELECT name FROM core."user" WHERE email = $1`, [mate.email])).toEqual([{ name: mate.name }]);
    // The emailed link was the proof: no code email went out.
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND template = 'verify_email' AND created_at > $2`, [mate.email.toLowerCase(), joining])).toHaveLength(0);
    expect(await sessionEmail(context)).toBe(mate.email);

    // Sign out, then back in with an emailed code.
    await context.request.post(`${BASE_URL}/api/auth/sign-out`, { headers: JSON_HEADERS, data: {} });
    expect(await sessionEmail(context)).toBeNull();
    await resetRateLimits();
    const asked = new Date();
    await matePage.goto('/login');
    await matePage.getByLabel('Work email').fill(mate.email);
    await matePage.getByTestId('login-email-code').click();
    await expect(matePage.getByTestId('login-code-form')).toBeVisible();
    await matePage.getByTestId('login-code').fill(await newestCode(mate.email, 'sign_in', asked));
    await onLauncher(matePage);
    expect(await sessionEmail(context)).toBe(mate.email);
    // They were never told a password was removed: there never was one.
    expect(new URL(matePage.url()).search).not.toContain('password-removed');
    await context.close();
  });

  test('"Set a password" on the invite page still makes an account with a password', async ({ browser, page }) => {
    test.setTimeout(300_000);
    const { orgId } = await trialAccount(page, 'r5inviterpw', CART_CRM_2);
    const mate = newPerson('r5matepw', 'Jo Park');
    await invitePerson(page, mate.email, 'member');
    const link = await inviteLinkFor(page, mate.email);
    const context = await freshContext(browser);
    const matePage = await context.newPage();
    await resetRateLimits();
    await matePage.goto(link);
    await matePage.getByTestId('invite-name').fill(mate.name);
    await matePage.getByTestId('invite-set-password').click();
    // A weak password is refused like on signup.
    await matePage.getByTestId('invite-password').fill('short');
    await matePage.getByTestId('invite-accept').click();
    await expect(matePage.getByTestId('invite-accept')).toBeVisible();
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [mate.email])).toHaveLength(0);
    await matePage.getByTestId('invite-password').fill(mate.password);
    await matePage.getByTestId('invite-accept').click();
    await onLauncher(matePage);
    expect(await memberOf(mate.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    expect(await passwordRows(mate.email)).toBe(1);
    await context.close();
  });
});

test.describe('round 5: an invite link without the emailed proof is not a dead end', () => {
  test('new to KitStak, a copied link: "Email me a code", a name and the code, and they are on the team', async ({ browser, page }) => {
    test.setTimeout(420_000);
    const { orgId } = await trialAccount(page, 'r5copy', CART_CRM_2);
    const mate = newPerson('r5bare', 'Robin Vale');
    await invitePerson(page, mate.email, 'member');
    const bare = (await inviteLinkFor(page, mate.email)).split('?')[0] as string;

    const context = await freshContext(browser);
    const matePage = await context.newPage();
    await resetRateLimits();
    await matePage.goto(bare);
    await expect(matePage.getByTestId('invite-code-door')).toBeVisible({ timeout: 90_000 });
    await expect(matePage.getByTestId('invite-code-door')).toContainText('We email a 6 digit code to that address.');
    const asked = new Date();
    await matePage.getByTestId('invite-email-code').click();
    await expect(matePage.getByTestId('invite-code-form')).toBeVisible({ timeout: 30_000 });
    await expect(matePage.getByTestId('invite-code-sent')).toContainText('We sent a 6 digit code to');
    const code = await newestCode(mate.email, 'sign_in', asked);
    // Nothing exists yet.
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [mate.email])).toHaveLength(0);

    // A wrong code first: refused in plain words, nothing made.
    await matePage.getByTestId('invite-name').fill(mate.name);
    await matePage.getByTestId('invite-code').fill(code === '000000' ? '000001' : '000000');
    await matePage.getByTestId('invite-accept').click();
    await expect(matePage.locator('#invite-code-error')).toContainText('That code is not right. Check it and try again.', { timeout: 30_000 });
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [mate.email])).toHaveLength(0);

    // The right code: the account is made with no password, the email is proven, they are in.
    await matePage.getByTestId('invite-code').fill(code);
    await matePage.getByTestId('invite-accept').click();
    await onLauncher(matePage);
    expect(await memberOf(mate.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    expect(await passwordRows(mate.email)).toBe(0);
    expect(await sessionEmail(context)).toBe(mate.email);
    expect(await sql(`SELECT status FROM core.invitation WHERE email = $1`, [mate.email.toLowerCase()])).toEqual([{ status: 'accepted' }]);
    // The code is used up: it does not sign anyone in again.
    expect(await sql(`SELECT 1 FROM core.verification WHERE identifier = $1`, [`sign-in-otp-${mate.email.toLowerCase()}`])).toHaveLength(0);
    await context.close();
  });

  test('an account made elsewhere with an email nobody verified: the code proves it, the password stays, the invite is accepted', async ({ browser, page }) => {
    test.setTimeout(420_000);
    const { orgId } = await trialAccount(page, 'r5crm', CART_CRM_2);
    const mate = newPerson('r5unver', 'Kim Osei');
    await invitePerson(page, mate.email, 'member');
    const bare = (await inviteLinkFor(page, mate.email)).split('?')[0] as string;

    // The person made their own account with a password (as the CRM signup page does). Never verified.
    const context = await freshContext(browser);
    await resetRateLimits();
    const made = await context.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
      headers: JSON_HEADERS,
      data: { name: mate.name, email: mate.email, password: mate.password },
    });
    expect(made.status()).toBe(200);
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [mate.email])).toEqual([{ email_verified: false }]);

    const matePage = await context.newPage();
    await resetRateLimits();
    await matePage.goto(bare);
    await expect(matePage.getByTestId('invite-code-door')).toBeVisible({ timeout: 90_000 });
    const asked = new Date();
    await matePage.getByTestId('invite-email-code').click();
    await expect(matePage.getByTestId('invite-code-form')).toBeVisible({ timeout: 30_000 });
    // Signed in already: no name is asked for.
    await expect(matePage.getByTestId('invite-name')).toHaveCount(0);
    await matePage.getByTestId('invite-code').fill(await newestCode(mate.email, 'verify', asked));
    await matePage.getByTestId('invite-accept').click();
    await onLauncher(matePage);
    expect(await memberOf(mate.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    // Their own password is still theirs.
    expect(await passwordRows(mate.email)).toBe(1);
    await context.close();
  });
});

test.describe('round 5: an invite from the CRM goes through the one shared door', () => {
  test('the CRM "Invite members" API mails the invite with its proof, the person joins from the email, and a copied CRM link leads to the code door', async ({ browser, page, context }) => {
    test.setTimeout(480_000);
    test.skip(!(await appIsUp(page, APP_URLS.crm)), `the CRM is not running at ${APP_URLS.crm}`);
    const { orgId } = await trialAccount(page, 'r5crmdoor', CART_CRM_2);
    const hire = newPerson('r5hire', 'Noor Haddad');
    const second = newPerson('r5hire2', 'Lee Tran');
    const crmHeaders = { 'content-type': 'application/json', origin: APP_URLS.crm, 'x-org-id': orgId };

    // The owner invites from the CRM. Before the fix this wrote a row and sent nothing.
    const asked = new Date();
    const made = await context.request.post(`${APP_URLS.crm}/api/v1/invitations`, { headers: crmHeaders, data: { email: hire.email, role: 'member' } });
    expect(made.status(), await made.text()).toBe(201);
    const invitationId = ((await made.json()) as { data: { id: string } }).data.id;
    // The shared rules ran: the day's count of invites went up.
    expect(await sql(`SELECT count FROM core.rate_limit WHERE key = $1`, [`billing:invite-day:${orgId}`])).toEqual([{ count: 1 }]);
    // The invite email is out, and its link carries the proof of the mailbox.
    const link = await inviteLinkFor(page, hire.email);
    expect(link).toContain(`${BASE_URL}/invite/${invitationId}?t=`);
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND template = 'invitation' AND created_at > $2 AND org_id = $3`, [hire.email.toLowerCase(), asked, orgId])).toHaveLength(1);

    // The new hire joins from the email: a name, one click, no password and no code.
    const hireContext = await freshContext(browser);
    const hirePage = await hireContext.newPage();
    await resetRateLimits();
    await hirePage.goto(link);
    await expect(hirePage.getByTestId('invite-org-name')).toBeVisible({ timeout: 90_000 });
    await hirePage.getByTestId('invite-name').fill(hire.name);
    await hirePage.getByTestId('invite-accept').click();
    await onLauncher(hirePage);
    expect(await memberOf(hire.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    await hireContext.close();

    // A second person gets only the copied link of the CRM's own page, with no proof. Signed out,
    // it leads to the Portal invite page and its code door, not to a form that will be refused.
    const madeSecond = await context.request.post(`${APP_URLS.crm}/api/v1/invitations`, { headers: crmHeaders, data: { email: second.email, role: 'member' } });
    expect(madeSecond.status()).toBe(201);
    const secondId = ((await madeSecond.json()) as { data: { id: string } }).data.id;
    const secondContext = await freshContext(browser);
    const secondPage = await secondContext.newPage();
    await resetRateLimits();
    await secondPage.goto(`${APP_URLS.crm}/welcome/invite/${secondId}`);
    await secondPage.waitForURL((url) => url.origin === BASE_URL && url.pathname === `/invite/${secondId}`, { timeout: 90_000 });
    await expect(secondPage.getByTestId('invite-code-door')).toBeVisible({ timeout: 90_000 });
    const codeAsked = new Date();
    await secondPage.getByTestId('invite-email-code').click();
    await expect(secondPage.getByTestId('invite-code-form')).toBeVisible({ timeout: 30_000 });
    await secondPage.getByTestId('invite-name').fill(second.name);
    await secondPage.getByTestId('invite-code').fill(await newestCode(second.email, 'sign_in', codeAsked));
    await secondPage.getByTestId('invite-accept').click();
    await onLauncher(secondPage);
    expect(await memberOf(second.email, orgId)).toEqual([{ role: 'member', email_verified: true }]);
    await secondContext.close();
  });

  test('the CRM door holds the shared rule: an owner whose own email is not verified can not invite, and nothing is mailed', async ({ page, context }) => {
    test.setTimeout(300_000);
    test.skip(!(await appIsUp(page, APP_URLS.crm)), `the CRM is not running at ${APP_URLS.crm}`);
    const { orgId } = await trialAccount(page, 'r5crmunv', CART_CRM_2, { verify: false });
    const hire = newPerson('r5nohire', 'Pat Quinn');
    const refused = await context.request.post(`${APP_URLS.crm}/api/v1/invitations`, {
      headers: { 'content-type': 'application/json', origin: APP_URLS.crm, 'x-org-id': orgId },
      data: { email: hire.email, role: 'member' },
    });
    expect(refused.status()).toBe(403);
    const body = (await refused.json()) as { error?: { message?: string; details?: { code?: string } } };
    expect(body.error?.details?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(body.error?.message).toContain('Verify your email first.');
    expect(await sql(`SELECT 1 FROM core.invitation WHERE email = $1`, [hire.email.toLowerCase()])).toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1`, [hire.email.toLowerCase()])).toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core.rate_limit WHERE key = $1`, [`billing:invite-day:${orgId}`])).toHaveLength(0);
  });
});
