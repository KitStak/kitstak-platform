/**
 * Notifications panel, Inbox and My work main flows. Every mutation is reverted at the end of
 * its test so the shared seed data stays as it was.
 */
import type { Page } from '@playwright/test';
import { appShell, authedTest, expect, waitForSettled } from './support/fixtures';

async function orgBase(page: Page): Promise<string> {
  await page.goto('/');
  await expect(appShell(page)).toBeVisible({ timeout: 120_000 });
  const slug = new URL(page.url()).pathname.split('/').filter(Boolean)[0];
  expect(slug, 'org slug after redirect').toBeTruthy();
  return `/${slug}`;
}

async function badgeCount(page: Page): Promise<number> {
  const label = (await page.getByTestId('notifications-bell').getAttribute('aria-label')) ?? '';
  const match = /\((\d+) unread\)/.exec(label);
  return match ? Number(match[1]) : 0;
}

// The shared dev server is under load from parallel agents: allow generous time.
authedTest.describe.configure({ timeout: 240_000 });
authedTest.use({ navigationTimeout: 150_000 });

authedTest.describe('notifications panel', () => {
  authedTest(
    'opens in place from the bell, filters and toggles read state',
    async ({ page, diagnostics }) => {
      const base = await orgBase(page);
      const url = page.url();
      const bell = page.getByTestId('notifications-bell');
      await expect(bell).toHaveAttribute('aria-expanded', 'false');
      await bell.click();

      const panel = page.getByTestId('notifications-panel');
      await expect(panel).toBeVisible();
      await expect(bell).toHaveAttribute('aria-expanded', 'true');
      expect(page.url(), 'panel opens without a route change').toBe(url);
      await expect(panel.getByRole('heading', { name: 'Notifications' })).toBeVisible();
      const rows = panel.getByTestId('notification-row');
      await expect(rows.first()).toBeVisible({ timeout: 120_000 });

      // Deep links open the item panel in context.
      const itemLink = panel.locator('[data-notification-link][href*="?item="]').first();
      await expect(itemLink).toBeVisible();
      expect(await itemLink.getAttribute('href')).toMatch(new RegExp(`^${base}/boards/[0-9a-f-]+\\?item=`));

      // Unread tab only lists unread rows.
      await panel.getByTestId('notifications-tab-unread').click();
      const unreadRows = panel.locator('[data-testid="notification-row"][data-unread]');
      await expect(unreadRows.first()).toBeVisible();
      expect(await panel.locator('[data-testid="notification-row"]:not([data-unread])').count()).toBe(0);
      // A single (unfolded) row: folded "+N similar" rows mark their whole run.
      const singleRows = panel.locator(
        '[data-testid="notification-row"][data-unread]:not(:has([data-testid="notification-similar"]))',
      );

      // Mark one read (optimistic badge update), then restore it.
      const before = await badgeCount(page);
      const target = singleRows.first();
      const id = await target.getAttribute('data-notification-id');
      await target.hover();
      const markResponse = page.waitForResponse((res) => res.url().includes('/api/v1/notifications/read'));
      await target.getByTestId('notification-toggle-read').click();
      await expect.poll(() => badgeCount(page)).toBe(before - 1);
      await markResponse;
      const row = panel.locator(`[data-notification-id="${id}"]`);
      await expect(row).not.toHaveAttribute('data-unread');
      await row.hover();
      const restoreResponse = page.waitForResponse((res) => res.url().includes('/api/v1/notifications/read'));
      await row.getByTestId('notification-toggle-read').click();
      await expect.poll(() => badgeCount(page)).toBe(before);
      expect((await restoreResponse).ok()).toBe(true);

      // Delete from the row menu (keyboard): focus lands on the next row, Undo puts it back
      // (the delete is only sent after the Undo window, so the seed data is untouched).
      await panel.getByTestId('notifications-tab-all').click();
      const firstRow = rows.first();
      const deletedId = await firstRow.getAttribute('data-notification-id');
      const nextId = await rows.nth(1).getAttribute('data-notification-id');
      await firstRow.locator('[data-notification-link]').focus();
      await page.keyboard.press('ArrowRight'); // mark read/unread
      await page.keyboard.press('ArrowRight'); // more actions
      await expect(firstRow.getByTestId('notification-more')).toBeFocused();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Delete notification' }).click();
      await expect(panel.locator(`[data-notification-id="${deletedId}"]`)).toHaveCount(0);
      await expect(
        panel.locator(`[data-notification-id="${nextId}"] [data-notification-link]`),
        'focus moves to the neighbouring row',
      ).toBeFocused();
      await page.locator('[data-sonner-toast]').filter({ hasText: 'Notification deleted' }).getByRole('button', { name: 'Undo' }).click();
      await expect(panel.locator(`[data-notification-id="${deletedId}"]`)).toHaveCount(1);

      // Search narrows the list; a miss shows the filtered empty state.
      await panel.getByTestId('notifications-tab-all').click();
      await panel.getByRole('searchbox', { name: 'Search notifications' }).fill('zz-no-such-notification');
      await expect(panel.getByText('No matching notifications')).toBeVisible();

      // Esc closes, returns the pressed state and puts focus back on the bell.
      await page.keyboard.press('Escape'); // clears the search
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(bell).toHaveAttribute('aria-expanded', 'false');
      await expect(bell).toBeFocused();

      // The bell toggles the panel closed too.
      await bell.click();
      await expect(panel).toBeVisible();
      await bell.click();
      await expect(panel).toBeHidden();

      await waitForSettled(page);
      expect(diagnostics.errors, 'console errors').toEqual([]);
    },
  );
});

