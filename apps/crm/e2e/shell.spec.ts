/**
 * Shell module: home page, ⌘K palette record search, top bar Workspaces menu, tree "…" menu
 * with inline rename (restored afterwards), workspace overview, 404 without console errors.
 */
import type { Page } from '@playwright/test';
import { appShell, authedTest, expect, openWorkspacesMenu, waitForSettled } from './support/fixtures';

async function orgBase(page: Page): Promise<string> {
  await page.goto('/');
  await expect(appShell(page)).toBeVisible({ timeout: 150_000 });
  const slug = new URL(page.url()).pathname.split('/').filter(Boolean)[0];
  return `/${slug}`;
}

/** The browser's own line for a 404 document; expected on not-found specs, not an app defect. */
const DOCUMENT_404 = /Failed to load resource: the server responded with a status of 404/;

authedTest.describe('shell', () => {
  // The shared dev server compiles routes on demand under heavy load: allow slow navigations so
  // compile time does not mask real regressions.
  authedTest.describe.configure({ timeout: 420_000 });
  authedTest.use({ navigationTimeout: 150_000, actionTimeout: 60_000 });

  authedTest('home renders recents, my work, updates and quick actions', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /recently visited/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /my work due this week/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /latest updates/i })).toBeVisible();
    await expect(page.getByTestId('home-quick-actions').getByRole('button', { name: /new board/i })).toBeVisible();
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('palette finds records with breadcrumb and status, keystrokes are not dropped', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await page.keyboard.press('Control+K');
    await page.keyboard.type('beacon', { delay: 0 }); // typed immediately after opening
    const palette = page.getByTestId('command-palette');
    await expect(palette.getByRole('combobox')).toHaveValue('beacon');
    await expect(palette.getByText('Items', { exact: true })).toBeVisible();
    const first = palette.getByTestId('palette-item').first();
    await expect(first).toContainText(/beacon/i);
    await expect(first.locator('mark').first()).toHaveText(/beacon/i);

    await page.keyboard.press('Control+A');
    await page.keyboard.type('zzqxv-no-such-thing');
    await expect(palette.getByTestId('palette-empty')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('the Workspaces menu reaches boards and Ctrl+\\ toggles it', async ({ page }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    const menu = await openWorkspacesMenu(page);
    const tree = menu.getByTestId('workspace-tree');
    await expect(tree).toBeVisible({ timeout: 30_000 });
    if ((await tree.getByTestId('sidebar-board-link').count()) === 0) {
      await tree.getByTestId('sidebar-folder').first().click(); // boards may all live in folders
    }
    await expect(tree.getByTestId('sidebar-board-link').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.keyboard.press('Control+\\');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Control+\\');
    await expect(menu).toBeHidden();
  });

  authedTest('board menu has full actions and rename works inline', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await openWorkspacesMenu(page);
    const tree = page.getByTestId('workspace-tree');
    await expect(tree).toBeVisible({ timeout: 30_000 });
    if ((await tree.getByTestId('sidebar-board-link').count()) === 0) {
      await tree.getByTestId('sidebar-folder').first().click(); // boards may all live in folders
    }
    const row = tree.getByTestId('sidebar-board-link').first();
    await expect(row).toBeVisible();
    const original = (await row.innerText()).trim();
    await row.hover();
    await page.getByRole('button', { name: `More actions for ${original}` }).click();
    const menu = page.getByRole('menu');
    for (const label of ['Open in new tab', 'Rename', 'Duplicate', 'Move to', 'Copy link', 'Archive', 'Delete']) {
      await expect(menu.getByRole('menuitem', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await menu.getByRole('menuitem', { name: /^Rename/ }).click();
    const field = page.getByRole('textbox', { name: 'Name' });
    await field.fill(`${original} (e2e)`);
    await field.press('Enter');
    const renamed = page.getByTestId('workspace-tree').getByText(`${original} (e2e)`);
    await expect(renamed).toBeVisible();

    // Restore the seed name.
    await renamed.dblclick();
    await page.getByRole('textbox', { name: 'Name' }).fill(original);
    await page.getByRole('textbox', { name: 'Name' }).press('Enter');
    await expect(page.getByTestId('workspace-tree').getByText(original, { exact: true })).toBeVisible();
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('drag a board into a folder, then move it back with the menu', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await openWorkspacesMenu(page);
    const tree = page.getByTestId('workspace-tree');
    const rootBoards = tree.locator('[data-testid="sidebar-board-link"]:not([data-nested] *)');
    const folder = tree.getByTestId('sidebar-folder').first();
    authedTest.skip((await rootBoards.count()) === 0 || (await folder.count()) === 0, 'needs a root board and a folder');
    const source = rootBoards.first();
    const name = (await source.innerText()).trim();
    const boardId = (await source.getAttribute('href'))?.split('/').pop() ?? '';
    const orgId = await page.evaluate(async () => {
      const response = await fetch('/api/v1/me');
      const body = (await response.json()) as { data: { organizations: { id: string }[] } };
      return body.data.organizations[0]?.id ?? '';
    });
    const restore = () =>
      page.request.patch(`/api/v1/boards/${boardId}`, {
        headers: { 'x-org-id': orgId, origin: new URL(page.url()).origin },
        data: { folderId: null },
      });
    const from = await source.boundingBox();
    const to = await folder.boundingBox();
    if (!from || !to) throw new Error('rows not laid out');
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2 - 10, { steps: 4 });
    await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    // It left the root list (now inside the folder).
    try {
      await expect(tree.locator('[data-testid="sidebar-board-link"]:not([data-nested] *)', { hasText: name })).toHaveCount(0);
    } catch (error) {
      await restore();
      throw error;
    }

    // Move it back to the root through the menu (keyboard-accessible path).
    const moved = tree.getByTestId('sidebar-board-link').filter({ hasText: name }).first();
    await expect(moved).toBeVisible();
    await moved.hover();
    await page.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Move to' }).click();
    await page.getByRole('menuitem', { name: 'Workspace root' }).click();
    try {
      await expect(tree.locator('[data-testid="sidebar-board-link"]:not([data-nested] *)', { hasText: name })).toHaveCount(1);
    } finally {
      await restore(); // idempotent: guarantees the seed layout for other specs
    }
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('workspace overview lists content with filters', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await openWorkspacesMenu(page);
    await page.getByTestId('workspace-menu').first().click();
    await page.getByRole('menuitem', { name: 'Workspace overview' }).click();
    await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 120_000 });
    await waitForSettled(page, 120_000);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
    const rows = page.getByTestId('workspace-content-row');
    await expect(rows.first()).toBeVisible();
    await page.getByRole('radio', { name: 'Folders' }).click();
    await expect(rows.first()).toContainText(/item/);
    await page.getByRole('tab', { name: /members/i }).click();
    await expect(page.getByRole('heading', { name: /members/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/tab=members/);
    await expect(page).toHaveURL(/type=folder/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /members/i })).toHaveAttribute('aria-selected', 'true', { timeout: 150_000 });
    await expect(page.getByLabel(/workspace role for/i).first()).toBeVisible();
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('unknown routes return a real 404 without React script warnings', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    const response = await page.goto(`${base}/definitely-not-a-page`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/couldn't find that page/i)).toBeVisible();
    const scriptWarnings = diagnostics.errors.filter((error) => /script tag/i.test(error));
    expect(scriptWarnings).toEqual([]);
    expect(diagnostics.errors.filter((error) => !DOCUMENT_404.test(error))).toEqual([]);
  });

  authedTest('workspace ids that do not exist are real 404s; unknown API paths answer JSON', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    expect((await page.goto(`${base}/workspaces/not-a-uuid`))?.status()).toBe(404);
    expect((await page.goto(`${base}/workspaces/00000000-0000-4000-8000-000000000000`))?.status()).toBe(404);
    const api = await page.request.get('/api/v1/shell/no-such-endpoint');
    expect(api.status()).toBe(404);
    expect(await api.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(diagnostics.errors.filter((error) => !DOCUMENT_404.test(error))).toEqual([]);
  });

  authedTest('route progress bar shows during a slow sidebar navigation', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    await openWorkspacesMenu(page);
    const link = page.getByTestId('workspace-tree').getByTestId('sidebar-board-link').first();
    await expect(link).toBeVisible({ timeout: 60_000 });
    await page.route(/_rsc=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue().catch(() => undefined);
    });
    await link.click();
    await expect(page.getByTestId('route-progress')).toBeVisible({ timeout: 1200 });
    await page.waitForURL(/\/boards\//);
    await page.unroute(/_rsc=/);
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('palette never opens a stale result while a new query loads; focus returns on close', async ({ page, diagnostics }) => {
    await orgBase(page);
    await waitForSettled(page, 120_000);
    const trigger = page.getByTestId('topbar-search');
    await trigger.click();
    const palette = page.getByTestId('command-palette');
    await page.keyboard.type('sales');
    await expect(palette.getByTestId('palette-item').first()).toBeVisible({ timeout: 60_000 });
    let released = false;
    await page.route(/shell\/search\?.*q=leads/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      released = true;
      await route.continue().catch(() => undefined);
    });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('leads');
    await page.waitForTimeout(300);
    // Rows of the old "sales" query that do not match "leads" are gone while the request is in flight.
    for (const text of await palette.getByTestId('palette-item').allInnerTexts()) expect(text).toMatch(/lead/i);
    const before = page.url();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before); // waits for the fresh results instead of acting on stale rows
    await page.waitForURL((url) => url.href !== before, { timeout: 90_000 });
    expect(released).toBe(true);
    await page.unroute(/shell\/search/);

    await orgBase(page);
    await waitForSettled(page, 120_000);
    await page.getByTestId('topbar-search').click();
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page.getByTestId('topbar-search')).toBeFocused();
    expect(diagnostics.errors).toEqual([]);
  });

  authedTest('g-chords navigate from my work and inbox', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/my-work`);
    await expect(page.locator('#main-content')).toBeVisible(); // other modules' pages: no settle gate
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await page.waitForURL(/\/inbox/, { timeout: 120_000 });
    await expect(page.locator('#main-content')).toBeVisible(); // other modules' pages: no settle gate
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.waitForURL((url) => url.pathname === base, { timeout: 120_000 });
    expect(diagnostics.errors).toEqual([]);
  });
});
