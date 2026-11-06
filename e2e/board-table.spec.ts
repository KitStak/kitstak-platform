/**
 * Board table — main flows on the seeded Deals board via /dev/board-table (resolves the
 * signed-in user's Deals board): render, inline add (focus kept) + rename + delete with Undo,
 * group collapse, selection + bulk bar, keyboard grid, Column Center, search empty state.
 * Every record the spec creates is deleted again.
 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';

const grid = (page: Page) => page.getByTestId('board-table');
const rowNamed = (page: Page, name: string) =>
  grid(page).getByTestId('item-row').filter({ hasText: name }).first();

async function openDeals(page: Page) {
  await page.goto('/dev/board-table', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(grid(page).getByTestId('item-row').first()).toBeVisible({ timeout: 100_000 });
}

/** axe-core run scoped to the table root; returns serious/critical violations only. */
async function axeViolations(page: Page) {
  await page.addScriptTag({ path: path.resolve('node_modules/axe-core/axe.min.js') });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run('[data-testid="board-table-root"]');
    return result.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation) => `${violation.impact} ${violation.id} x${violation.nodes.length} ${violation.nodes[0]?.target.join(' ')}`);
  });
}

// The dev server is shared by many agents; first compiles and loaded APIs can be slow.
test.describe.configure({ mode: 'default', timeout: 180_000 });

