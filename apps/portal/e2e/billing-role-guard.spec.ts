import { expect, test } from '@playwright/test';
import { APP_URLS, BASE_URL, CART_CRM_2, appIsUp, inviteLinkFor, invitePerson, joinFromInvite, newPerson, sql, trialAccount, userIdOf } from './support';

/**
 * Review round 3, security: only an owner can add or remove a billing manager, at the real
 * endpoints of the shared sign in API. An admin calls them directly, the way an attacker would, not
 * through any screen. The same call is made at the CRM's door when the CRM is running.
 */
test.describe('an admin cannot make anyone a billing manager through the sign in API', () => {
  test('update-member-role and invite-member answer 403 with one plain sentence, and nothing is written', async ({ browser, page }) => {
    test.setTimeout(300_000);
    const { orgId } = await trialAccount(page, 'guardowner', CART_CRM_2);
    const admin = newPerson('guardadmin', 'Daniel Admin');
    await invitePerson(page, admin.email, 'admin');
    const link = await inviteLinkFor(page, admin.email);
    const context = await browser.newContext();
    const adminPage = await context.newPage();
    await joinFromInvite(adminPage, link, admin);
    const adminId = await userIdOf(admin.email);
    const [membership] = await sql<{ id: string; role: string }>(`SELECT id, role FROM core.member WHERE organization_id = $1 AND user_id = $2`, [orgId, adminId]);
    expect(membership?.role).toBe('admin');

    const doors = [BASE_URL];
    if (await appIsUp(adminPage, `${APP_URLS.crm}/login`)) doors.push(APP_URLS.crm);
    else test.info().annotations.push({ type: 'skipped part', description: 'The CRM is not running, so only the Portal door was called.' });

    const outside = `e2e-outside-${Date.now().toString(36)}@kitstak-e2e.example`;
    for (const door of doors) {
      const headers = { 'content-type': 'application/json', origin: door };
      // 1. Make myself a billing manager.
      const self = await adminPage.request.post(`${door}/api/auth/organization/update-member-role`, {
        headers,
        data: { memberId: membership!.id, role: ['admin', 'billing'], organizationId: orgId },
      });
      expect(self.status(), `${door} update-member-role`).toBe(403);
      expect(await self.json()).toMatchObject({ code: 'BILLING_ROLE_OWNER_ONLY', message: 'Only an owner can add or remove a billing manager.' });
      // 2. Invite an outside address as a billing manager.
      const invite = await adminPage.request.post(`${door}/api/auth/organization/invite-member`, {
        headers,
        data: { email: outside, role: 'billing', organizationId: orgId },
      });
      expect(invite.status(), `${door} invite-member`).toBe(403);
      expect(await invite.json()).toMatchObject({ code: 'BILLING_ROLE_OWNER_ONLY' });
    }

    // Nothing was written, and the admin is not on the list of people who can manage billing.
    expect(await sql(`SELECT role FROM core.member WHERE id = $1`, [membership!.id])).toEqual([{ role: 'admin' }]);
    expect(await sql(`SELECT 1 FROM core.invitation WHERE organization_id = $1 AND email = $2`, [orgId, outside])).toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1`, [outside])).toHaveLength(0);
    await adminPage.goto('/billing');
    await expect(adminPage.getByText('Only an owner or a billing manager can pay or change a paid plan.')).toBeVisible({ timeout: 90_000 });

    // The owner can still do it, at the same endpoint.
    const owner = await page.request.post(`${BASE_URL}/api/auth/organization/update-member-role`, {
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      data: { memberId: membership!.id, role: ['admin', 'billing'], organizationId: orgId },
    });
    expect(owner.status()).toBe(200);
    expect(await sql(`SELECT role FROM core.member WHERE id = $1`, [membership!.id])).toEqual([{ role: 'admin,billing' }]);
    await context.close();
  });
});
