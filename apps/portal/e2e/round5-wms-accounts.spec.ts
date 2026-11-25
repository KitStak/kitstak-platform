import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { APP_URLS, BASE_URL, CART_CRM_2, CART_CRM_WMS, appIsUp, holdDevReloads, newPerson, resetRateLimits, sql, trialAccount } from './support';

/**
 * Review round 5: a warehouse admin could make a VERIFIED KitStak account for any free address
 * (WMS "Add user", with a password the admin typed). With it they could take an owner's billing
 * invite, and keep a password on an account a stranger later signed in to with an emailed code.
 *
 * Now such an account is born unverified. It can not take an invite, the first emailed code removes
 * the admin's password and says so, and no admin can set a password on it after that.
 * Needs the WMS dev server. Skipped by name when it is not running.
 */

const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL };
const WMS_HEADERS = { 'content-type': 'application/json', origin: APP_URLS.wms };

interface Rows<T> {
  data?: T[] | { rows?: T[] };
  rows?: T[];
}

function rowsOf<T>(body: Rows<T>): T[] {
  if (Array.isArray(body.data)) return body.data;
  return body.data?.rows ?? body.rows ?? [];
}

/** Sets up the organization's warehouse and adds a WMS user with this address and a typed password. */
async function wmsAddUser(api: APIRequestContext, orgId: string, input: { email: string; password: string; first: string; last: string }): Promise<{ status: number; id: string | null }> {
  const warehouse = await api.post(`${APP_URLS.wms}/api/tenancy/warehouse`, {
    headers: WMS_HEADERS,
    data: { orgId, warehouse: { name: 'Side Dock', code: 'SD1', contactPhone: '' } },
    timeout: 120_000,
  });
  expect([200, 201, 409], `warehouse setup answered ${warehouse.status()} ${await warehouse.text()}`).toContain(warehouse.status());
  const roles = rowsOf<{ id: string; key?: string; name?: string }>((await (await api.get(`${APP_URLS.wms}/api/roles?pageSize=50`)).json()) as Rows<{ id: string; key?: string; name?: string }>);
  const houses = rowsOf<{ id: string }>((await (await api.get(`${APP_URLS.wms}/api/warehouses?pageSize=50`)).json()) as Rows<{ id: string }>);
  const role = roles.find((entry) => !/admin/i.test(`${entry.key ?? ''}${entry.name ?? ''}`)) ?? roles[0];
  expect(role, 'a WMS role to give').toBeTruthy();
  expect(houses[0], 'a warehouse to give').toBeTruthy();
  const made = await api.post(`${APP_URLS.wms}/api/users`, {
    headers: WMS_HEADERS,
    data: {
      firstName: input.first,
      lastName: input.last,
      email: input.email,
      phone: '',
      userType: 'Operation',
      password: input.password,
      confirmPassword: input.password,
      sendWelcomeEmail: false,
      isActive: true,
      roleIds: [role?.id],
      warehouseIds: [houses[0]?.id],
      allClients: true,
      clientIds: [],
    },
  });
  const body = (await made.json().catch(() => ({}))) as { data?: { id?: string } };
  return { status: made.status(), id: body.data?.id ?? null };
}

/** The warehouse a test made is its own database schema. Take it away again. */
async function dropWarehouse(orgId: string): Promise<void> {
  const schema = `wms_${orgId.replace(/-/g, '')}`;
  if (!/^wms_[0-9a-f]{32}$/.test(schema)) return;
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await sql(`DELETE FROM core.wms_tenants WHERE org_id = $1`, [orgId]).catch(() => undefined);
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await holdDevReloads(context);
  return context;
}

