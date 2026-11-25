import { expect, test } from '@playwright/test';
import { CART_PULSE, auditOf, emailsTo, entitlementsOf, expectPhase, openBilling, paidAccount, portalAppsOpen, skipDays, sql, totalOf, runTestTool } from './support';

test.describe('cancel in two clicks, and undo', () => {
  test('cancel with a reason, keep access to the end, undo in one click, then cancel for good', async ({ page }) => {
    const { person, orgId } = await paidAccount(page, 'cancel', CART_PULSE);

    // Click one: "Cancel plan" on billing home.
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await expect(page.getByText(/Your plan will end on [A-Z][a-z]{2} \d{1,2}, \d{4}\./).first()).toBeVisible();
    await expect(page.getByText('Nothing is deleted.').first()).toBeVisible();
    // A monthly plan is offered a pause first.
    await expect(page.getByTestId('cancel-offer-pause')).toBeVisible();

    // One optional question. Then click two: "Cancel my plan".
    await page.getByTestId('cancel-reason-too_expensive').click();
    await page.getByTestId('cancel-detail').fill('We are trying a smaller tool for a while.');
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'cancel_scheduled');
    await expect(page.getByTestId('billing-plan-card')).toContainText(/Your plan ends on [A-Z][a-z]{2} \d{1,2}, \d{4}\. You keep everything until then\./);
    await expect(page.getByTestId('plan-notice-cancel_scheduled')).toContainText('You keep everything until then.');

    // Access is unchanged, the answer is stored, and the email says how to undo.
    expect((await entitlementsOf(orgId)).map((row) => [row.module, row.status])).toEqual([['pulse', 'active']]);
    const feedback = await sql<{ reason: string; detail: string; outcome: string }>(
      `SELECT reason, detail, outcome FROM core.billing_cancel_feedback WHERE org_id = $1`,
      [orgId],
    );
    expect(feedback).toEqual([{ reason: 'too_expensive', detail: 'We are trying a smaller tool for a while.', outcome: 'canceled' }]);
    await page.request.post('/api/billing/jobs/tick');
    const mail = await emailsTo(person.email, 'cancel_scheduled');
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toMatch(/^Your KitStak plan will end on [A-Z][a-z]{2} \d{1,2}$/);
    expect(mail[0]?.body_text).toContain('You can undo this with one click.');

    // "Keep my plan": one click, no confirm.
    await page.getByTestId('billing-keep-plan').click();
    await expectPhase(page, 'active');
    await expect(page.getByTestId('billing-flash')).toContainText('Your plan stays on. Nothing changes.');
    await expect(page.getByTestId('plan-notice-cancel_scheduled')).toHaveCount(0);

    // Cancel again, with no reason this time. Skipping the question never blocks.
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'cancel_scheduled');

    // Past the end of the paid month: the plan has ended, view only, data still there.
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'ended');
    // With the allow all switch on every app is open, and the Portal never says "view only" then.
    await expect(page.getByTestId('billing-plan-card')).toContainText(
      (await portalAppsOpen(page))
        ? /Your plan ended on [A-Z][a-z]{2} \d{1,2}, \d{4}\. Your data is safe\./
        : /Your plan ended on [A-Z][a-z]{2} \d{1,2}, \d{4}\. Your apps are view only\. Your data is safe\./,
    );
    await expect(page.getByTestId('plan-notice-ended')).toContainText('Your data is safe. Pick a plan to keep working.');
    expect((await entitlementsOf(orgId)).map((row) => row.module)).toEqual(['pulse']);
    await page.request.post('/api/billing/jobs/tick');
    expect(await emailsTo(person.email, 'plan_ended')).toHaveLength(1);

    // "Pick a plan" starts a new checkout with the old cart. No second free trial.
    await page.getByTestId('billing-pick-plan').click();
    await page.waitForURL(/\/billing\/plan/);
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'checkout');
    await expect(page.getByTestId('plan-product-pulse')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('quote-total').first()).toHaveText(totalOf(CART_PULSE));
    await expect(page.getByTestId('plan-submit')).toHaveText(/Continue to test checkout/);

    const actions = (await auditOf(orgId)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['cancel.scheduled', 'cancel.undone', 'plan.ended']));
    await openBilling(page);
  });
});
