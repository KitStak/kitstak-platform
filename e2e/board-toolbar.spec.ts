/**
 * Board page composition on the seeded Deals board: header + tabs + toolbar render, search and
 * quick filters apply live with chips and a "Save to this view" indicator, the unsaved state is
 * shareable through the URL (survives reload), Group by regroups the table, the board menu and
 * activity drawer open, and a view can be added and deleted again (with Undo offered).
 * The spec never saves to an existing view, so shared seed data stays untouched.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';

interface Envelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

async function dealsBoard(request: APIRequestContext): Promise<{ slug: string; boardId: string }> {
  const me = (await (await request.get('/api/v1/me', { timeout: 90_000 })).json()) as Envelope<{
    organizations: { id: string; slug: string }[];
  }>;
  const org = me.data.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.data.organizations[0];
  if (!org) throw new Error('No organization for the demo admin');
  const boards = (await (
    await request.get('/api/v1/boards', { headers: { 'x-org-id': org.id }, timeout: 90_000 })
  ).json()) as Envelope<{ id: string; name: string }[]>;
  const deals = boards.data.find((board) => board.name === 'Deals');
  if (!deals) throw new Error('Seeded Deals board not found');
  return { slug: org.slug, boardId: deals.id };
}

async function openBoard(page: Page, url: string) {
  await page.goto(url, { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('board-toolbar')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('board-table')).toBeVisible({ timeout: 180_000 });
}

test.describe('board page: header, tabs and toolbar', () => {
  test.describe.configure({ timeout: 720_000, mode: 'serial' });

  test('search, quick filter, URL state, group by, menus', async ({ page, request, diagnostics }) => {
    const { slug, boardId } = await dealsBoard(request);
    const boardUrl = `/${slug}/boards/${boardId}`;
    await openBoard(page, boardUrl);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Deals');
    await expect(page.getByRole('grid').first()).toBeVisible();
    await expect(page.getByTestId('view-tab').first()).toBeVisible();
    await expect(page.getByTestId('board-breadcrumb')).toBeVisible();

    // Search applies live, shows a chip and lands in the URL.
    await page.getByTestId('board-search').fill('Meridian');
    await expect(page.getByTestId('filter-chip').first()).toContainText('Meridian');
    await expect(page).toHaveURL(/[?&]q=Meridian/, { timeout: 10_000 });
    await page.getByTestId('clear-filters').click();
    await expect(page.getByTestId('filter-chips')).toHaveCount(0);

    // Quick filter: a chip with a count, the button turns active, "Save to this view" appears.
    await page.getByTestId('toolbar-filter').click();
    const popover = page.getByTestId('filter-popover');
    await expect(popover).toBeVisible();
    await popover.getByTestId('quick-filter-chip').filter({ hasText: 'Negotiation' }).first().click();
    await expect(popover.getByTestId('filter-result-count')).not.toContainText(/Showing (\d+) of \1 /);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(page.getByTestId('toolbar-filter')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('filter-chip').filter({ hasText: 'Stage is Negotiation' })).toBeVisible();
    await expect(page.getByTestId('save-to-view')).toBeVisible();
    await expect(page).toHaveURL(/[?&]vs=/, { timeout: 10_000 });

    // The unsaved state is shareable: a reload reproduces it from the URL.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('board-toolbar')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('filter-chip').filter({ hasText: 'Stage is Negotiation' })).toBeVisible({ timeout: 60_000 });

    // Group by Owner regroups the table into person buckets.
    await page.getByTestId('toolbar-group-by').click();
    await page.getByTestId('group-by-popover').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Owner' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('board-table')).toHaveAttribute('data-grouped-by', 'owner');
    await expect(page.getByTestId('board-group').first()).toBeVisible();

    // Reset returns to the saved view.
    await page.getByTestId('reset-view').click();
    await expect(page.getByTestId('save-to-view')).toHaveCount(0);
    await expect(page.getByTestId('filter-chips')).toHaveCount(0);
    await expect(page.getByTestId('board-table')).not.toHaveAttribute('data-grouped-by', /.+/);

    // Board menu and activity drawer.
    await page.getByTestId('board-menu-trigger').click();
    await expect(page.getByTestId('board-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Activity log' }).click();
    const activity = page.getByTestId('board-activity');
    await expect(activity).toBeVisible();
    await expect(activity.getByTestId('activity-row').first()).toBeVisible({ timeout: 180_000 });
    await page.keyboard.press('Escape');
    await expect(activity).toBeHidden();

    expect(diagnostics.errors, 'console errors on the board page').toEqual([]);
  });

  test('adds a view from the + menu and deletes it again', async ({ page, request, diagnostics }) => {
    const { slug, boardId } = await dealsBoard(request);
    await openBoard(page, `/${slug}/boards/${boardId}`);
    const before = await page.getByTestId('view-tab').count();

    await page.getByTestId('add-view-trigger').click();
    await page.getByTestId('add-view-files').click();
    const nameInput = page.getByTestId('view-name-input');
    await expect(nameInput).toBeVisible({ timeout: 60_000 });
    const name = `E2E files ${Date.now()}`;
    await nameInput.fill(name);
    await nameInput.press('Enter');
    const tab = page.getByTestId('view-tab').filter({ hasText: name });
    await expect(tab).toHaveAttribute('data-active', 'true', { timeout: 60_000 });
    await expect(page).toHaveURL(/[?&]view=/);

    await tab.getByTestId('view-tab-menu').click();
    await page.getByTestId('view-tab-delete').click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByTestId('view-tab').filter({ hasText: name })).toHaveCount(0);
    await expect(page.getByTestId('view-tab')).toHaveCount(before);
    await expect(page.getByTestId('board-table')).toBeVisible();

    expect(diagnostics.errors, 'console errors while managing views').toEqual([]);
  });
});
