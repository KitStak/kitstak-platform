import { expect, test } from '@playwright/test';
import {
  CART_PULSE,
  ensureVerified,
  expectPhase,
  inviteLinkFor,
  invitePerson,
  invoicesOf,
  joinFromInvite,
  newPerson,
  openBilling,
  paidAccount,
  sql,
  userIdOf,
} from './support';

test.describe('who can do what in billing', () => {
  test('a member sees one small card; a billing manager can pay, change and download; an admin can read', async ({ browser, page }) => {
    test.setTimeout(300_000);
    const { person: owner, orgId } = await paidAccount(page, 'owner', CART_PULSE);
    const member = newPerson('member', 'Sam Rivera');
    const admin = newPerson('admin', 'Dana Ortiz');

    // The owner invites two people. Each invite sends an email with one button.
    await invitePerson(page, member.email, 'member');
    await expect(page.getByText(/Invite sent|invited/i).first()).toBeVisible({ timeout: 30_000 });
    const memberLink = await inviteLinkFor(page, member.email);
    await invitePerson(page, admin.email, 'admin');
    const adminLink = await inviteLinkFor(page, admin.email);
    const inviteMail = await sql<{ subject: string }>(
      `SELECT subject FROM core.billing_emails WHERE to_email = $1 AND template = 'invitation'`,
      [member.email],
    );
    expect(inviteMail[0]?.subject).toBe(`${owner.name} invited you to ${owner.company} on KitStak`);

    /* ----- a plain member ----- */
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await joinFromInvite(memberPage, memberLink, member);
    await memberPage.goto('/billing');
    const card = memberPage.getByTestId('billing-member-card');
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card).toContainText(`Ask ${owner.name} to manage billing.`);
    // No amounts, no invoices, no buttons.
    await expect(memberPage.getByTestId('billing-home')).toHaveCount(0);
    expect(await memberPage.locator('main').innerText()).not.toMatch(/\$\d/);
    await expect(memberPage.getByTestId('billing-change-plan')).toHaveCount(0);
    // The other billing pages send a member back to that card, and the files answer 404.
    for (const path of ['/billing/activity', '/billing/invoices', '/billing/plan', '/billing/cancel']) {
      await memberPage.goto(path);
      await expect(memberPage.getByTestId('billing-member-card'), path).toBeVisible({ timeout: 90_000 });
    }
    expect((await memberPage.request.get('/billing/activity/export')).status()).toBe(404);
    const invoice = (await invoicesOf(orgId))[0]!;
    expect((await memberPage.request.get(`/billing/invoices/${invoice.id}/pdf`)).status()).toBe(404);

    /* ----- an admin can read billing and cannot change a paid plan ----- */
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await joinFromInvite(adminPage, adminLink, admin);
    await adminPage.goto('/billing');
    await expect(adminPage.getByTestId('billing-home')).toBeVisible({ timeout: 90_000 });
    await expect(adminPage.getByTestId('billing-cost')).toContainText('per month');
    await expect(adminPage.getByTestId('billing-change-plan')).toHaveCount(0);
    await expect(adminPage.getByTestId('billing-cancel')).toHaveCount(0);
    await expect(adminPage.getByTestId('billing-update-card')).toHaveCount(0);
    await adminPage.goto('/billing/activity');
    await expect(adminPage.getByTestId('billing-activity')).toBeVisible({ timeout: 90_000 });
    await adminContext.close();

    /* ----- the owner makes the member a billing manager ----- */
    await page.goto('/billing/team');
    const memberId = await userIdOf(member.email);
    await page.getByLabel('Add a billing manager').selectOption(memberId);
    await page.getByTestId('team-add').click();
    await expect(page.getByTestId(`team-row-${memberId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Pay bills, change the plan and download invoices. No extra access to your data.').first()).toBeVisible();
    // Still a plain member of the organization: billing rights are not data rights.
    const roles = await sql<{ role: string }>(`SELECT role FROM core.member WHERE organization_id = $1 AND user_id = $2`, [orgId, memberId]);
    expect(roles[0]?.role).toBe('member');

    /* ----- the billing manager can see, download and change ----- */
    await memberPage.goto('/billing');
    await expect(memberPage.getByTestId('billing-home')).toBeVisible({ timeout: 90_000 });
    await expect(memberPage.getByTestId('billing-cost')).toContainText('$29.00 per month');
    const pdf = await memberPage.request.get(`/billing/invoices/${invoice.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    await memberPage.goto('/billing/activity');
    await expect(memberPage.getByTestId('billing-activity')).toBeVisible({ timeout: 90_000 });

    await ensureVerified(memberPage, member.email);
    await memberPage.goto('/billing/plan');
    await memberPage.getByTestId('plan-product-projects').click();
    // Projects is priced per person. The stepper starts at the 3 people the team has and cannot go lower.
    await expect(memberPage.getByTestId('plan-seats')).toHaveValue('3');
    await expect(memberPage.getByTestId('plan-seats-dec')).toBeDisabled();
    await memberPage.getByTestId('plan-submit').click();
    await expect(memberPage.getByTestId('change-preview')).toBeVisible();
    await memberPage.getByTestId('change-confirm').click();
    await memberPage.waitForURL(/\/billing\?.*notice=plan_updated/, { timeout: 90_000 });
    await expect(memberPage.getByTestId('billing-flash')).toContainText('Your plan is updated.');
    await memberContext.close();

    // Only an owner can add or remove a billing manager.
    await openBilling(page);
    await expectPhase(page, 'active');
    const managers = await sql<{ user_id: string }>(`SELECT user_id FROM core.billing_managers WHERE org_id = $1`, [orgId]);
    expect(managers.map((row) => row.user_id)).toEqual([memberId]);
  });
});
