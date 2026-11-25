import { expect, test } from '@playwright/test';
import { BASE_URL, CART_CRM_2, auditOf, sql, trialAccount } from './support';

/**
 * Review round 2. A person in two organizations has a billing page open for the first one, switches
 * to the second one in another tab, and comes back to press a button. The page was made for the
 * first organization, so the action is refused with one plain sentence and nothing is written.
 */
test.describe('a billing tab left open across an organization switch', () => {
  test('two tabs: the stale one is refused and neither organization changes', async ({ page, context }) => {
    test.setTimeout(240_000);
    const { person, orgId: orgA } = await trialAccount(page, 'staletab', CART_CRM_2);
    const post = (path: string, data: Record<string, unknown>) =>
      context.request.post(`${BASE_URL}${path}`, { data, headers: { origin: BASE_URL, 'content-type': 'application/json' } });

    // A second organization for the same person, made the way the app makes one.
    const slug = `e2e-stale-${Date.now().toString(36)}`;
    const created = await post('/api/auth/organization/create', { name: 'Stale Tab Org B', slug });
    expect(created.ok(), await created.text()).toBe(true);
    const [orgBRow] = await sql<{ id: string }>(`SELECT id FROM core.organization WHERE slug = $1`, [slug]);
    const orgB = orgBRow!.id;
    expect((await post('/api/auth/organization/set-active', { organizationId: orgA })).ok()).toBe(true);

    // Tab 1 shows billing details for organization A.
    await page.goto('/billing/details');
    const form = page.getByTestId('details-form');
    await expect(form).toBeVisible();
    await expect(page.locator('body')).toContainText(person.company);
    await form.locator('input').first().fill('STALE TAB COMPANY A');

    // Tab 2: the person switches to organization B with the organization switcher's own call.
    const tab2 = await context.newPage();
    await tab2.goto('/');
    expect((await post('/api/auth/organization/set-active', { organizationId: orgB })).ok()).toBe(true);
    await tab2.reload();
    await expect(tab2.locator('body')).toContainText('Stale Tab Org B');

    // Back in tab 1, "Save" is refused.
    const auditBefore = { a: (await auditOf(orgA)).length, b: (await auditOf(orgB)).length };
    await page.getByTestId('details-save').click();
    await expect(page.getByText('You switched organizations. Reload this page.')).toBeVisible();

    const rows = await sql<{ org_id: string; company_name: string | null }>(
      `SELECT org_id, company_name FROM core.billing_accounts WHERE org_id = ANY($1::uuid[])`,
      [[orgA, orgB]],
    );
    for (const row of rows) expect(row.company_name ?? '', row.org_id).not.toContain('STALE TAB');
    expect({ a: (await auditOf(orgA)).length, b: (await auditOf(orgB)).length }).toEqual(auditBefore);

    // The other buttons on a stale tab get the same answer: the plan page is one of them.
    await page.goto('/billing');
    await expect(page.locator('body')).toContainText('Stale Tab Org B');
    // After a reload the page is made for the active organization and works again.
    await page.goto('/billing/details');
    await page.getByTestId('details-form').locator('input').first().fill('Org B Books');
    await page.getByTestId('details-save').click();
    await expect
      .poll(async () => (await sql<{ company_name: string | null }>(`SELECT company_name FROM core.billing_accounts WHERE org_id = $1`, [orgB]))[0]?.company_name ?? '')
      .toBe('Org B Books');
    const [a] = await sql<{ company_name: string | null }>(`SELECT company_name FROM core.billing_accounts WHERE org_id = $1`, [orgA]);
    expect(a?.company_name ?? '').not.toBe('Org B Books');
  });
});
