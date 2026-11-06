/**
 * Cells module — main flows on the /dev/cells gallery (local, mocked board data):
 * status picker, keyboard editing of text/number cells, invalid input, checkbox, date
 * typing, Delete + Undo, edit labels, and the battery quick filter.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect } from './support/fixtures';
import { baseUrl } from './support/paths';

const table = (page: Page) => page.getByTestId('board-table');
const row = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name }).first();
const cell = (page: Page, name: string, type: string) => row(page, name).locator(`[data-ks-cell][data-column-type="${type}"]`).first();

// Gallery tests are independent (each reloads the mocked board): one failure must not skip the rest.
test.describe.configure({ mode: 'default' });

/** The shared dev server compiles routes on demand and is often busy: generous, explicit budgets. */
const NAV_TIMEOUT = 120_000;

test.describe('cells gallery', () => {
  test.describe.configure({ timeout: 300_000, retries: 1 });

  // Warm the route once so per-test budgets measure behaviour, not the first compile.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(NAV_TIMEOUT * 3);
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json', baseURL: baseUrl() });
    const page = await context.newPage();
    try {
      await page.goto('/dev/cells', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT * 2 });
      await expect(table(page)).toBeVisible({ timeout: NAV_TIMEOUT });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await page.goto('/dev/cells', { waitUntil: 'domcontentloaded' });
    await expect(table(page)).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('status pill: picker selects a label, focus returns to the cell', async ({ page, diagnostics }) => {
    const status = row(page, 'Initech — renewal').getByTestId('status-cell').first();
    await expect(status).toContainText('Stuck');
    await status.click();
    const picker = page.getByTestId('cell-editor-status').getByRole('listbox', { name: /Stage labels/ });
    await expect(picker).toBeVisible();
    await picker.getByRole('option', { name: 'Done' }).click();
    await expect(picker).toBeHidden();
    await expect(status).toContainText('Done');
    await expect(status).toBeFocused();

    // Keyboard: Enter opens, arrows move, Enter picks.
    await status.press('Enter');
    await expect(picker).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Waiting for review');
    expect(diagnostics.errors).toEqual([]);
  });

  test('typing starts editing; Enter saves; Esc cancels; invalid numbers are flagged', async ({ page, diagnostics }) => {
    const text = cell(page, 'Initech — renewal', 'text');
    await text.focus();
    await page.keyboard.type('Call CFO');
    await page.keyboard.press('Enter');
    await expect(text).toContainText('Call CFO');

    await text.focus();
    await page.keyboard.type('x');
    await page.keyboard.press('Escape');
    await expect(text).toContainText('Call CFO');

    const seats = cell(page, 'Initech — renewal', 'number');
    await seats.click();
    const input = seats.getByRole('textbox');
    await input.fill('lots');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a number' })).toBeVisible();
    await input.fill('1.5k');
    await input.press('Tab');
    await expect(seats).toContainText('1,500 seats');
    expect(diagnostics.errors).toEqual([]);
  });

  test('checkbox toggles; Delete clears with Undo', async ({ page }) => {
    const check = cell(page, 'Initech — renewal', 'checkbox');
    await check.click();
    await expect(check).toContainText('Checked');

    const currency = cell(page, 'Initech — renewal', 'currency');
    await expect(currency).toContainText('$18,900');
    await currency.focus();
    await page.keyboard.press('Delete');
    await expect(currency).not.toContainText('$18,900');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(currency).toContainText('$18,900');
  });

  test('date: type a natural-language date', async ({ page }) => {
    const date = cell(page, 'Wayne Freight', 'date');
    await date.click();
    const input = page.getByTestId('cell-editor-date').getByRole('textbox', { name: 'Type a date' });
    await input.fill('tomorrow');
    await input.press('Enter');
    await expect(date).not.toBeEmpty();
    await expect(page.getByTestId('cell-editor-date')).toBeHidden();
  });

  test('edit labels: rename a label from the status picker', async ({ page, diagnostics }) => {
    const status = row(page, 'Stark').getByTestId('status-cell').first();
    await status.click();
    await page.getByTestId('cell-editor-status').getByTestId('edit-labels').click();
    const editor = page.getByTestId('cell-editor-status').getByTestId('label-editor');
    await expect(editor).toBeVisible();
    const name = editor.getByRole('textbox', { name: 'Label name' }).first();
    await name.fill('In progress');
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(status).toContainText('In progress');
    expect(diagnostics.errors).toEqual([]);
  });

  test('battery segment quick-filters the board', async ({ page }) => {
    const battery = page.getByTestId('battery').first();
    await battery.getByRole('button', { name: /^Stuck/ }).click();
    await expect(row(page, 'Initech — renewal')).toBeVisible();
    await expect(table(page).getByRole('row').filter({ hasText: 'Acme Robotics — platform' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(row(page, 'Acme Robotics — platform')).toBeVisible();
  });

  test('gridcells are named by their value, not the column title', async ({ page }) => {
    const initech = row(page, 'Initech — renewal');
    await expect(initech.getByRole('gridcell', { name: 'Stuck', exact: true })).toBeVisible();
    await expect(initech.getByRole('gridcell', { name: 'Stage', exact: true })).toHaveCount(0);
    const acme = row(page, 'Acme Robotics — platform expansion');
    await expect(acme.getByRole('gridcell', { name: /Maya Chen, Priya Natarajan/ })).toBeVisible();
    await expect(acme.locator('[data-ks-cell][data-column-type="phone"] svg[data-flag="US"]')).toBeVisible();
  });

  test('Tab in a popover picker closes it and moves to the next cell', async ({ page }) => {
    const status = row(page, 'Initech — renewal').getByTestId('status-cell').first();
    await status.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cell-editor-status')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('cell-editor-status')).toBeHidden();
    await expect(row(page, 'Initech — renewal').locator('[data-ks-cell][data-column-key="priority"]')).toBeFocused();
  });

  test('failed save: error toast, no Undo toast, value rolled back', async ({ page }) => {
    await page.getByTestId('simulate-errors').click();
    const currency = cell(page, 'Initech — renewal', 'currency');
    await currency.focus();
    await page.keyboard.press('Delete');
    await expect(page.getByText(/Couldn.t update Deal value/)).toBeVisible();
    await expect(currency).toContainText('$18,900');
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });

  test('label editor: Esc on unsaved edits asks first, a second Esc discards', async ({ page }) => {
    const status = row(page, 'Initech — renewal').getByTestId('status-cell').first();
    await status.click();
    const popover = page.getByTestId('cell-editor-status');
    await popover.getByTestId('edit-labels').click();
    const editor = popover.getByTestId('label-editor');
    await editor.getByRole('button', { name: 'New label' }).click();
    await page.keyboard.type('QA Label');
    await page.keyboard.press('Escape');
    await expect(popover.getByTestId('label-discard-confirm')).toBeVisible();
    await expect(editor).toBeVisible();
    await popover.getByRole('button', { name: 'Keep editing' }).click();
    await expect(popover.getByTestId('label-discard-confirm')).toBeHidden();
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover.getByTestId('label-discard-confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    // Discarded: back on the picker, nothing was saved.
    await expect(editor).toBeHidden();
    await expect(popover.getByRole('listbox')).toBeVisible();
    await expect(popover.getByRole('option', { name: 'QA Label' })).toHaveCount(0);
  });

  test('status picker: typing filters with an empty state; Ctrl+A stays inside', async ({ page }) => {
    const status = row(page, 'Acme Robotics — platform').getByTestId('status-cell').first();
    await status.click();
    const popover = page.getByTestId('cell-editor-status');
    await expect(popover.getByRole('listbox')).toBeFocused();
    await page.keyboard.press('Control+A');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.type('zzz');
    await expect(popover.getByTestId('label-filter-chip')).toContainText('zzz');
    await expect(popover.getByText(/No labels match/)).toBeVisible();
    for (let index = 0; index < 3; index += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('stu');
    await expect(popover.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Stuck');
  });

  test('copy / paste between cells, Ctrl+Z undo, Home / End', async ({ page }) => {
    const source = row(page, 'Initech — renewal').getByTestId('status-cell').first();
    const target = row(page, 'Acme Robotics — platform').getByTestId('status-cell').first();
    await expect(source).toContainText('Stuck');
    const before = (await target.innerText()).trim();
    expect(before).not.toBe('Stuck');
    // Real ClipboardEvents: the same path as Ctrl+C / Ctrl+V, without OS clipboard permissions.
    const copied = await source.evaluate((element) => {
      const data = new DataTransfer();
      (element as HTMLElement).focus();
      element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData('text/plain');
    });
    expect(copied).toBe('Stuck');
    await target.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      (element as HTMLElement).focus();
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, copied);
    await expect(target).toContainText('Stuck');
    await target.focus();
    await page.keyboard.press('Control+Z');
    await expect(target).toContainText(before);

    // Text edit, then Ctrl+Z on the focused cell.
    const text = cell(page, 'Initech — renewal', 'text');
    await text.focus();
    await page.keyboard.type('QA note');
    await page.keyboard.press('Enter');
    await expect(text).toContainText('QA note');
    await text.focus();
    await page.keyboard.press('Control+Z');
    await expect(text).not.toContainText('QA note');

    // Home / End move to the row's first / last cell.
    const rowKeys = await row(page, 'Initech — renewal')
      .locator('[data-ks-cell]')
      .evaluateAll((cells) => cells.map((entry) => (entry as HTMLElement).dataset.columnKey));
    const activeKey = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.columnKey);
    await source.focus();
    await page.keyboard.press('End');
    expect(await activeKey()).toBe(rowKeys[rowKeys.length - 1]);
    await page.keyboard.press('Home');
    expect(await activeKey()).toBe(rowKeys[0]);
  });

  test('narrow screens: editors open as a bottom sheet; timeline shows one month', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const timeline = cell(page, 'Acme Robotics — platform', 'timeline');
    await timeline.scrollIntoViewIfNeeded();
    await timeline.click();
    const sheet = page.getByTestId('cell-editor-timeline');
    await expect(sheet).toBeVisible();
    await expect.poll(async () => {
      const box = await sheet.boundingBox();
      return box ? Math.round(box.y + box.height) : 0;
    }).toBe(844);
    await expect(sheet.locator('.rdp-month')).toHaveCount(1);
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('location: place search suggests, picks and stores coordinates', async ({ page }) => {
    const location = cell(page, 'Initech — renewal', 'location');
    await location.click();
    const editor = page.getByTestId('cell-editor-location');
    await editor.getByRole('combobox', { name: 'Address' }).fill('Austin');
    await editor.getByRole('option', { name: /Austin/ }).click();
    await expect(location).toContainText('Austin, TX, USA');
    await location.click();
    await expect(page.getByTestId('cell-editor-location').getByTestId('location-preview')).toContainText('30.2672° N');
  });
});

interface Envelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

async function getJson<T>(request: APIRequestContext, url: string, orgId?: string): Promise<T> {
  const response = await request.get(url, { headers: orgId ? { 'x-org-id': orgId } : {}, timeout: 90_000 });
  const body = (await response.json()) as Envelope<T>;
  expect(body.ok, `${url} -> ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body.data;
}

async function send<T>(request: APIRequestContext, method: 'post' | 'put' | 'delete', url: string, orgId: string, data?: unknown): Promise<T> {
  const response = await request[method](url, { headers: { 'x-org-id': orgId, origin: new URL(baseUrl()).origin }, data, timeout: 90_000 });
  const body = (await response.json()) as Envelope<T>;
  expect(body.ok, `${method} ${url} -> ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body.data;
}

test.describe('cells server support', () => {
  test.describe.configure({ timeout: 300_000 });

  test('linked item names resolve in one org-scoped batch; deleting a label reassigns board-wide', async ({ request }) => {
    const me = await getJson<{ organizations: { id: string; slug: string }[] }>(request, '/api/v1/me');
    const org = me.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.organizations[0];
    if (!org) throw new Error('No organization');
    const workspaces = await getJson<{ id: string }[]>(request, '/api/v1/workspaces', org.id);
    const workspaceId = workspaces[0]?.id;
    if (!workspaceId) throw new Error('No workspace');

    // Throwaway board so shared seed data is never touched.
    const board = await send<{ id: string }>(request, 'post', '/api/v1/boards', org.id, { workspaceId, name: 'QA cells reassign (temp)' });
    try {
      const column = await send<{ id: string; key: string }>(request, 'post', `/api/v1/boards/${board.id}/columns`, org.id, {
        title: 'Stage',
        type: 'status',
        settings: {
          labels: [
            { id: 'a', name: 'Old', color: 'orange', position: 0 },
            { id: 'b', name: 'New', color: 'green', position: 1, isDone: true },
            { id: 'z', name: '', color: 'gray', position: 2, isDefault: true },
          ],
        },
      });
      const names = ['One', 'Two', 'Three'];
      const created: { id: string }[] = [];
      for (const name of names) {
        created.push(await send<{ id: string }>(request, 'post', `/api/v1/boards/${board.id}/items`, org.id, { name, values: { [column.key]: { labelId: 'a' } } }));
      }

      const linked = await send<{ id: string; name: string; boardName: string }[]>(request, 'post', '/api/v1/cells/linked-items', org.id, {
        itemIds: [...created.map((item) => item.id), '00000000-0000-4000-8000-000000000000'],
      });
      expect(linked.map((entry) => entry.name).sort()).toEqual([...names].sort());
      expect(linked.every((entry) => entry.boardName === 'QA cells reassign (temp)')).toBe(true);

      const usage = await getJson<Record<string, number>>(request, `/api/v1/cells/boards/${board.id}/columns/${column.id}/labels`, org.id);
      expect(usage).toEqual({ a: 3 });

      await send(request, 'put', `/api/v1/cells/boards/${board.id}/columns/${column.id}/labels`, org.id, {
        labels: [
          { id: 'b', name: 'New', color: 'green', position: 0, isDone: true },
          { id: 'z', name: '', color: 'gray', position: 1, isDefault: true },
        ],
        reassign: { a: 'b' },
      });
      const after = await getJson<Record<string, number>>(request, `/api/v1/cells/boards/${board.id}/columns/${column.id}/labels`, org.id);
      expect(after).toEqual({ b: 3 });

      // Every reassigned item gets a real history entry (Stage: Old -> New).
      const firstCreated = created[0];
      if (!firstCreated) throw new Error('no item');
      const activity = await getJson<{ action: string; columnKey: string | null; before: unknown; after: unknown }[]>(
        request,
        `/api/v1/items/${firstCreated.id}/activity`,
        org.id,
      );
      expect(
        activity.some(
          (entry) =>
            entry.action === 'item.value_changed' &&
            entry.columnKey === column.key &&
            JSON.stringify(entry.before) === '{"labelId":"a"}' &&
            JSON.stringify(entry.after) === '{"labelId":"b"}',
        ),
      ).toBe(true);

      // The contract rejects duplicate names, an empty list, and a status column without its blank label.
      const labelsUrl = `/api/v1/cells/boards/${board.id}/columns/${column.id}/labels`;
      const headers = { 'x-org-id': org.id, origin: new URL(baseUrl()).origin };
      const blank = { id: 'z', name: '', color: 'gray', position: 2, isDefault: true };
      const dup = await request.put(labelsUrl, {
        timeout: 90_000,
        headers,
        data: { labels: [{ id: 'b', name: 'B', color: 'green', position: 0 }, { id: 'c', name: 'b ', color: 'red', position: 1 }, blank], reassign: {} },
      });
      expect([400, 422]).toContain(dup.status());
      const empty = await request.put(labelsUrl, { timeout: 90_000, headers, data: { labels: [], reassign: {} } });
      expect([400, 422]).toContain(empty.status());
      const noBlank = await request.put(labelsUrl, { timeout: 90_000, headers, data: { labels: [{ id: 'b', name: 'New', color: 'green', position: 0 }], reassign: {} } });
      expect([400, 422]).toContain(noBlank.status());

      // Dropdown: ids are replaced in place and de-duplicated.
      const tags = await send<{ id: string; key: string }>(request, 'post', `/api/v1/boards/${board.id}/columns`, org.id, {
        title: 'Areas',
        type: 'dropdown',
        settings: { labels: [{ id: 'x', name: 'X', color: 'blue', position: 0 }, { id: 'y', name: 'Y', color: 'teal', position: 1 }] },
      });
      const first = created[0];
      if (!first) throw new Error('no item');
      await send(request, 'put', `/api/v1/items/${first.id}/values`, org.id, { columnKey: tags.key, value: { labelIds: ['x', 'y'] } });
      await send(request, 'put', `/api/v1/cells/boards/${board.id}/columns/${tags.id}/labels`, org.id, {
        labels: [{ id: 'y', name: 'Y', color: 'teal', position: 0 }],
        reassign: { x: 'y' },
      });
      const tagUsage = await getJson<Record<string, number>>(request, `/api/v1/cells/boards/${board.id}/columns/${tags.id}/labels`, org.id);
      expect(tagUsage).toEqual({ y: 1 });
    } finally {
      await send(request, 'delete', `/api/v1/boards/${board.id}`, org.id);
    }
  });
});
