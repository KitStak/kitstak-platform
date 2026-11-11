/**
 * CRM power features:
 *  1. Pipeline cockpit renders funnel / forecast / quota / risk; filters live in the URL.
 *  2. A throwaway lead (unique company) → item panel "Convert" → wizard creates Account +
 *     Contact + Deal → summary → Contact 360 shows the account and deal → "Log activity"
 *     adds a timeline entry. Everything the spec creates is deleted afterwards.
 *  3. Duplicates page loads for contacts and accounts.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';
import { baseUrl } from './support/paths';

interface Ctx {
  orgId: string;
  slug: string;
  leadsBoardId: string;
  created: string[];
}

async function api<T>(request: APIRequestContext, orgId: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    timeout: 90_000,
    headers: { ...(orgId ? { 'x-org-id': orgId } : {}), origin: baseUrl(), 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { ok: boolean; data: T; error?: { message: string } };
  if (!json.ok) throw new Error(`${method} ${path}: ${json.error?.message}`);
  return json.data;
}

async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
}

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.describe('crm', () => {
  const stamp = Date.now();
  const company = `Zephyr Quill ${stamp}`;
  const leadName = `Rowan Tester ${stamp}`;
  const raceLead = `Race Tester ${stamp}`;
  const ctx: Ctx = { orgId: '', slug: '', leadsBoardId: '', created: [] };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    const me = await api<{ organizations: { id: string; slug: string }[] }>(request, null, 'GET', '/me');
    const org = me.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.organizations[0];
    ctx.orgId = org?.id ?? '';
    ctx.slug = org?.slug ?? '';
    const boards = await api<{ primary: { leads?: { id: string } } }>(request, ctx.orgId, 'GET', '/crm/boards');
    ctx.leadsBoardId = boards.primary.leads?.id ?? '';
    expect(ctx.leadsBoardId, 'seeded Leads board').not.toBe('');
  });

  test.afterAll(async ({ request }) => {
    // The seeded "lead qualified → create opportunity" automation adds a deal per conversion;
    // find those by the lead names so the shared Deals board is left as we found it.
    // Sweep every CRM board for records carrying this run's stamp, so a run that fails midway
    // (before the summary lists its ids) still leaves nothing behind.
    const boards = await api<{ primary: Record<string, { id: string } | undefined> }>(request, ctx.orgId, 'GET', '/crm/boards').catch(
      () => null,
    );
    for (const board of Object.values(boards?.primary ?? {})) {
      if (!board) continue;
      const data = await api<{ id: string; name: string }[] | { items: { id: string; name: string }[] }>(
        request,
        ctx.orgId,
        'GET',
        `/boards/${board.id}/items?q=${stamp}&limit=100`,
      ).catch(() => []);
      const rows = Array.isArray(data) ? data : data.items;
      ctx.created.push(...rows.filter((row) => row.name.includes(String(stamp))).map((row) => row.id));
    }
    for (const id of [...new Set(ctx.created)].reverse()) {
      await api(request, ctx.orgId, 'DELETE', `/items/${id}`).catch(() => undefined);
    }
  });

  test('pipeline cockpit shows funnel, forecast and URL filters', async ({ page, diagnostics }) => {
    await gotoApp(page, `/${ctx.slug}/crm/pipeline`);
    await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('crm-funnel')).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('crm-forecast')).toBeVisible();
    await expect(page.getByTestId('crm-metric-weighted')).toContainText('$');
    await expect(page.getByTestId('crm-quota')).toBeVisible();
    await expect(page.getByTestId('crm-velocity')).toBeVisible();

    await page.getByRole('radio', { name: 'Year' }).click();
    await expect(page).toHaveURL(/period=this_year/);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await expect(page.getByRole('radio', { name: 'Year' })).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 });
    await expect(page.getByTestId('crm-funnel')).toBeVisible({ timeout: 150_000 });

    // Settings dialog opens with the stage probabilities and closes with Escape.
    await page.getByTestId('crm-settings-open').click();
    await expect(page.getByTestId('crm-pipeline-settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('crm-pipeline-settings')).toBeHidden();

    // The top bar CRM menu is present and marks the CRM section active on the pipeline.
    await expect(page.getByTestId('topnav-crm')).toHaveAttribute('aria-current', 'page');
    expect(diagnostics.errors, 'console errors on the pipeline').toEqual([]);
  });

  test('convert a lead, then log an activity on the new contact', async ({ page, request, diagnostics }) => {
    const lead = await api<{ id: string }>(request, ctx.orgId, 'POST', `/boards/${ctx.leadsBoardId}/items`, {
      name: leadName,
      values: {
        company,
        job_title: 'Head of Operations',
        email: { email: `rowan.${stamp}@zephyrquill${stamp}.example` },
      },
    });
    ctx.created.push(lead.id);

    // The board route is still the read-only overview; the item panel harness hosts the real panel.
    await gotoApp(page, `/dev/item-panel?item=${lead.id}`);
    const panel = page.getByTestId('item-panel');
    await expect(panel).toBeVisible({ timeout: 150_000 });
    await panel.getByTestId('crm-convert-lead').click();

    const dialog = page.getByTestId('crm-convert-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('crm-convert-account')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByTestId('crm-convert-account-new')).toBeVisible();
    await expect(dialog.getByLabel('Account name')).toHaveValue(company);
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByTestId('crm-convert-contact')).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue(leadName);
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByTestId('crm-convert-deal')).toBeVisible();
    // A negative amount is caught inline and blocks the conversion.
    await dialog.getByLabel(/Amount/).fill('-50');
    await expect(dialog.getByText('Amount can’t be negative')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Convert lead' })).toBeDisabled();
    await dialog.getByLabel(/Amount/).fill('42000');
    // Double-click: the guard sends one request only.
    await dialog.getByRole('button', { name: 'Convert lead' }).dblclick();

    const summary = dialog.getByTestId('crm-convert-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText(company);
    await expect(summary).toContainText(leadName);
    const links = await summary.getByRole('link').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
    const ids = links.map((href) => /item=([0-9a-f-]{36})/.exec(href)?.[1] ?? /([0-9a-f-]{36})$/.exec(href)?.[1] ?? '');
    ctx.created.push(...ids.filter(Boolean));
    const contactHref = links.find((href) => href.includes('/crm/contacts/'));
    expect(contactHref, 'summary links to the contact 360').toBeTruthy();

    // Re-opening Convert now shows "Already converted", never the wizard again.
    await page.getByTestId('crm-convert-done').click();
    await expect(dialog).toBeHidden();
    await panel.getByTestId('crm-convert-lead').click();
    await expect(page.getByTestId('crm-convert-dialog').getByRole('heading', { name: 'Already converted' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('crm-convert-dialog').getByTestId('crm-convert-account')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Contact 360: account link, the new deal, and the conversion note.
    await gotoApp(page, contactHref as string);
    await expect(page.getByRole('heading', { name: leadName, level: 1 })).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('crm-record-header')).toContainText(company);
    await expect(page.getByTestId('crm-deals-card')).toContainText('New deal');

    // Log a call from the 360 view; it lands in the timeline.
    const subject = `Discovery call ${stamp}`;
    await page.getByTestId('crm-log-activity').click();
    const composer = page.getByTestId('crm-activity-composer');
    await expect(composer).toBeVisible();
    await composer.getByTestId('crm-activity-subject').fill(subject);
    await composer.getByTestId('crm-activity-notes').fill('Walked through the rollout plan.');
    await composer.getByTestId('crm-activity-submit').click();
    await expect(page.getByTestId('crm-timeline')).toContainText(subject, { timeout: 60_000 });
    await expect(page.getByText(/logged/i).first()).toBeVisible();

    const activities = await api<{ timeline: { itemId: string; title: string; source: string }[] }>(
      request,
      ctx.orgId,
      'GET',
      `/crm/contacts/${contactHref?.split('/').pop()}`,
    );
    const logged = activities.timeline.find((entry) => entry.title === subject && entry.source === 'activity');
    expect(logged, 'activity persisted').toBeTruthy();
    if (logged) ctx.created.push(logged.itemId);

    // Converting again shows the "already converted" state.
    const preview = await api<{ converted: unknown }>(request, ctx.orgId, 'GET', `/crm/leads/${lead.id}/conversion`);
    expect(preview.converted).not.toBeNull();
    expect(diagnostics.errors, 'console errors during conversion').toEqual([]);
  });

  test('parallel conversions of one lead: exactly one wins, the other gets 409', async ({ request }) => {
    const lead = await api<{ id: string }>(request, ctx.orgId, 'POST', `/boards/${ctx.leadsBoardId}/items`, {
      name: raceLead,
      values: { company: `Race Co ${stamp}` },
    });
    ctx.created.push(lead.id);
    const body = JSON.stringify({ account: { mode: 'new', name: `Race Co ${stamp}` }, contact: { mode: 'new', name: raceLead } });
    const post = () =>
      request.fetch(`/api/v1/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        timeout: 90_000,
        headers: { 'x-org-id': ctx.orgId, origin: baseUrl(), 'content-type': 'application/json' },
        data: body,
      });
    const responses = await Promise.all([post(), post()]);
    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([201, 409]);
    for (const response of responses) {
      const json = (await response.json()) as { ok: boolean; data?: { account: { id: string; created: boolean }; contact: { id: string } } };
      if (json.ok && json.data) ctx.created.push(json.data.contact.id, ...(json.data.account.created ? [json.data.account.id] : []));
    }
  });

  test('duplicates page scans contacts and accounts', async ({ page, diagnostics }) => {
    await gotoApp(page, `/${ctx.slug}/crm/duplicates`);
    await expect(page.getByRole('heading', { name: 'Duplicates', level: 1 })).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/Scanned \d+/)).toBeVisible({ timeout: 150_000 });
    // "Possible" (name-only) groups never start with records ticked for merging.
    const possible = page.locator('[data-testid="crm-duplicate-cluster"][data-confidence="medium"]');
    if ((await possible.count()) > 0) {
      await expect(possible.first().getByTestId('crm-merge')).toBeDisabled();
      await expect(possible.first().getByTestId('crm-duplicate-compare')).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Accounts' }).click();
    await expect(page).toHaveURL(/kind=accounts/);
    await expect(page.getByText(/Scanned \d+ account/)).toBeVisible({ timeout: 150_000 });
    expect(diagnostics.errors, 'console errors on duplicates').toEqual([]);
  });
});
