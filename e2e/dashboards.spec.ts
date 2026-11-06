/**
 * Dashboards, self-sufficient (no reliance on seeded list cards):
 *  1. A "sales cockpit" dashboard is created through the API → it renders data-rich widgets
 *     from one batched request → a date filter persists in the URL without shifting the grid →
 *     the settings panel reserves its space and closes with Esc → the layout moves with the
 *     keyboard and Ctrl+Z restores it.
 *  2. UI flow: create a dashboard with the wizard → add a widget (live preview, size preset)
 *     → rename → delete with Undo → delete the dashboard.
 */
import type { Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';

/** The shared dev server is busy (many agents compile and query at once): give UI assertions room. */
const ui = expect.configure({ timeout: 180_000 });

interface Fixture {
  readonly slug: string;
  readonly headers: Record<string, string>;
}

async function fixture(page: Page): Promise<Fixture> {
  const response = await getOk(page, '/api/v1/me', {});
  const me = (await response.json()) as { data: { organizations: { slug: string }[] } };
  const org = me.data.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.data.organizations[0];
  if (!org) throw new Error('No organization for the demo admin');
  return { slug: org.slug, headers: { 'x-org-id': org.slug, origin: new URL(page.url()).origin } };
}

/** The shared dev database occasionally times out a pooled connection: retry setup reads. */
async function getOk(page: Page, path: string, headers: Record<string, string>) {
  let response = await page.request.get(path, { headers, timeout: 120_000 });
  for (let attempt = 0; attempt < 3 && !response.ok(); attempt += 1) {
    await page.waitForTimeout(2_000);
    response = await page.request.get(path, { headers, timeout: 120_000 });
  }
  return response;
}

async function createSalesDashboard(page: Page, { headers }: Fixture): Promise<string> {
  const sources = await getOk(page, '/api/v1/dashboard-data/sources', headers);
  expect(sources.ok()).toBe(true);
  const boards = ((await sources.json()) as { data: { boards: { id: string; name: string }[] } }).data.boards;
  const deals = boards.find((board) => board.name === 'Deals') ?? boards[0];
  if (!deals) throw new Error('No board to build a dashboard from');
  const created = await page.request.post('/api/v1/dashboard-data/create', {
    headers,
    data: { name: `E2E cockpit ${Date.now()}`, boardIds: [deals.id], starter: 'sales', privacy: 'main' },
    timeout: 120_000,
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { data: { id: string } }).data.id;
}

async function deleteDashboard(page: Page, { headers }: Fixture, id: string): Promise<void> {
  await page.request.delete(`/api/v1/dashboards/${id}`, { headers, timeout: 120_000 }).catch(() => undefined);
}

/** Dashboards this spec creates are named with these prefixes; leftovers of killed runs are removed. */
const E2E_PREFIXES = ['E2E cockpit ', 'E2E dashboard '];

test.describe('dashboards', () => {
  test.describe.configure({ timeout: 480_000 });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json', baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    try {
      await page.goto('/', { waitUntil: 'commit', timeout: 120_000 });
      const env = await fixture(page);
      const list = await getOk(page, '/api/v1/dashboards', env.headers);
      if (!list.ok()) return;
      const dashboards = ((await list.json()) as { data: { id: string; name: string }[] }).data;
      for (const dashboard of dashboards.filter((entry) => E2E_PREFIXES.some((prefix) => entry.name.startsWith(prefix)))) {
        await deleteDashboard(page, env, dashboard.id);
      }
    } finally {
      await context.close();
    }
  });

  test('sales cockpit: batched data, URL filters, settings panel, keyboard layout + undo', async ({ page, diagnostics }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 120_000 });
    const env = await fixture(page);
    const id = await createSalesDashboard(page, env);
    try {
      const batches: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes(`/dashboard-data/${id}/batch`)) batches.push(request.url());
      });
      await page.goto(`/${env.slug}/dashboards/${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await ui(page.getByTestId('dashboard-page')).toBeVisible();
      const kpi = page.locator('[data-widget-kind="numbers"]').first();
      await ui(kpi.getByTestId('numbers-value')).toHaveText(/\d/);
      await ui(page.getByTestId('funnel-widget')).toBeVisible();
      await ui(page.getByTestId('forecast-widget')).toBeVisible();

      // Live: a widget added elsewhere (here through the API) appears without a reload.
      const before = await page.getByTestId('dashboard-widget').count();
      const added = await page.request.post(`/api/v1/dashboards/${id}/widgets`, {
        headers: env.headers,
        data: { type: 'text', title: 'Live note', config: { kind: 'text', text: 'Added from another session' }, x: 0, y: 200, w: 4, h: 2 },
        timeout: 120_000,
      });
      expect(added.status()).toBe(201);
      await ui(page.getByTestId('dashboard-widget')).toHaveCount(before + 1, { timeout: 60_000 });
      // Every data widget loaded through one batched request, not one request per widget.
      expect(batches.length).toBeGreaterThanOrEqual(1);
      expect(batches.length).toBeLessThanOrEqual(2);

      // A filter never reflows the toolbar or shifts the grid.
      const gridBefore = await page.getByTestId('dashboard-grid').boundingBox();
      await page.getByTestId('date-range-filter').click();
      await page.getByRole('option', { name: 'This quarter' }).click();
      await expect(page).toHaveURL(/range=this_quarter/);
      const gridAfter = await page.getByTestId('dashboard-grid').boundingBox();
      expect(Math.round(gridAfter?.y ?? 0)).toBe(Math.round(gridBefore?.y ?? 0));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
      await ui(page.getByTestId('date-range-filter')).toContainText('This quarter');
      await ui(kpi.getByTestId('numbers-value')).toBeVisible();

      // Settings panel: reserves its width (toolbar stays clickable) and closes with Esc.
      await kpi.hover();
      await kpi.getByRole('button', { name: 'Widget settings' }).click();
      const panel = page.getByTestId('widget-settings-panel');
      await ui(panel).toBeVisible();
      await expect(page.getByTestId('dashboard-page')).toHaveAttribute('data-settings-open', 'true');
      const present = await page.getByTestId('dashboard-present').boundingBox();
      const panelBox = await panel.boundingBox();
      expect((present?.x ?? 0) + (present?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(kpi.getByRole('button', { name: 'Widget settings' })).toBeFocused();

      // Keyboard move (Arrow) saves the layout; Ctrl+Z restores it.
      const header = kpi.locator('header');
      const firstTitle = (await kpi.getByRole('heading', { level: 3 }).textContent()) ?? '';
      const slotOf = () => page.locator('[data-grid-x]').filter({ has: page.getByRole('heading', { level: 3, name: firstTitle, exact: true }) }).first();
      const x = await slotOf().getAttribute('data-grid-x');
      await header.focus();
      const saved = page.waitForResponse((response) => response.url().includes('/layout') && response.request().method() === 'PUT', { timeout: 120_000 });
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
      expect((await saved).ok()).toBe(true);
      await expect(slotOf()).not.toHaveAttribute('data-grid-x', x ?? '0');
      const restored = page.waitForResponse((response) => response.url().includes('/layout') && response.request().method() === 'PUT', { timeout: 120_000 });
      await page.keyboard.press('Control+z');
      expect((await restored).ok()).toBe(true);
      await ui(slotOf()).toHaveAttribute('data-grid-x', x ?? '0');
      expect(diagnostics.errors, 'console errors on the dashboard').toEqual([]);
    } finally {
      await deleteDashboard(page, env, id);
    }
  });

  test('create a dashboard, add, rename and delete a widget', async ({ page, diagnostics }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 120_000 });
    const env = await fixture(page);
    const name = `E2E dashboard ${Date.now()}`;
    await page.goto(`/${env.slug}/dashboards`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await ui(page.getByTestId('new-dashboard')).toBeVisible();
    const create = page.getByTestId('create-dashboard-dialog');
    await expect(async () => {
      if (!(await create.isVisible())) await page.getByTestId('new-dashboard').click();
      await expect(create.getByLabel('Name')).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 180_000 });
    await create.getByLabel('Name').fill(name);
    await create.getByRole('button', { name: 'Next' }).click();
    await create.getByRole('checkbox', { name: /^Deals/ }).click({ timeout: 180_000 });
    await create.getByText('Blank canvas').click();
    await create.getByRole('button', { name: 'Create dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]{36}/, { timeout: 120_000 });
    const id = /\/dashboards\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    try {
      await ui(page.getByRole('heading', { level: 1 })).toContainText(name);

      // Add a Numbers widget through the gallery + configure step, Large size.
      await page.getByTestId('add-widget').click({ timeout: 90_000 });
      const wizard = page.getByTestId('add-widget-dialog');
      await wizard.getByTestId('widget-tile-numbers').click();
      await ui(wizard.getByRole('region', { name: 'Live preview' }).getByTestId('numbers-value')).toHaveText(/\d/);
      await wizard.getByTestId('widget-size').getByRole('radio', { name: 'Large' }).click();
      await wizard.getByTestId('add-widget-confirm').click();
      await ui(wizard).toBeHidden();
      // Focus returns to the Add widget button.
      await expect(page.getByTestId('add-widget').locator('xpath=ancestor::button[1]')).toBeFocused();
      const widget = page.getByTestId('dashboard-widget').first();
      // Seeded from the preview: data shows without a skeleton round trip.
      await ui(widget.getByTestId('numbers-value')).toHaveText(/\d/);
      await expect(page.locator('[data-grid-w]').first()).not.toHaveAttribute('data-grid-w', '3');

      // Rename inline.
      await widget.getByRole('heading', { level: 3 }).dblclick();
      await widget.getByLabel('Widget title').fill('Pipeline total');
      await widget.getByLabel('Widget title').press('Enter');
      await ui(widget.getByRole('heading', { level: 3 })).toHaveText('Pipeline total');

      // Delete, then Undo.
      await widget.hover();
      await widget.getByTestId('widget-menu').click();
      await page.getByRole('menuitem', { name: 'Delete widget' }).click();
      await ui(page.getByTestId('dashboard-widget')).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo' }).click({ timeout: 180_000 });
      await ui(page.getByTestId('dashboard-widget')).toHaveCount(1);

      // Delete the dashboard from its menu.
      await page.getByTestId('dashboard-menu').click();
      await page.getByRole('menuitem', { name: 'Delete dashboard' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete dashboard' }).click();
      await expect(page).toHaveURL(new RegExp(`/${env.slug}/dashboards$`), { timeout: 120_000 });
      expect(diagnostics.errors, 'console errors in the widget flow').toEqual([]);
    } finally {
      if (id) await deleteDashboard(page, env, id);
    }
  });
});
