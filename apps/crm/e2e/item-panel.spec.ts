/**
 * Item panel — main flow on /dev/item-panel against a throwaway Deals item (created and
 * deleted by the spec, so seeded data is untouched): deep link, rename, post an update with
 * Ctrl+Enter, like + reply, activity log before → after, item card, file upload, Esc closes.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';
import { baseUrl } from './support/paths';

interface Ctx {
  orgId: string;
  boardId: string;
  itemId: string;
}

async function api<T>(request: APIRequestContext, ctx: Pick<Ctx, 'orgId'> | null, method: string, path: string, body?: unknown): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    timeout: 90_000,
    headers: { ...(ctx ? { 'x-org-id': ctx.orgId } : {}), origin: baseUrl(), 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { ok: boolean; data: T; error?: { message: string } };
  if (!json.ok) throw new Error(`${method} ${path}: ${json.error?.message}`);
  return json.data;
}

const panel = (page: Page) => page.getByTestId('item-panel');

// Default mode (not serial): a slow shared dev server failing one step must not skip the rest.
test.describe.configure({ mode: 'default', timeout: 180_000 });

test.describe('item panel', () => {
  const ctx: Ctx = { orgId: '', boardId: '', itemId: '' };
  const name = `E2E panel deal ${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    const me = await api<{ organizations: { id: string }[] }>(request, null, 'GET', '/me');
    ctx.orgId = me.organizations[0]?.id ?? '';
    const boards = await api<{ id: string }[]>(request, ctx, 'GET', '/boards?kind=deals');
    ctx.boardId = boards[0]?.id ?? '';
    const item = await api<{ id: string }>(request, ctx, 'POST', `/boards/${ctx.boardId}/items`, { name, position: 'bottom' });
    ctx.itemId = item.id;
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000);
    if (ctx.itemId) await api(request, ctx, 'DELETE', `/items/${ctx.itemId}`).catch(() => undefined);
  });

  test('deep link opens the panel; rename, post, like, reply; Esc closes', async ({ page, diagnostics }) => {
    test.setTimeout(480_000);
    await page.goto(`/dev/item-panel?item=${ctx.itemId}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await expect(panel(page)).toBeVisible({ timeout: 120_000 });
    const nameInput = panel(page).getByTestId('item-panel-name');
    await expect(nameInput).toHaveValue(name, { timeout: 120_000 });
    await expect(panel(page)).toHaveAttribute('aria-label', name);

    // Rename inline (Enter saves).
    await nameInput.fill(`${name} (renamed)`);
    await nameInput.press('Enter');
    await expect(nameInput).toHaveValue(`${name} (renamed)`);

    // Empty state, then post with Ctrl+Enter.
    await expect(panel(page).getByText('No updates yet')).toBeVisible({ timeout: 120_000 });
    await panel(page).getByTestId('update-composer-collapsed').click();
    const editor = panel(page).getByTestId('update-composer').getByRole('textbox', { name: 'Write an update' });
    await editor.click();
    await page.keyboard.type('Kickoff scheduled. Demo ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('next week');
    await page.keyboard.press('Control+Enter');
    const card = panel(page).getByTestId('update-card').first();
    await expect(card).toContainText('Kickoff scheduled.');
    await expect(card.locator('strong').filter({ hasText: 'next week' })).toBeVisible();
    await expect(card).not.toContainText('Posting…', { timeout: 90_000 });

    // Like toggles optimistically.
    const like = card.getByTestId('like-update');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toContainText('1');

    // Threaded reply.
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await card.getByTestId('reply-editor').getByRole('textbox').fill('Confirmed with the account team');
    await card.getByTestId('send-reply').click();
    await expect(card.getByTestId('update-reply')).toContainText('Confirmed with the account team');

    // Persisted after reload.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
    await expect(panel(page).getByTestId('update-card').first()).toContainText('Kickoff scheduled.', { timeout: 180_000 });

    // Esc closes and the URL drops the item.
    await panel(page).getByRole('tab', { name: /Updates/ }).focus();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/item=/);
    expect(diagnostics.errors).toEqual([]);
  });

  test('activity log shows changes; item card edits; files upload', async ({ page, diagnostics }) => {
    test.setTimeout(480_000);
    await page.goto(`/dev/item-panel?item=${ctx.itemId}&itemTab=activity`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await expect(panel(page)).toBeVisible({ timeout: 120_000 });
    const log = panel(page).getByTestId('activity-log');
    await expect(log).toBeVisible({ timeout: 120_000 });
    await expect(log).toContainText('renamed the deal');
    await expect(log).toContainText('posted an update');

    // Item card renders every column as an editable cell.
    await panel(page).getByTestId('tab-card').click();
    await expect(page).toHaveURL(/itemTab=card/);
    const fields = panel(page).getByTestId('item-card-fields');
    await expect(fields.getByTestId('item-card-field').first()).toBeVisible();
    const nextStep = fields.locator('[data-ks-cell][data-column-key="next_step"]');
    await nextStep.click();
    await page.keyboard.type('Send MSA redlines');
    await page.keyboard.press('Enter');
    await expect(nextStep).toContainText('Send MSA redlines');

    // Files: upload through the picker and see the tile.
    await panel(page).getByTestId('tab-files').click();
    await panel(page).getByTestId('files-input').setInputFiles({ name: 'proposal-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('KitStak proposal notes') });
    await expect(panel(page).getByTestId('file-tile').filter({ hasText: 'proposal-notes.txt' })).toBeVisible({ timeout: 120_000 });
    await expect(panel(page).getByTestId('tab-files')).toContainText('1');
    expect(diagnostics.errors).toEqual([]);
  });

  test('keyboard: focus restore, j/k, non-modal row switching; own updates arrive live', async ({ page, request, diagnostics }) => {
    test.setTimeout(480_000);
    await page.goto('/dev/item-panel?closed=1', { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await expect(page.getByTestId('open-item').nth(3)).toBeVisible({ timeout: 300_000 });
    // Other agents add items to the shared board, so rows are addressed by id, not position.
    const rowId = async (index: number) => (await page.locator('[data-item-id]').nth(index).getAttribute('data-item-id')) ?? '';
    const first = await rowId(1);
    const second = await rowId(2);
    const third = await rowId(3);
    const row = (id: string) => page.locator(`[data-item-id="${id}"]`);
    const openOf = (id: string) => row(id).getByTestId('open-item');

    // Open from the keyboard; Esc closes and focus returns to the opener.
    await openOf(first).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`item=${first}`));
    await expect(panel(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(openOf(first)).toBeFocused();

    // j / k step through items straight after opening (focus is on the panel).
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toBeFocused();
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(new RegExp(`item=${first}`));
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`item=${first}`));

    // Non-modal: the board stays usable; another row's Open switches the card in place.
    await openOf(third).click();
    await expect(page).toHaveURL(new RegExp(`item=${third}`));
    await expect(panel(page)).toBeVisible();
    // Clicking a row itself (not a control) also switches instead of closing.
    await row(second).getByTestId('dev-item-name').click();
    await expect(page).toHaveURL(new RegExp(`item=${second}`));
    await expect(panel(page)).toBeVisible();
    await openOf(third).click();
    await expect(page).toHaveURL(new RegExp(`item=${third}`));
    await page.getByTestId('item-panel-close').click();
    await expect(panel(page)).toBeHidden();
    await expect(openOf(third)).toBeFocused();

    // An update posted by the same user elsewhere (API = "another tab") shows up live.
    await page.goto(`/dev/item-panel?item=${ctx.itemId}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await expect(panel(page).getByTestId('update-composer-collapsed')).toBeVisible({ timeout: 180_000 });
    await expect(panel(page).locator('[aria-label="Loading updates"]')).toHaveCount(0, { timeout: 180_000 });
    const text = `Posted from another tab ${Date.now()}`;
    await api(request, ctx, 'POST', `/items/${ctx.itemId}/updates`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    });
    await expect(panel(page).getByTestId('update-card').filter({ hasText: text })).toBeVisible({ timeout: 120_000 });
    expect(diagnostics.errors).toEqual([]);
  });
});