authedTest.describe('notifications mark all', () => {
  authedTest('Undo restores every notification the server marked', async ({ page, diagnostics }) => {
    await orgBase(page);
    const bell = page.getByTestId('notifications-bell');
    await expect.poll(() => badgeCount(page), { timeout: 45_000 }).toBeGreaterThan(0);
    const before = await badgeCount(page);
    await bell.click();
    const panel = page.getByTestId('notifications-panel');
    await expect(panel.getByTestId('notification-row').first()).toBeVisible({ timeout: 120_000 });
    const marked = page.waitForResponse((res) => res.url().includes('/api/v1/notifications/read'));
    await panel.getByTestId('notifications-mark-all').click();
    await expect.poll(() => badgeCount(page)).toBe(0);
    const body = await (await marked).json();
    expect(body.data.ids).toHaveLength(before);
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: `Marked ${before}` });
    await expect(toast).toBeVisible();
    const undone = page.waitForResponse((res) => res.url().includes('/api/v1/notifications/read'));
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => badgeCount(page), { timeout: 30_000 }).toBe(before);
    // The server agrees: every id the mark-all flipped is unread again.
    expect((await (await undone).json()).data.unreadCount).toBe(before);
    await waitForSettled(page);
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });
});

authedTest.describe('inbox', () => {
  authedTest('shows update cards with breadcrumbs and toggles a like', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/inbox`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
    const card = page.getByTestId('inbox-card').first();
    await expect(card).toBeVisible({ timeout: 120_000 });
    await expect(card.getByRole('navigation', { name: 'Item location' })).toBeVisible();

    const like = card.getByTestId('inbox-like').first();
    const pressed = await like.getAttribute('aria-pressed');
    const isReaction = (res: { url(): string }) => res.url().includes('/reactions');
    // The shared server can be slow: allow the write time, and always toggle back.
    let reacted = page.waitForResponse(isReaction, { timeout: 90_000 });
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true', {
      timeout: 500,
    });
    try {
      await reacted;
    } finally {
      reacted = page.waitForResponse(isReaction, { timeout: 90_000 });
      await like.click();
      await expect(like).toHaveAttribute('aria-pressed', pressed ?? 'false');
      expect((await reacted).ok()).toBe(true);
    }

    // Inline reply composer opens and cancels without posting.
    await card.getByTestId('inbox-reply').click();
    await expect(card.getByRole('textbox', { name: /^Reply to/ })).toBeFocused();
    await expect(card.getByTestId('inbox-reply-send')).toBeDisabled();
    await card.getByRole('button', { name: 'Cancel' }).click();

    // Filters switch on the click (local state) and sync to the URL without a round trip.
    await page.getByTestId('inbox-filter-mentions').click();
    await expect(page.getByTestId('inbox-filter-mentions')).toHaveAttribute('aria-selected', 'true', {
      timeout: 500,
    });
    await expect(page).toHaveURL(/filter=mentions/);
    await page.getByTestId('inbox-filter-all').click();
    await expect(page.getByTestId('inbox-filter-all')).toHaveAttribute('aria-selected', 'true', {
      timeout: 500,
    });
    await expect(page).not.toHaveURL(/filter=/);
    await waitForSettled(page);
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });
});

authedTest.describe('my work', () => {
  authedTest('groups assigned items by date and edits a date inline', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/my-work`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My work');
    const section = page.getByTestId('my-work-section').first();
    await expect(section).toBeVisible({ timeout: 120_000 });

    // Record lists stay out by default; closed outcomes never show as overdue.
    await expect(page.getByText('No date column')).toHaveCount(0);
    await expect(page.locator('[data-bucket="records"]')).toHaveCount(0);
    const overdue = page.locator('[data-bucket="overdue"] [data-testid="my-work-status"]');
    for (const label of await overdue.allTextContents()) expect(label).not.toMatch(/lost|cancel|closed/i);
    const recordsToggle = page.getByTestId('my-work-records-toggle');
    if (await recordsToggle.isVisible()) {
      await recordsToggle.click();
      await expect(page.locator('[data-bucket="records"]')).toBeVisible({ timeout: 500 });
      await expect(page).toHaveURL(/records=1/);
      await recordsToggle.click();
      await expect(page.locator('[data-bucket="records"]')).toHaveCount(0);
    }

    // Show done switches on the click and lands in the URL.
    const showDone = page.getByTestId('my-work-show-done');
    await showDone.click();
    await expect(showDone).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    await expect(page).toHaveURL(/done=1/);
    await showDone.click();
    await expect(page).not.toHaveURL(/done=1/);

    // Search filters rows and is mirrored (debounced) in the URL.
    await page.getByRole('searchbox', { name: 'Search my items' }).fill('zz-nothing-matches');
    await expect(page.getByText('No items match')).toBeVisible();
    await expect(page).toHaveURL(/q=zz-nothing-matches/);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(section).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);

    // Inline date edit with a quick pick, verified after reload, then restored through the API.
    const origin = new URL(page.url()).origin;
    const me = await (await page.request.get('/api/v1/me')).json();
    const orgId: string = me.data.organizations[0].id;
    const headers = { 'x-org-id': orgId, origin };
    const before = (await (await page.request.get('/api/v1/my-work', { headers })).json()).data;
    const row = page
      .locator('[data-testid="my-work-row"]')
      .filter({ has: page.locator('[data-testid="my-work-date"]:enabled') })
      .first();
    const itemId = (await row.getAttribute('data-item-id')) as string;
    const item = before.items.find((entry: { id: string }) => entry.id === itemId);
    const board = before.boards.find((entry: { id: string }) => entry.id === item.boardId);
    const original = await row.getByTestId('my-work-date').getAttribute('aria-label');
    try {
      await row.getByTestId('my-work-date').click();
      const saved = page.waitForResponse((res) => res.url().includes(`/items/${itemId}/values`));
      await page.getByRole('button', { name: 'In 2 weeks' }).click();
      expect((await saved).ok()).toBe(true);
      const moved = page.locator(`[data-testid="my-work-row"][data-item-id="${itemId}"]`);
      await expect(moved.getByTestId('my-work-date')).not.toHaveAttribute('aria-label', original ?? '');
      await page.reload();
      await expect(
        page.locator(`[data-testid="my-work-row"][data-item-id="${itemId}"]`).getByTestId('my-work-date'),
      ).not.toHaveAttribute('aria-label', original ?? '', { timeout: 45_000 });
    } finally {
      const restore = await page.request.put(`/api/v1/items/${itemId}/values`, {
        headers,
        data: {
          columnKey: board.date.key,
          value: item.date ? { date: item.date, ...(item.time ? { time: item.time } : {}) } : null,
        },
        timeout: 120_000,
      });
      expect(restore.status(), 'restore original date').toBeLessThan(300);
    }
    await waitForSettled(page);
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });
});