async function newestSignInCode(email: string, after: Date): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const rows = await sql<{ body_text: string | null }>(
          `SELECT body_text FROM core.billing_emails WHERE to_email = $1 AND template = 'verify_email' AND created_at > $2 AND coalesce(payload->>'purpose', '') = 'sign_in' ORDER BY created_at DESC LIMIT 1`,
          [email.toLowerCase(), after],
        );
        code = /^\s*(\d{6})\s*$/m.exec(rows[0]?.body_text ?? '')?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a sign in code email for ${email}` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

test.describe('round 5: an account made in the WMS is nobody\'s proof of a mailbox', () => {
  test('a warehouse admin makes the account for an invited address: it is unverified and can not take the owner\'s billing invite', async ({ browser, page, context }) => {
    test.setTimeout(480_000);
    test.skip(!(await appIsUp(page, APP_URLS.wms)), `the WMS is not running at ${APP_URLS.wms}`);
    // The victim organization: an owner invites a bookkeeper with the billing role.
    const { orgId: victimOrg } = await trialAccount(page, 'r5victim', CART_CRM_2);
    const bookkeeper = newPerson('r5books', 'Riley Ortiz');
    const invite = await context.request.post(`${BASE_URL}/api/auth/organization/invite-member`, {
      headers: JSON_HEADERS,
      data: { email: bookkeeper.email, role: 'billing', organizationId: victimOrg },
    });
    expect(invite.status()).toBe(200);
    const invitationId = ((await invite.json()) as { id: string }).id;

    // The attacker: anyone can start a free trial with the WMS and is then a warehouse admin.
    const attacker = await freshContext(browser);
    const attackerPage = await attacker.newPage();
    const { orgId: attackerOrg } = await trialAccount(attackerPage, 'r5wmsadmin', CART_CRM_WMS);
    try {
      const added = await wmsAddUser(attacker.request, attackerOrg, { email: bookkeeper.email, password: bookkeeper.password, first: 'Not', last: 'Bookkeeper' });
      expect(added.status, 'the WMS still adds the user').toBe(201);
      // Born unverified, whatever the admin typed.
      expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [bookkeeper.email])).toEqual([{ email_verified: false }]);

      // The admin signs in as that account with the password they typed, and tries to take the invite.
      await resetRateLimits();
      const fake = await playwrightRequest.newContext();
      const signIn = await fake.post(`${BASE_URL}/api/auth/sign-in/email`, { headers: JSON_HEADERS, data: { email: bookkeeper.email, password: bookkeeper.password } });
      expect(signIn.status()).toBe(200);
      const accept = await fake.post(`${BASE_URL}/api/auth/organization/accept-invitation`, { headers: JSON_HEADERS, data: { invitationId } });
      expect(accept.status()).toBe(403);
      expect(((await accept.json()) as { code?: string }).code).toBe('INVITE_NEEDS_PROVEN_MAILBOX');
      await fake.dispose();
      expect(await sql(`SELECT 1 FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1 AND m.organization_id = $2`, [bookkeeper.email, victimOrg])).toHaveLength(0);
      expect(await sql(`SELECT status FROM core.invitation WHERE id = $1`, [invitationId])).toEqual([{ status: 'pending' }]);
    } finally {
      await dropWarehouse(attackerOrg);
      await attacker.close();
    }
  });

  test('the owner of the mailbox signs in with a code: the admin\'s password is removed, the person is told, and the admin can not set a new one', async ({ browser, page }) => {
    test.setTimeout(480_000);
    test.skip(!(await appIsUp(page, APP_URLS.wms)), `the WMS is not running at ${APP_URLS.wms}`);
    const { orgId: attackerOrg } = await trialAccount(page, 'r5wmsadmin2', CART_CRM_WMS);
    const victim = newPerson('r5stranger', 'Vic Tim');
    try {
      const added = await wmsAddUser(page.request, attackerOrg, { email: victim.email, password: victim.password, first: 'Vic', last: 'Tim' });
      expect(added.status).toBe(201);
      expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [victim.email])).toEqual([{ email_verified: false }]);
      // While nobody has proven the mailbox the admin may still reset the password (a new hire who lost it).
      const early = await page.request.post(`${APP_URLS.wms}/api/users/${added.id}/reset-password`, { headers: WMS_HEADERS, data: {} });
      expect(early.status()).toBe(200);
      // Back to the password the admin typed, for the rest of the story.
      const { hashPassword } = await import('better-auth/crypto');
      await sql(`UPDATE core.account SET password = $1 WHERE user_id = $2 AND provider_id = 'credential'`, [await hashPassword(victim.password), added.id]);

      // The real owner of the mailbox comes to KitStak and signs in with an emailed code.
      const own = await freshContext(browser);
      const ownPage = await own.newPage();
      await resetRateLimits();
      const asked = new Date();
      await ownPage.goto('/login');
      await ownPage.getByLabel('Work email').fill(victim.email);
      await ownPage.getByTestId('login-email-code').click();
      await expect(ownPage.getByTestId('login-code-form')).toBeVisible();
      await ownPage.getByTestId('login-code').fill(await newestSignInCode(victim.email, asked));
      // They are told in one sentence that the old password is gone.
      await ownPage.waitForURL((url) => url.pathname === '/settings/account' && url.searchParams.get('notice') === 'password-removed', { timeout: 90_000 });
      await expect(ownPage.locator('main')).toContainText('Your old password no longer works');
      expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [victim.email])).toEqual([{ email_verified: true }]);
      expect(await sql(`SELECT 1 FROM core.account a JOIN core."user" u ON u.id = a.user_id WHERE u.email = $1 AND a.password IS NOT NULL`, [victim.email])).toHaveLength(0);

      // The password the admin typed no longer signs anyone in.
      await resetRateLimits();
      const attacker = await playwrightRequest.newContext();
      const again = await attacker.post(`${BASE_URL}/api/auth/sign-in/email`, { headers: JSON_HEADERS, data: { email: victim.email, password: victim.password } });
      expect(again.status()).toBe(401);
      await attacker.dispose();

      // And the admin can not put a new password on it: the mailbox is proven, the account is its owner's.
      const reset = await page.request.post(`${APP_URLS.wms}/api/users/${added.id}/reset-password`, { headers: WMS_HEADERS, data: {} });
      expect(reset.status()).toBe(409);
      expect(((await reset.json()) as { error?: string }).error).toContain('only they can change their password');
      expect(await sql(`SELECT 1 FROM core.account WHERE user_id = $1 AND password IS NOT NULL`, [added.id])).toHaveLength(0);
      await own.close();
    } finally {
      await dropWarehouse(attackerOrg);
    }
  });
});