test.describe('board table', () => {
  test('renders grouped, virtualized rows with sticky name cells', async ({ page, diagnostics }) => {
    await openDeals(page);
    await expect(page.getByRole('grid')).toHaveAttribute('aria-multiselectable', 'true');
    await expect(grid(page).getByTestId('board-group').first()).toBeVisible();
    await expect(grid(page).getByTestId('column-header').first()).toBeVisible();
    // Virtualized: far fewer rows mounted than the board holds.
    const mounted = await grid(page).getByTestId('item-row').count();
    expect(mounted).toBeGreaterThan(5);
    expect(mounted).toBeLessThan(120);
    expect(diagnostics.errors).toEqual([]);
  });

  test('adds an item inline (focus stays), renames it, deletes it with Undo', async ({
    page,
    diagnostics,
  }) => {
    await openDeals(page);
    const name = `E2E deal ${Date.now()}`;
    // Collapse every group, then open the last one so its add row is mounted.
    await grid(page)
      .getByTestId('group-toggle')
      .first()
      .click({ modifiers: ['Shift'] });
    await expect(grid(page).getByTestId('item-row')).toHaveCount(0);
    await grid(page).locator('[data-collapsed="true"]').last().getByTestId('group-toggle').click();
    await grid(page).evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    const input = grid(page).getByTestId('add-item-input').first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill(name);
    await input.press('Enter');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    const row = rowNamed(page, name);
    await expect(row).toBeVisible();
    await expect(row).not.toHaveAttribute('data-pending', 'true', { timeout: 60_000 });

    // Inline rename: click the text, type, Enter.
    const itemId = await row.getAttribute('data-item-id');
    await row.locator('[data-name-text]').click();
    const nameInput = grid(page).locator(`[data-item-id="${itemId}"]`).getByTestId('name-input');
    await expect(nameInput).toBeFocused();
    await nameInput.fill(`${name} renamed`);
    await nameInput.press('Enter');
    const renamed = rowNamed(page, `${name} renamed`);
    await expect(renamed).toBeVisible();

    // Delete from the row menu, then Undo, then delete for good.
    await renamed.hover();
    await renamed.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(renamed).toBeHidden();
    const undo = page.getByRole('button', { name: 'Undo' }).last();
    await expect(undo).toBeVisible();
    await undo.click({ timeout: 30_000 });
    await expect(rowNamed(page, `${name} renamed`)).toBeVisible({ timeout: 15_000 });
    const again = rowNamed(page, `${name} renamed`);
    await again.hover();
    await again.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(rowNamed(page, `${name} renamed`)).toBeHidden();
    expect(diagnostics.errors).toEqual([]);
  });

  test('collapses a group into a summary row and expands it again', async ({ page, diagnostics }) => {
    await openDeals(page);
    const group = grid(page).getByTestId('board-group').first();
    const title = (await group.getByTestId('group-title').textContent()) ?? '';
    await group.getByTestId('group-toggle').click();
    const collapsed = grid(page)
      .locator('[data-testid="board-group"][data-collapsed="true"]')
      .filter({ hasText: title })
      .first();
    await expect(collapsed).toBeVisible();
    await expect(collapsed.getByTestId('cell-summary').first()).toBeVisible();
    await collapsed.getByTestId('group-toggle').click();
    await expect(
      grid(page)
        .locator('[data-testid="board-group"]:not([data-collapsed])')
        .filter({ hasText: title })
        .first(),
    ).toBeVisible();
    expect(diagnostics.errors).toEqual([]);
  });

  test('shift-click selects a range and the bulk bar reflects it', async ({ page, diagnostics }) => {
    await openDeals(page);
    const boxes = grid(page).getByTestId('row-checkbox');
    await boxes.nth(0).click();
    await boxes.nth(3).click({ modifiers: ['Shift'] });
    const bar = page.getByTestId('bulk-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('bulk-count')).toHaveText('4');
    await expect(grid(page).locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(4);
    await page.getByTestId('bulk-clear').click();
    await expect(bar).toBeHidden();
    expect(diagnostics.errors).toEqual([]);
  });

  test('keyboard grid: arrows move focus, Esc leaves the cell', async ({ page, diagnostics }) => {
    await openDeals(page);
    const firstRow = grid(page).getByTestId('item-row').first();
    const nameCell = firstRow.getByTestId('name-cell');
    await nameCell.focus();
    await page.keyboard.press('ArrowRight');
    const stage = firstRow.locator('[data-grid-col="2"] [data-ks-cell]');
    await expect(stage).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      grid(page).getByTestId('item-row').nth(1).locator('[data-grid-col="2"] [data-ks-cell]'),
    ).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(grid(page).getByTestId('item-row').nth(1).getByTestId('name-cell')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(grid(page)).toBeFocused();
    expect(diagnostics.errors).toEqual([]);
  });

  test('Column Center lists every type and searches', async ({ page, diagnostics }) => {
    await openDeals(page);
    await grid(page).getByTestId('add-column').first().click();
    await expect(page.getByTestId('column-quick-picker')).toBeVisible();
    await page.getByTestId('more-columns').click();
    const center = page.getByTestId('column-center');
    await expect(center).toBeVisible();
    await expect(center.getByTestId('column-type-status')).toBeVisible();
    await center.getByRole('searchbox').fill('rating');
    await expect(center.getByTestId('column-type-rating')).toBeVisible();
    await expect(center.getByTestId('column-type-status')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(center).toBeHidden();
    // Focus returns to the "+" trigger, not <body>.
    await expect(grid(page).getByTestId('add-column').first()).toBeFocused();
    expect(diagnostics.errors).toEqual([]);
  });

  test('grid has no serious or critical axe violations', async ({ page, diagnostics }) => {
    await openDeals(page);
    await expect(grid(page).locator('[data-skeleton]')).toHaveCount(0, { timeout: 30_000 });
    expect(await axeViolations(page)).toEqual([]);
    expect(diagnostics.errors).toEqual([]);
  });

  test('double-click rename fills the name cell and selects the whole name', async ({
    page,
    diagnostics,
  }) => {
    await openDeals(page);
    const row = grid(page).getByTestId('item-row').first();
    const original = (await row.locator('[data-name-text]').textContent()) ?? '';
    await row.locator('[data-name-text]').dblclick();
    const input = row.getByTestId('name-input');
    await expect(input).toBeFocused();
    await expect
      .poll(() => input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]))
      .toEqual([0, original.length]);
    const [cellBox, inputBox] = await Promise.all([
      row.getByTestId('name-cell').boundingBox(),
      input.boundingBox(),
    ]);
    expect(inputBox && cellBox ? inputBox.width / cellBox.width : 0).toBeGreaterThan(0.85);
    await input.press('Escape');
    await expect(row.locator('[data-name-text]')).toHaveText(original);
    expect(diagnostics.errors).toEqual([]);
  });

  test('adds a subitem optimistically, then deletes it', async ({ page, diagnostics }) => {
    await openDeals(page);
    const name = `E2E sub ${Date.now()}`;
    const parent = grid(page).getByTestId('item-row').first();
    await parent.hover();
    await parent.getByTestId('subitems-toggle').click();
    const input = grid(page).getByTestId('add-subitem-input').first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill(name);
    await input.press('Enter');
    const sub = grid(page).getByTestId('subitem-row').filter({ hasText: name }).first();
    // Optimistic: the row is there before the server answers.
    await expect(sub).toBeVisible({ timeout: 1_000 });
    await expect(sub).not.toHaveAttribute('data-pending', 'true', { timeout: 60_000 });
    await sub.hover();
    await sub.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(sub).toBeHidden();
    expect(diagnostics.errors).toEqual([]);
  });

  test('search narrows rows and shows a filtered-empty state', async ({ page, diagnostics }) => {
    await openDeals(page);
    const search = page.getByRole('searchbox', { name: 'Search this board' });
    await search.fill('zzzz-no-such-deal');
    await expect(page.getByTestId('filtered-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(grid(page).getByTestId('item-row').first()).toBeVisible();
    expect(diagnostics.errors).toEqual([]);
  });
});
