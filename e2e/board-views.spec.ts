/**
 * Board views on the seeded Deals board (/dev/views/<boardId>): Kanban drag between lanes
 * persists and rolls back cleanly, Calendar / Timeline / Chart render with live data and
 * drill-down, and a published Form accepts a public, logged-out submission.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';

interface Envelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

async function demoContext(request: APIRequestContext): Promise<{ orgId: string; boardId: string }> {
  const me = (await (await request.get('/api/v1/me', { timeout: 90_000 })).json()) as Envelope<{ organizations: { id: string; slug: string }[] }>;
  const org = me.data.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.data.organizations[0];
  if (!org) throw new Error('No organization for the demo admin');
  const boards = (await (await request.get('/api/v1/boards', { headers: { 'x-org-id': org.id }, timeout: 90_000 })).json()) as Envelope<{ id: string; name: string }[]>;
  const deals = boards.data.find((board) => board.name === 'Deals');
  if (!deals) throw new Error('Seeded Deals board not found');
  return { orgId: org.id, boardId: deals.id };
}

async function openView(page: Page, boardId: string, type: string) {
  await page.goto(`/dev/views/${boardId}?type=${type}`, { timeout: 150_000, waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('views-workbench')).toBeVisible({ timeout: 90_000 });
  const view = page.getByTestId(`${type}-view`);
  await expect(view).toBeVisible({ timeout: 180_000 });
  // The shared dev server can be slow under load: wait for the board payload, not just the frame.
  await expect(view).not.toHaveAttribute('aria-busy', 'true', { timeout: 180_000 });
}

test.describe('board views', () => {
  test.describe.configure({ timeout: 420_000, mode: 'serial' });

  test('kanban: lanes with totals, drag a card to another lane and back', async ({ page, request, diagnostics }) => {
    const { boardId } = await demoContext(request);
    await openView(page, boardId, 'kanban');
    const lanes = page.getByTestId('kanban-lane');
    await expect(lanes.first()).toBeVisible();
    await expect(page.getByTestId('kanban-lane-totals').first()).toContainText('$');

    const source = page.locator('[data-testid="kanban-lane"][data-lane-id="lead"]');
    const target = page.locator('[data-testid="kanban-lane"][data-lane-id="discovery"]');
    const card = source.getByTestId('kanban-card').first();
    const cardId = await card.getAttribute('data-card-id');
    expect(cardId).toBeTruthy();
    const beforeTarget = Number(await target.getByTestId('kanban-lane-count').innerText());

    const dragTo = async (from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) => {
      const a = await from.boundingBox();
      const b = await to.boundingBox();
      if (!a || !b) throw new Error('missing boxes');
      await page.mouse.move(a.x + a.width / 2, a.y + 20);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + 28, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2, b.y + 120, { steps: 16 });
      await page.mouse.up();
    };

    await dragTo(card, target);
    const moved = target.locator(`[data-card-id="${cardId}"]`);
    await expect(moved).toBeVisible();
    await expect(target.getByTestId('kanban-lane-count')).toHaveText(String(beforeTarget + 1));

    // Persisted after reload.
    await page.reload({ timeout: 150_000, waitUntil: 'domcontentloaded' });
    await expect(page.locator(`[data-testid="kanban-lane"][data-lane-id="discovery"] [data-card-id="${cardId}"]`)).toBeVisible({ timeout: 60_000 });

    // Move it back (keeps seed data stable).
    await dragTo(page.locator(`[data-card-id="${cardId}"]`), page.locator('[data-testid="kanban-lane"][data-lane-id="lead"]'));
    await expect(page.locator(`[data-testid="kanban-lane"][data-lane-id="lead"] [data-card-id="${cardId}"]`)).toBeVisible();

    // Settings popover opens with the divide-by control.
    await page.getByTestId('view-settings-trigger').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await expect(page.getByTestId('kanban-divide-by')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(diagnostics.errors, 'console errors on kanban').toEqual([]);
  });

  test('kanban: keyboard drag moves a card to the next lane; card menu moves it back', async ({ page, request, diagnostics }) => {
    const { boardId } = await demoContext(request);
    await openView(page, boardId, 'kanban');
    const lead = page.locator('[data-testid="kanban-lane"][data-lane-id="lead"]');
    const discovery = page.locator('[data-testid="kanban-lane"][data-lane-id="discovery"]');
    const card = lead.getByTestId('kanban-card').first();
    const cardId = await card.getAttribute('data-card-id');
    expect(cardId).toBeTruthy();

    await card.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.press('Space');
    await expect(discovery.locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 30_000 });

    // Menu alternative: "Move to → Lead".
    const moved = discovery.locator(`[data-card-id="${cardId}"]`);
    await moved.hover();
    await moved.locator('[data-card-menu]').click();
    await page.getByTestId('kanban-card-move').click();
    await page.getByTestId('kanban-card-move-target').filter({ hasText: 'Lead' }).click();
    await expect(lead.locator(`[data-card-id="${cardId}"]`)).toBeVisible({ timeout: 30_000 });
    // Cards are light: one tab stop per card, fields are mounted as display values.
    await expect(lead.locator(`[data-card-id="${cardId}"] [data-ks-cell] input`)).toHaveCount(0);
    expect(diagnostics.errors, 'console errors on kanban keyboard').toEqual([]);
  });

  test('form builder: fast typing coalesces into one PATCH and keeps every character', async ({ page, request, diagnostics }) => {
    const { boardId } = await demoContext(request);
    await openView(page, boardId, 'form');
    const title = page.getByTestId('form-title');
    const original = await title.inputValue();
    const patches: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/api\/v1\/views\//.test(req.url())) patches.push(req.postData() ?? '');
    });
    const typed = 'Critic intake form';
    await title.fill('');
    await title.pressSequentially(typed, { delay: 25 });
    await expect.poll(() => patches.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    expect(patches.length, 'debounced to a couple of PATCHes at most').toBeLessThanOrEqual(2);
    expect(patches.at(-1)).toContain(typed);
    expect(patches.at(-1), 'server-owned keys are never sent').not.toMatch(/"(token|published|responseCount)"/);
    await page.reload({ timeout: 150_000, waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('form-title')).toHaveValue(typed, { timeout: 90_000 });
    await page.getByTestId('form-title').fill(original);
    await page.waitForTimeout(1200);
    expect(diagnostics.errors, 'console errors on form builder').toEqual([]);
  });

  test('form token cannot be forged through the view PATCH', async ({ page, request }) => {
    const { boardId, orgId } = await demoContext(request);
    await page.goto('/dev/views/' + boardId + '?type=form', { timeout: 150_000, waitUntil: 'domcontentloaded' });
    const origin = new URL(page.url()).origin;
    const views = (await (await request.get(`/api/v1/boards/${boardId}/views`, { headers: { 'x-org-id': orgId }, timeout: 90_000 })).json()) as Envelope<{ id: string; type: string; config: { form?: { token?: string } } }[]>;
    const form = views.data.find((view) => view.type === 'form');
    expect(form).toBeTruthy();
    if (!form) return;
    const before = form.config.form?.token ?? null;
    const forged = 'A'.repeat(43);
    const res = await request.patch(`/api/v1/views/${form.id}`, {
      headers: { 'x-org-id': orgId, origin },
      data: { config: { form: { token: forged, published: true, responseCount: 0 } } },
    });
    expect(res.ok()).toBeTruthy();
    const after = ((await res.json()) as Envelope<{ config: { form?: { token?: string } } }>).data.config.form?.token ?? null;
    expect(after).toBe(before);
    const anon = await request.get(`/api/v1/public-forms/${forged}`, { headers: { cookie: '' } });
    expect(anon.status()).toBe(404);
    const malformed = await request.get('/api/v1/public-forms/short', { headers: { cookie: '' } });
    expect(malformed.status()).toBe(404);
  });

  test('calendar, timeline and chart render data with drill-down', async ({ page, request, diagnostics }) => {
    const { boardId } = await demoContext(request);
    await openView(page, boardId, 'calendar');
    await page.getByRole('radio', { name: 'Month' }).click(); // the range mode persists per view
    await expect(page.getByTestId('calendar-month')).toBeVisible();
    await expect(page.getByTestId('calendar-event').first()).toBeVisible();
    await page.getByRole('radio', { name: 'Week' }).click();
    await expect(page.getByTestId('calendar-week')).toBeVisible();
    await page.getByTestId('unscheduled-toggle').click();
    await expect(page.getByTestId('unscheduled-tray')).toBeVisible();

    await page.getByTestId('view-tab-timeline').click();
    await expect(page.getByTestId('timeline-view')).toBeVisible();
    await expect(page.getByTestId('timeline-bar').first()).toBeVisible();
    await expect(page.getByTestId('timeline-today')).toBeVisible();
    await page.getByRole('radio', { name: 'Months' }).click();
    await expect(page.getByRole('radio', { name: 'Months' })).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('view-tab-chart').click();
    await expect(page.getByTestId('chart-view')).toBeVisible();
    const bar = page.locator('[data-testid="chart-canvas"] .recharts-bar-rectangle path, [data-testid="chart-canvas"] .recharts-sector').first();
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await bar.click({ force: true });
    await expect(page.getByTestId('chart-drilldown')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(diagnostics.errors, 'console errors on calendar/timeline/chart').toEqual([]);
  });

  test('form: publish, submit publicly as a visitor, then clean up', async ({ page, request, browser, diagnostics }) => {
    const { boardId, orgId } = await demoContext(request);
    await openView(page, boardId, 'form');
    await expect(page.getByTestId('form-outline')).toBeVisible();
    await page.getByTestId('form-share').click();
    const publish = page.getByTestId('form-publish');
    if ((await publish.getAttribute('data-state')) !== 'checked') await publish.click();
    const link = page.getByTestId('form-link');
    await expect(link).toHaveValue(/\/forms\/[A-Za-z0-9_-]{32,}/);
    const url = await link.inputValue();
    await page.keyboard.press('Escape');

    const name = `E2E form response ${Date.now()}`;
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const publicPage = await visitor.newPage();
    await publicPage.goto(url, { timeout: 150_000, waitUntil: 'domcontentloaded' });
    await expect(publicPage.getByTestId('public-form')).toBeVisible({ timeout: 60_000 });
    // Required validation first.
    await publicPage.waitForTimeout(1500); // the time trap rejects sub-second submissions
    await publicPage.getByTestId('form-submit').click();
    await expect(publicPage.getByRole('alert').first()).toBeVisible();
    await publicPage.locator('#q-name').fill(name);
    await publicPage.getByTestId('form-submit').click();
    await expect(publicPage.getByTestId('form-success')).toBeVisible({ timeout: 30_000 });
    await visitor.close();

    const items = (await (await request.get(`/api/v1/boards/${boardId}/items`, { params: { q: name }, headers: { 'x-org-id': orgId }, timeout: 90_000 })).json()) as Envelope<{ id: string; name: string }[]>;
    const created = items.data.find((entry) => entry.name === name);
    expect(created, 'public submission created an item').toBeTruthy();
    if (created) await request.delete(`/api/v1/items/${created.id}`, { headers: { 'x-org-id': orgId, origin: new URL(page.url()).origin } });
    expect(diagnostics.errors, 'console errors on form').toEqual([]);
  });

  test('files: gallery renders its empty or populated state', async ({ page, request, diagnostics }) => {
    const { boardId } = await demoContext(request);
    await openView(page, boardId, 'files');
    await expect(page.getByTestId('files-grid').or(page.getByText('No files yet'))).toBeVisible({ timeout: 30_000 });
    expect(diagnostics.errors, 'console errors on files').toEqual([]);
  });
});
