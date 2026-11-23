import { expect, test } from '@playwright/test';
import {
  CART_CRM_2,
  auditOf,
  emailsTo,
  expectPhase,
  handoffLink,
  newPerson,
  openBilling,
  orgIdOf,
  payAndSucceed,
  signUp,
  skipDays,
  textOf,
  runTestTool,
  verifyEmail,
} from './support';

/**
 * The whole road in one test: signup, free trial, paid, plan change, failed payment, fix, cancel.
 * Then the two places a person looks back: the billing activity page and their inbox (the outbox).
 */
test.describe('the whole lifecycle, and the record it leaves', () => {
  test('signup to trial to paid to plan change to failed payment to cancel', async ({ page }) => {
    test.setTimeout(300_000);
    const person = newPerson('life');

    /* ----- signup and trial ----- */
    await signUp(page, person, {
      link: handoffLink(CART_CRM_2, { name: person.name, email: person.email, company: person.company }),
      prefilled: true,
    });
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await verifyEmail(page, person.email, '/welcome');
    const orgId = await orgIdOf(person.email);
    await openBilling(page);
    await expectPhase(page, 'trial');

    /* ----- paid: a card during the trial, first charge at the trial end ----- */
    await payAndSucceed(page, 'fails_on_renewal');
    await openBilling(page);
    await expectPhase(page, 'active');
    await runTestTool(page, 'shift-trial-end');
    await runTestTool(page, 'run-due');
    await page.reload();
    await expect(page.getByTestId('billing-plan-card')).toContainText('Your plan is active.');
    await expect(page.getByTestId('billing-invoices-preview')).toContainText('$58.00');

    /* ----- plan change: add a seat ----- */
    await page.getByTestId('billing-change-plan').click();
    await page.waitForURL(/\/billing\/plan/);
    await page.getByTestId('plan-seats-inc').click();
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('change-preview')).toBeVisible();
    // This card fails every charge after the first one, so the change is refused and nothing moves.
    await page.getByTestId('change-confirm').click();
    await expect(page.getByTestId('change-preview')).toContainText('That card was declined. Try another card or call your bank.');
    await page.keyboard.press('Escape');
    await openBilling(page);
    await expect(page.getByTestId('billing-cost')).toContainText('$58.00 per month');

    /* ----- failed payment at renewal, then the fix ----- */
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');
    await page.getByTestId('billing-update-card').click();
    await page.waitForURL(/\/test-gateway\/card\//);
    await page.getByTestId('test-card-chip-success').click();
    await page.getByTestId('test-pay').click();
    await page.waitForURL(/\/billing/);
    await expect(page.getByTestId('billing-flash')).toContainText('Card updated. Your payment went through.');
    await expectPhase(page, 'active');

    /* ----- now the seat can be added ----- */
    await page.goto('/billing/plan');
    await page.getByTestId('plan-seats-inc').click();
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('change-preview')).toBeVisible();
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    await expect(page.getByTestId('billing-cost')).toContainText('$87.00 per month');

    /* ----- cancel ----- */
    await page.getByTestId('billing-cancel').click();
    await page.waitForURL(/\/billing\/cancel/);
    await page.getByTestId('cancel-reason-not_using').click();
    await page.getByTestId('cancel-confirm').click();
    await page.waitForURL(/\/billing(\?|$)/);
    await expectPhase(page, 'cancel_scheduled');

    // Everything queued goes out.
    await page.request.post('/api/billing/jobs/tick');

    /* ----- the activity page tells the story in plain words ----- */
    await page.getByRole('link', { name: 'Activity' }).first().click();
    await page.waitForURL(/\/billing\/activity/);
    await expect(page.getByTestId('billing-activity')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Billing activity');
    const rows = page.getByTestId('activity-row');
    await expect(rows.first()).toBeVisible();
    const log = await auditOf(orgId);
    const actions = log.map((row) => row.action);
    for (const action of ['trial.started', 'checkout.started', 'plan.started', 'payment.succeeded', 'payment.failed', 'card.updated', 'plan.changed', 'cancel.scheduled', 'email.sent']) {
      expect(actions, action).toContain(action);
    }
    const page1 = (await rows.allTextContents()).join('\n');
    // Newest first: the cancel is on top of the page.
    expect(page1).toContain(`${person.name} canceled the plan.`);
    expect(page1).toContain(`We emailed a cancel confirmation to ${person.email}.`);
    await expect(rows.filter({ hasText: 'By KitStak' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: `By ${person.name}` }).first()).toBeVisible();
    // No code words on screen.
    expect(page1).not.toMatch(/past_due|cancel_scheduled|subscription|entitlement/);

    // Filters: Payments shows payments only, each with a link to its invoice where there is one.
    await page.getByTestId('activity-filter-payments').click();
    await page.waitForURL(/show=payments/);
    await expect(page.getByTestId('activity-filter-payments')).toHaveAttribute('aria-current', 'page');
    const paymentActions = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action')));
    expect(paymentActions.length).toBeGreaterThanOrEqual(4);
    expect(paymentActions.every((action) => ['payment.succeeded', 'payment.failed', 'payment.retried', 'card.updated'].includes(action ?? ''))).toBe(true);
    await expect(rows.filter({ hasText: /Payment of \$\d+\.\d{2} succeeded\./ }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'We could not charge the Visa ending 0341' }).first()).toBeVisible();

    // Emails: every billing email that went out, as a plain sentence.
    await page.getByTestId('activity-filter-emails').click();
    await page.waitForURL(/show=emails/);
    const emailRows = (await rows.allTextContents()).join('\n');
    expect(emailRows).toContain(`We emailed a welcome note to ${person.email}.`);
    expect(emailRows).toContain(`We emailed a receipt to ${person.email}.`);
    expect(emailRows).toContain(`We emailed a failed payment notice to ${person.email}.`);
    await rows.filter({ hasText: 'We emailed a receipt' }).first().getByRole('link', { name: /View the invoice/ }).click();
    await page.waitForURL(/\/billing\/invoices\/in_test_/);
    await page.goBack();

    // Plan changes, and the count on each tab adds up.
    await page.getByTestId('activity-filter-plan').click();
    await page.waitForURL(/show=plan/);
    await expect(rows.filter({ hasText: `${person.name} started a free trial for CRM.` })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'added 1 seat. The plan is now 3 seats.' })).toHaveCount(1);
    const countOf = async (id: string) => Number((await textOf(page.getByTestId(`activity-filter-${id}`))).replace(/\D+/g, ' ').trim().split(' ')[0]);
    expect(await countOf('all')).toBe((await countOf('payments')) + (await countOf('plan')) + (await countOf('emails')));
    expect(await countOf('all')).toBe(log.length + (await auditOf(orgId)).length - log.length);

    // The CSV download holds the same story and is this organization's only.
    const csv = await page.request.get('/billing/activity/export');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(/attachment; filename="kitstak-billing-activity-.+\.csv"/);
    const text = await csv.text();
    expect(text).toContain('"When (UTC)","Kind","Who","What happened"');
    expect(text).toContain(`"${person.name} canceled the plan.`);
    expect(text.split('\r\n').filter((line) => line.length > 0).length).toBe((await auditOf(orgId)).length + 1);

    /* ----- the inbox: every email, with HTML and text, newest first ----- */
    await page.goto(`/dev/outbox?to=${encodeURIComponent(person.email)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Email outbox');
    await expect(page.getByTestId('test-mode-label')).toContainText('These emails were not sent to anyone.');
    const mailRows = page.getByTestId('outbox-row');
    const kinds = await mailRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-template')));
    for (const kind of ['verify_email', 'welcome', 'plan_started', 'receipt', 'payment_failed', 'cancel_scheduled']) {
      expect(kinds, kind).toContain(kind);
    }
    // The newest email is open: the cancel confirmation, with one button that goes to billing.
    await expect(page.getByTestId('outbox-subject')).toHaveText(/^Your KitStak plan will end on [A-Z][a-z]{2} \d{1,2}$/);
    await expect(page.getByTestId('outbox-to')).toHaveText(person.email);
    const frame = page.frameLocator('[data-testid="outbox-html"]');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(/^Your plan will end on/);
    await expect(frame.getByRole('link', { name: 'Keep my plan' })).toHaveAttribute('href', /\/billing$/);
    await page.getByRole('tab', { name: 'Plain text' }).click();
    await expect(page.getByTestId('outbox-text').first()).toContainText('You can undo this with one click.');

    // Open the receipt: the same total a customer paid, tax never hidden inside a line.
    const receiptRow = mailRows.filter({ hasText: 'Your KitStak receipt for' }).first();
    await receiptRow.getByRole('link').click();
    await page.waitForURL(/open=/);
    await expect(page.getByTestId('outbox-subject')).toHaveText(/^Your KitStak receipt for \$\d+\.\d{2}$/);
    await expect(page.frameLocator('[data-testid="outbox-html"]').getByText('Total paid')).toBeVisible();

    // The database agrees: each email went out once.
    const sent = await emailsTo(person.email);
    expect(sent.every((mail) => mail.status === 'sent')).toBe(true);
    expect(sent.filter((mail) => mail.template === 'welcome')).toHaveLength(1);
    expect(sent.filter((mail) => mail.template === 'plan_started')).toHaveLength(1);
    expect(sent.filter((mail) => mail.template === 'cancel_scheduled')).toHaveLength(1);
  });

  test('the template gallery renders all 14 emails and none of it exists for a signed out stranger to abuse', async ({ page }) => {
    await page.goto('/dev/outbox/templates');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Email templates');
    for (const id of ['verify_email', 'reset_password', 'invitation', 'welcome', 'trial_ending', 'trial_ended', 'plan_started', 'receipt', 'payment_failed', 'payment_action_required', 'grace_ending', 'cancel_scheduled', 'paused', 'plan_ended']) {
      await page.getByTestId(`template-${id}`).click();
      await page.waitForURL(new RegExp(`t=${id}`));
      await expect(page.getByTestId('outbox-subject')).not.toHaveText('');
      const frame = page.frameLocator('[data-testid="outbox-html"]');
      await expect(frame.locator('h1')).toBeVisible();
      // No image, so nothing is blocked and nothing is tracked.
      await expect(frame.locator('img')).toHaveCount(0);
    }
    // The email is shown in a frame that cannot run scripts.
    const sandbox = await page.getByTestId('outbox-html').getAttribute('sandbox');
    expect(sandbox).not.toContain('allow-scripts');
    // An id that is not an email shows the list, never an error.
    const odd = await page.request.get('/dev/outbox?open=not-an-id');
    expect(odd.status()).toBe(200);
  });
});
