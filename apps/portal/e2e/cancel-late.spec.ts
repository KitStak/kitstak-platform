import { expect, test } from '@playwright/test';
import { CART_PULSE, auditOf, emailsTo, entitlementsOf, expectPhase, invoicesOf, openBilling, paidAccount, runTestTool, skipDays, sql } from './support';

/**
 * Review round 3: cancel while a payment is late. One honest rule, said before the button: a cancel
 * with a bill open ends the plan today and drops that bill. Never "you keep everything until", never
 * a second "Cancel plan", and nothing is charged after the cancel.
 */
test.describe('cancel while a payment is late', () => {
  test('day 0 of a late payment: the page says the plan ends today, and it does', async ({ page }) => {
    const { person, orgId } = await paidAccount(page, 'cancellate', CART_PULSE, 'fails_on_renewal');
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');

    // Cancel is offered, once.
    await expect(page.getByTestId('billing-cancel')).toHaveCount(1);
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);

    const notice = page.getByTestId('cancel-what-happens');
    await expect(notice).toContainText('You have an unpaid bill of $29.00.');
    await expect(notice).toContainText('If you cancel now, your plan ends today and we will not charge the $29.00.');
    await expect(notice).toContainText('Your apps become view only today.');
    await expect(page.getByTestId('cancel-instead')).toContainText(/Pay the \$29\.00 and you have full access until [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    await expect(page.locator('main')).not.toContainText('You keep everything until then');
    // No pause on offer for a plan with a bill open, and the buttons say what they do.
    await expect(page.getByTestId('cancel-offer-pause')).toHaveCount(0);
    await expect(page.getByTestId('cancel-confirm')).toHaveText('End my plan today');
    await expect(page.getByTestId('cancel-back')).toHaveText('Pay the bill instead');

    await page.getByTestId('cancel-reason-too_expensive').click();
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'ended');
    await expect(page.getByTestId('billing-flash')).toContainText('Your plan has ended. The open bill was dropped. We will not charge it.');
    await expect(page.getByTestId('billing-plan-card')).toContainText(/You canceled, so your plan ended on [A-Z][a-z]{2} \d{1,2}, \d{4}\. We did not charge the \$29\.00\./);
    // No leftover of the late payment and no cancel left to press.
    await expect(page.getByTestId('billing-cancel')).toHaveCount(0);
    await expect(page.getByTestId('billing-keep-plan')).toHaveCount(0);
    await expect(page.getByTestId('billing-pay-now')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('We will try');

    // The database agrees: the plan is over, the bill is void, the app is view only.
    const [row] = await sql<{ status: string; cancel_at_period_end: boolean; ended_reason: string }>(
      `SELECT status, cancel_at_period_end, ended_reason FROM core.billing_subscriptions WHERE org_id = $1`,
      [orgId],
    );
    expect(row).toEqual({ status: 'canceled', cancel_at_period_end: false, ended_reason: 'canceled_unpaid' });
    expect((await invoicesOf(orgId)).map((invoice) => invoice.status)).toEqual(['paid', 'void']);
    expect((await entitlementsOf(orgId)).map((entry) => [entry.module, entry.status])).toEqual([['pulse', 'canceled']]);

    // The retry days pass. Nothing is tried and nothing is charged.
    await skipDays(page, 15);
    await runTestTool(page, 'run-due');
    expect((await invoicesOf(orgId)).map((invoice) => invoice.status)).toEqual(['paid', 'void']);
    const actions = await auditOf(orgId);
    expect(actions.filter((entry) => entry.action === 'payment.failed')).toHaveLength(1);
    expect(actions.find((entry) => entry.action === 'cancel.ended_now')?.summary).toBe(
      `${person.name} canceled the plan with a bill of $29.00 open. The plan ended and the bill was dropped. It will not be charged.`,
    );
    await page.request.post('/api/billing/jobs/tick');
    const ended = await emailsTo(person.email, 'plan_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.body_text).toContain('A bill of $29.00 was still open. We dropped it. We will not charge it.');
    expect(await emailsTo(person.email, 'cancel_scheduled')).toHaveLength(0);
  });

  test('view only after the 7 days: the page says so, and the cancel ends the plan and drops the bill', async ({ page }) => {
    const { orgId } = await paidAccount(page, 'cancelunpaid', CART_PULSE, 'fails_on_renewal');
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await skipDays(page, 8);
    await runTestTool(page, 'run-due');
    await openBilling(page);
    await expectPhase(page, 'unpaid');

    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    const notice = page.getByTestId('cancel-what-happens');
    await expect(notice).toContainText('You have an unpaid bill of $29.00, and your apps are view only now.');
    await expect(notice).toContainText('If you cancel, your plan ends today and we will not charge the $29.00.');
    await expect(page.locator('main')).not.toContainText('You keep everything until then');

    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'ended');
    await expect(page.getByTestId('billing-cancel')).toHaveCount(0);
    expect((await invoicesOf(orgId)).map((invoice) => invoice.status)).toEqual(['paid', 'void']);
  });
});
