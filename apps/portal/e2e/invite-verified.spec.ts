import { expect, test } from '@playwright/test';
import {
  CART_CRM_2,
  CART_PULSE,
  emailsTo,
  handoffLink,
  inviteLinkFor,
  invitePerson,
  joinFromInvite,
  newPerson,
  orgIdOf,
  resetRateLimits,
  signUp,
  sql,
  trialAccount,
  verifyEmail,
} from './support';

/**
 * Review round 1: a person who joins from the invite email has already shown they own that mailbox,
 * so they are never asked to verify it. And a typo in an email can be fixed without starting over.
 */
test.describe('invited people and email addresses', () => {
  test('joining from the invite email: the address is verified, no code is sent, no banner shows', async ({ browser, page }) => {
    test.setTimeout(300_000);
    const { orgId } = await trialAccount(page, 'inviter', CART_CRM_2);
    const member = newPerson('invited', 'Casey Lane');
    await invitePerson(page, member.email, 'member');
    const link = await inviteLinkFor(page, member.email);
    // The emailed link carries the proof that only this mailbox has.
    expect(link).toMatch(/\/invite\/[0-9a-f-]{36}\?t=[A-Za-z0-9_-]{43}$/);

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await joinFromInvite(memberPage, link, member);
    await expect(memberPage.getByTestId('launcher').or(memberPage.locator('main')).first()).toBeVisible({ timeout: 90_000 });

    const rows = await sql<{ email_verified: boolean }>('select email_verified from core."user" where email = $1', [member.email]);
    expect(rows).toEqual([{ email_verified: true }]);
    expect(await emailsTo(member.email, 'verify_email')).toHaveLength(0);
    const joined = await sql('select 1 from core.member m join core."user" u on u.id = m.user_id where u.email = $1 and m.organization_id = $2', [member.email, orgId]);
    expect(joined).toHaveLength(1);

    // No "Check your email for a 6 digit code" on the launcher or on billing.
    for (const path of ['/', '/billing']) {
      await memberPage.goto(path);
      await expect(memberPage.locator('main').first()).toBeVisible({ timeout: 90_000 });
      await expect(memberPage.getByText('6 digit code')).toHaveCount(0);
    }
    // The proof is kept out of the address bar.
    await memberPage.goto(link);
    expect(new URL(memberPage.url()).search).toBe('');
    await context.close();
  });

  test('an invite opened without the emailed proof is refused in one sentence, and no account is made', async ({ browser, page }) => {
    test.setTimeout(300_000);
    await trialAccount(page, 'inviter2', CART_CRM_2);
    const member = newPerson('noproof', 'Robin Vale');
    await invitePerson(page, member.email, 'member');
    const link = await inviteLinkFor(page, member.email);

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    // Only the id, as someone on the team who can list invites would have it. Review round 4: the
    // id is not a secret, so by itself it no longer lets anyone join (it did until round 3, and an
    // admin could take an owner's billing invite that way). See round4-backend.spec.ts.
    await resetRateLimits();
    await memberPage.goto(link.split('?')[0] ?? link);
    await expect(memberPage.getByTestId('invite-org-name')).toBeVisible({ timeout: 90_000 });
    await memberPage.getByTestId('invite-name').fill(member.name);
    await memberPage.getByTestId('invite-password').fill(member.password);
    await memberPage.getByTestId('invite-accept').click();
    await expect(memberPage.getByText('Open the link in your invite email to join. That shows the email is yours.')).toBeVisible({ timeout: 30_000 });
    expect(await sql('select 1 from core."user" where email = $1', [member.email])).toHaveLength(0);
    expect(await emailsTo(member.email, 'verify_email')).toHaveLength(0);

    // The link from the email still works afterwards.
    await joinFromInvite(memberPage, link, member);
    expect(await sql<{ email_verified: boolean }>('select email_verified from core."user" where email = $1', [member.email])).toEqual([{ email_verified: true }]);
    await context.close();
  });

  test('a typo in the email: "Change email" keeps the account, the organization and the trial', async ({ page }) => {
    test.setTimeout(300_000);
    const person = newPerson('typo');
    const right = person.email.replace('@', '-fixed@');
    await signUp(page, person, { link: handoffLink(CART_PULSE) });
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    const orgId = await orgIdOf(person.email);

    await page.getByTestId('change-email').click();
    await page.getByTestId('change-email-input').fill(person.email);
    await page.getByTestId('change-email-save').click();
    await expect(page.getByTestId('change-email-form').getByRole('alert')).toHaveText('That is the address we already have. Type the right one.');

    await resetRateLimits();
    await page.getByTestId('change-email-input').fill(right);
    await page.getByTestId('change-email-save').click();
    await expect(page.getByText('We sent a new code there.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(right).first()).toBeVisible();

    // Same account, same organization, same free trial. Only the address moved.
    const users = await sql<{ email: string }>('select u.email from core."user" u join core.member m on m.user_id = u.id where m.organization_id = $1', [orgId]);
    expect(users).toEqual([{ email: right }]);
    const trial = await sql('select 1 from core.billing_accounts where org_id = $1 and trial_ends_at is not null', [orgId]);
    expect(trial).toHaveLength(1);
    expect(await emailsTo(person.email, 'verify_email')).toHaveLength(1);

    // The code that went to the new address verifies it.
    await verifyEmail(page, right, '/welcome');
    const verified = await sql<{ email_verified: boolean }>('select email_verified from core."user" where email = $1', [right]);
    expect(verified).toEqual([{ email_verified: true }]);
  });
});
