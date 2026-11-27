import { expect, test } from '@playwright/test';
import { CART_CRM_2, auditOf, cents, expectPhase, invoicesOf, openBilling, paidAccount, runTestTool, setStepper, skipDays, sql, textOf, trialAccount } from './support';

/**
 * Review round 2, in a real browser against the test gateway:
 *  - the confirm panel gives the true reason for every amount, and its numbers add up,
 *  - the "fails at the next renewal" card, saved on the card page of an active plan, fails the very
 *    next renewal.
 */
test.describe('round 2: the words under the amounts, and the renewal test card', () => {
  const amounts = (text: string): number[] => [...text.matchAll(/\$([\d,]+\.\d\d)/g)].map((match) => Math.round(Number(match[1]!.replace(/,/g, '')) * 100));

  test('add a seat, remove it, then switch to yearly with credit on the account: every sentence adds up', async ({ page }) => {
    test.setTimeout(300_000);
    const { orgId } = await paidAccount(page, 'words', CART_CRM_2);
    await skipDays(page, 14);
    const panel = page.getByTestId('change-preview');

    /* ----- add 2 seats: the days the charge is for ----- */
    await page.goto('/billing/plan');
    await setStepper(page, 'plan-seats', 4);
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    const addNote = await textOf(page.getByTestId('change-due-note'));
    expect(addNote).toMatch(/^For the \d+ days left in this period\.$/);
    const chargedDays = Number(/(\d+) days/.exec(addNote)![1]);
    const added = cents(await textOf(page.getByTestId('change-due-today')));
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);

    /* ----- remove them again: the credit names the full days, one fewer than the charge counted ----- */
    await page.goto('/billing/plan');
    await setStepper(page, 'plan-seats', 2);
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    const credit = cents(await textOf(page.getByTestId('change-credit')));
    const creditNote = await textOf(page.getByTestId('change-credit-note'));
    expect(creditNote).toBe(`That is for the ${chargedDays - 1} full days left in this period. A day that has started counts as used.`);
    expect(credit).toBeLessThan(added);
    // The two numbers explain themselves: the same price per day, for one day fewer.
    expect(Math.abs(credit / (chargedDays - 1) - added / chargedDays)).toBeLessThan(1);
    await expect(page.getByTestId('change-due-note')).toHaveText('Nothing to pay now.');
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);

    /* ----- switch to yearly with that credit on the account ----- */
    await page.goto('/billing/plan');
    await page.getByTestId('plan-interval-yearly').click();
    await page.getByTestId('plan-submit').click();
    await expect(panel).toBeVisible();
    const yearlyNote = await textOf(page.getByTestId('change-due-note'));
    expect(yearlyNote).toMatch(
      /^\$[\d,]+\.\d\d for the next year\. Less \$[\d,]+\.\d\d for the \d+ full days left on your monthly plan\. Less \$[\d,]+\.\d\d from your credit\.$/,
    );
    const [year, back, fromCredit] = amounts(yearlyNote);
    const due = cents(await textOf(page.getByTestId('change-due-today')));
    expect(year! - back! - fromCredit!).toBe(due);
    expect(fromCredit).toBe(credit);
    // The old sentence called this amount the price "for the days left". It must be gone.
    expect(yearlyNote).not.toContain('days left in this period');
    await page.getByTestId('change-confirm').click();
    await page.waitForURL(/\/billing\?.*notice=plan_updated/);
    const invoices = await invoicesOf(orgId);
    expect(invoices[invoices.length - 1]).toMatchObject({ status: 'paid', total_cents: due });
  });

  test('"Fails at next renewal" saved on the card page: the next renewal fails', async ({ page }) => {
    test.setTimeout(300_000);
    const { orgId } = await paidAccount(page, 'card0341', CART_CRM_2);
    await openBilling(page);
    await page.getByTestId('billing-update-card').click();
    await page.waitForURL(/\/test-gateway\/card\//);
    await page.getByTestId('test-card-chip-fails_on_renewal').click();
    await page.getByTestId('test-pay').click();
    await page.waitForURL(/\/billing/);
    await expect(page.getByTestId('billing-payment-method')).toContainText('ending 0341');
    await expectPhase(page, 'active');

    // 30 days later the renewal comes due. It fails with this card, the first time.
    await openBilling(page);
    await runTestTool(page, 'shift-30');
    await runTestTool(page, 'shift-1');
    await page.reload();
    await expectPhase(page, 'past_due');
    const invoices = await invoicesOf(orgId);
    expect(invoices.map((invoice) => invoice.status)).toEqual(['paid', 'open']);
  });

  test('three tabs confirm the same plan change at the same moment: one charge, one activity line', async ({ page, context }) => {
    test.setTimeout(300_000);
    const { orgId } = await paidAccount(page, 'triple', CART_CRM_2);
    await skipDays(page, 7);
    const tabs = [page, await context.newPage(), await context.newPage()];
    const dues: number[] = [];
    for (const tab of tabs) {
      await tab.goto('/billing/plan');
      await setStepper(tab, 'plan-seats', 5);
      await tab.getByTestId('plan-submit').click();
      await expect(tab.getByTestId('change-preview')).toBeVisible();
      dues.push(cents(await textOf(tab.getByTestId('change-due-today'))));
    }
    expect(new Set(dues).size).toBe(1);

    // All three "Confirm change" buttons, pressed together.
    await Promise.all(tabs.map((tab) => tab.getByTestId('change-confirm').click()));
    // Each tab ends on the updated plan. Nobody is asked to pay again.
    // The tabs are checked one after the other, and billing home takes `notice` out of the address
    // as soon as it has shown the message. So the proof is the message itself, not the address.
    for (const tab of tabs) {
      await tab.waitForURL((url) => url.pathname === '/billing', { timeout: 60_000 });
      await expect(tab.getByTestId('billing-flash')).toContainText('Your plan is updated.', { timeout: 60_000 });
      await expect(tab.getByTestId('billing-usage-seats')).toContainText('of 5');
    }

    const invoices = await invoicesOf(orgId);
    expect(invoices.map((invoice) => [invoice.status, invoice.total_cents])).toEqual([
      ['paid', 5800],
      ['paid', dues[0]],
    ]);
    const audit = await auditOf(orgId);
    expect(audit.filter((row) => row.action === 'plan.changed')).toHaveLength(1);
    expect(audit.filter((row) => row.action === 'payment.succeeded')).toHaveLength(2);
    const gateway = await sql(`SELECT id FROM core.billing_test_objects WHERE org_id = $1 AND kind = 'invoice'`, [orgId]);
    expect(gateway).toHaveLength(2);
  });

  test('two tabs open checkout at the same moment: one gateway customer and one open pay page', async ({ page, context }) => {
    test.setTimeout(300_000);
    const { orgId } = await trialAccount(page, 'twotabs', CART_CRM_2);
    const tabs = [page, await context.newPage()];
    for (const tab of tabs) {
      await tab.goto('/billing/checkout');
      await expect(tab.getByTestId('review-pay')).toBeVisible({ timeout: 60_000 });
    }
    await Promise.all(tabs.map((tab) => tab.getByTestId('review-pay').click()));
    for (const tab of tabs) await tab.waitForURL(/\/test-gateway\/checkout\//, { timeout: 60_000 });

    const customers = await sql(`SELECT id FROM core.billing_test_objects WHERE org_id = $1 AND kind = 'customer'`, [orgId]);
    expect(customers).toHaveLength(1);
    const sessions = await sql<{ status: string; customer: string }>(
      `SELECT data->>'status' AS status, data->>'customerId' AS customer FROM core.billing_test_objects WHERE org_id = $1 AND kind = 'checkout_session'`,
      [orgId],
    );
    expect(sessions.filter((row) => row.status === 'open')).toHaveLength(1);
    expect(new Set(sessions.map((row) => row.customer)).size).toBe(1);
    const [stored] = await sql<{ id: string }>(`SELECT stripe_customer_id AS id FROM core.stripe_customers WHERE org_id = $1`, [orgId]);
    expect(stored?.id).toBe((customers[0] as { id: string }).id);
  });
});
