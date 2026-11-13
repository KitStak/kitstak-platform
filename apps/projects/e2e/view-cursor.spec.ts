import { expect, test, type Page } from '@playwright/test';

/** Sign in through the auth API (the trusted origin is the app's configured URL). */
async function signIn(page: Page) {
  const origin = process.env.E2E_AUTH_ORIGIN ?? 'http://localhost:3400';
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' },
    headers: { origin },
  });
  expect(response.ok()).toBeTruthy();
}

const focusedKey = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.taskKey ?? null);

test.describe('view cursor (j/k work the moment the page opens)', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('List: j on a fresh page focuses the first row with the brand ring', async ({ page }) => {
    await page.goto('/p/OPS/list');
    const rows = page.getByTestId('list-row');
    await expect(rows.first()).toBeVisible();
    const firstKey = await rows.first().getAttribute('data-task-key');
    await page.keyboard.press('j');
    expect(await focusedKey(page)).toBe(firstKey);
    await expect(rows.first()).toHaveAttribute('data-view-cursor', '');
    await page.keyboard.press('j');
    expect(await focusedKey(page)).toBe(await rows.nth(1).getAttribute('data-task-key'));
    await page.keyboard.press('k');
    expect(await focusedKey(page)).toBe(firstKey);
    // s opens the status picker on the cursor row without opening the task.
    await page.keyboard.press('s');
    await expect(page.getByRole('listbox').or(page.locator('[data-radix-popper-content-wrapper]')).first()).toBeVisible();
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
  });

  test('Board: j focuses a card, l moves to the next column', async ({ page }) => {
    await page.goto('/p/OPS/board');
    const cards = page.getByTestId('board-card');
    await expect(cards.first()).toBeVisible();
    await page.keyboard.press('j');
    const first = await focusedKey(page);
    expect(first).toBe(await cards.first().getAttribute('data-task-key'));
    await page.keyboard.press('l');
    const next = await focusedKey(page);
    expect(next).not.toBe(first);
    const column = await page.evaluate(() => document.activeElement?.closest('[data-testid="board-column"]')?.getAttribute('data-status-id') ?? null);
    const firstColumn = await cards.first().evaluate((card) => card.closest('[data-testid="board-column"]')?.getAttribute('data-status-id') ?? null);
    expect(column).not.toBe(firstColumn);
  });
});
