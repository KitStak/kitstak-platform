import { expect, test } from '@playwright/test';
import { CART_CRM_2, auditOf, cents, emailsTo, inviteLinkFor, invitePerson, invoicesOf, newPerson, paidAccount, textOf } from './support';

test.describe('nothing raises the bill without a yes', () => {
  test('all seats in use: the invite shows the price first, and yes adds the seat and sends the invite', async ({ page }) => {
    const { orgId } = await paidAccount(page, 'seats', CART_CRM_2);
    const second = newPerson('seat2', 'Sam Rivera');
    const third = newPerson('seat3', 'Dana Ortiz');

    // 2 seats paid, 1 person. The first invite takes the free seat.
    await invitePerson(page, second.email);
    await inviteLinkFor(page, second.email);
    await expect(page.getByTestId('invite-seat-offer')).toHaveCount(0);
    expect((await invoicesOf(orgId)).length).toBe(1);

    // The second invite needs a third seat. Before anything is sent the form shows the price and asks.
    await invitePerson(page, third.email);
    const offer = page.getByTestId('invite-seat-offer');
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await expect(offer).toContainText('All 2 seats are in use.');
    await expect(offer).toContainText('Add 1 seat for $29.00 more per month.');
    await expect(offer).toContainText(/You pay \$\d+\.\d{2} today/);
    const dueToday = cents(/You pay (\$[\d.,]+) today/.exec(await textOf(offer))![1]!);
    // Nothing happened yet: no charge, no invite.
    expect((await invoicesOf(orgId)).length).toBe(1);
    expect(await emailsTo(third.email, 'invitation')).toHaveLength(0);

    // Yes: the plan grows by one seat, the amount charged is the amount shown, and the invite goes out.
    await page.getByTestId('invite-add-seat').click();
    await inviteLinkFor(page, third.email);
    const invoices = await invoicesOf(orgId);
    expect(invoices).toHaveLength(2);
    expect(invoices[1]?.total_cents).toBe(dueToday);
    expect((await auditOf(orgId)).some((row) => row.action === 'plan.changed' && row.summary.includes('The plan is now 3 seats.'))).toBe(true);
    await page.goto('/billing');
    await expect(page.getByTestId('billing-cost')).toContainText('$87.00 per month');
  });
});
