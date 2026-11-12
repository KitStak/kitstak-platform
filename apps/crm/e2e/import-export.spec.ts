/**
 * Import wizard end to end: CSV upload → new board → auto-mapping + preview → review with an
 * inline fix → import (first batch reply dropped after commit, so the retry must not duplicate)
 * → export the new board (CSV + XLSX) → undo the whole import → cleanup. Plus API-level checks
 * that prepare / batches / complete are idempotent per batch id and complete can't be forged.
 */
import path from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { authedTest as test, expect, waitForSettled } from './support/fixtures';

/** The shared dev server is busy (many agents): give UI assertions room. */
const ui = expect.configure({ timeout: 150_000 });

const FIXTURE = path.join(__dirname, 'fixtures', 'import-contacts.csv');
const BOARD_PREFIX = 'E2E import ';
const STALE_MS = 60 * 60 * 1000;

async function orgSlug(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me', { timeout: 90_000 });
  const me = (await response.json()) as { data: { organizations: { slug: string }[] } };
  const org = me.data.organizations.find((entry) => entry.slug === 'northwind-robotics') ?? me.data.organizations[0];
  if (!org) throw new Error('No organization for the demo admin');
  return org.slug;
}

function api(request: APIRequestContext, slug: string, baseURL: string) {
  const headers = { 'x-org-id': slug, origin: baseURL };
  const timeout = 120_000;
  return {
    items: (boardId: string) => request.get(`/api/v1/boards/${boardId}/items?limit=50`, { headers, timeout }),
    boards: () => request.get('/api/v1/boards', { headers, timeout }),
    workspaces: () => request.get('/api/v1/workspaces', { headers, timeout }),
    exportBoard: (boardId: string, format: 'csv' | 'xlsx') => request.post('/api/v1/exports', { headers, timeout, data: { boardId, format } }),
    removeBoard: (boardId: string) => request.delete(`/api/v1/boards/${boardId}`, { headers, timeout }),
    post: (route: string, data: unknown) => request.post(`/api/v1/imports/${route}`, { headers, timeout, data }),
  };
}

/** Boards left behind by interrupted runs (name carries the start timestamp). */
async function removeStaleBoards(client: ReturnType<typeof api>): Promise<void> {
  const response = await client.boards();
  if (!response.ok()) return;
  const body = (await response.json()) as { data: { id: string; name: string }[] };
  for (const board of body.data) {
    if (!board.name.startsWith(BOARD_PREFIX)) continue;
    const startedAt = Number(board.name.slice(BOARD_PREFIX.length).split(' ')[0]);
    if (Number.isFinite(startedAt) && Date.now() - startedAt > STALE_MS) await client.removeBoard(board.id);
  }
}

test.describe('import / export', () => {
  // One at a time: the shared dev server is slow under parallel load.
  test.describe.configure({ mode: 'serial' });
  test('imports a CSV into a new board, exports it, then undoes the import', async ({ page, diagnostics, baseURL }) => {
    test.setTimeout(900_000);
    const slug = await orgSlug(page);
    const client = api(page.request, slug, baseURL ?? 'http://localhost:3100');
    await removeStaleBoards(client);
    const boardName = `${BOARD_PREFIX}${Date.now()}`;
    let boardId: string | null = null;

    try {
      await page.goto(`/${slug}/import`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
      await ui(page.getByRole('heading', { level: 1, name: 'Import data' })).toBeVisible();
      await ui(page.getByTestId('import-step-upload')).toHaveAttribute('aria-current', 'step');

      // 1. Upload: the drop zone is on the first screen; choosing a file parses it right away.
      await ui(page.getByTestId('import-dropzone')).toBeVisible();
      const parsed = page.waitForResponse((response) => response.url().includes('/api/v1/imports/parse'), { timeout: 240_000 });
      await page.getByTestId('import-file-input').setInputFiles(FIXTURE);
      expect((await parsed).ok()).toBe(true);
      await ui(page.getByTestId('import-file-summary')).toContainText('import-contacts.csv');
      await ui(page.getByTestId('import-file-summary')).toContainText('6 rows');
      await ui(page).toHaveURL(/step=upload/);
      await page.getByTestId('import-next').click();

      // 2. Destination: defaults come from the file (sentence-cased name, Contacts detected)
      const nameInput = page.getByTestId('import-board-name');
      await ui(nameInput).toHaveValue('Import contacts');
      await ui(page.getByTestId('import-kind-contacts')).toHaveAttribute('aria-checked', 'true');
      await nameInput.fill('');
      await page.getByTestId('import-next').click();
      await ui(page.getByText('Give the new board a name.')).toBeVisible();
      await ui(nameInput).toBeFocused();
      // Errors are per mode: switching to an existing board doesn't show its error before Next.
      await page.getByTestId('import-destination-existing').click();
      await ui(page.getByText('Choose a board first')).toBeVisible();
      await expect(page.getByText('Choose the board to import into.')).toHaveCount(0);
      await page.getByTestId('import-destination-new').click();
      await nameInput.fill(boardName);
      await ui(page.getByTestId('import-kind-contacts')).toHaveAttribute('aria-checked', 'true');
      await ui(nameInput).toHaveValue(boardName);
      await page.getByTestId('import-next').click();
      // Under heavy load a click can land mid-render; press Next again only if we're still here.
      await expect(page).toHaveURL(/step=map/, { timeout: 30_000 }).catch(async () => {
        if (/step=destination/.test(page.url())) await page.getByTestId('import-next').click();
      });
      await ui(page).toHaveURL(/step=map/);

      // Browser Back returns to the previous step with the draft intact.
      await ui(page.getByTestId('import-mapping')).toBeVisible();
      await page.goBack();
      await ui(page.getByTestId('import-board-name')).toHaveValue(boardName);
      await page.getByTestId('import-next').click();

      // 3. Mapping: auto-detected types + live preview with real cell renderers
      const mapping = page.getByTestId('import-mapping');
      await ui(mapping).toBeVisible();
      await ui(page.getByTestId('import-mapping-row')).toHaveCount(8);
      const emailRow = page.locator('[data-testid="import-mapping-row"][data-source-header="E-mail"]');
      await ui(emailRow).toContainText('Email');
      await expect(emailRow).not.toContainText('%');
      const stageRow = page.locator('[data-testid="import-mapping-row"][data-source-header="Stage"]');
      await ui(stageRow).toContainText('3 labels');
      // New columns are one control: the name + type live behind the pencil.
      await stageRow.getByTestId('import-new-column-edit').click();
      await ui(page.getByLabel('New column name for Stage')).toHaveValue('Stage');
      await page.keyboard.press('Escape');
      const preview = page.getByTestId('import-preview');
      await ui(preview).toBeVisible();
      await ui(preview.getByTestId('status-cell').first()).toBeVisible();
      await page.getByTestId('import-next').click();

      // 4. Review: tiles partition the file; problems listed and fixable inline
      await ui(page.getByTestId('import-stat-rows')).toContainText('6');
      await ui(page.getByTestId('import-stat-ready')).toContainText('5');
      await ui(page.getByTestId('import-stat-skipped')).toContainText('1');
      const issues = page.getByTestId('import-issues');
      await ui(issues).toContainText('not-an-email');
      await ui(issues).toContainText('someday');
      await issues.getByLabel('Fix E-mail on row 4').fill('alan@turing.example');
      await issues.getByLabel('Fix E-mail on row 4').press('Enter');
      await ui(issues).not.toContainText("isn't a valid email");
      const importButton = page.getByTestId('import-next');
      await ui(importButton).toHaveText('Import 5 contacts');

      // The first batch commits on the server but its reply is lost: the retry must not duplicate.
      let dropped = false;
      await page.route('**/api/v1/imports/batches', async (route) => {
        if (dropped) return route.continue();
        dropped = true;
        await route.fetch({ timeout: 240_000 });
        await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"code":"BAD_GATEWAY","message":"Bad gateway"}}' });
      });
      await importButton.click();

      // 5. Progress → summary
      const runPanel = page.getByTestId('import-run');
      await ui(runPanel).toHaveAttribute('data-status', 'done', { timeout: 180_000 });
      expect(dropped).toBe(true);
      await page.unroute('**/api/v1/imports/batches');
      await ui(page.getByTestId('import-count-created')).toContainText('5');
      await ui(page.getByTestId('import-count-skipped')).toContainText('1');
      await ui(page.getByTestId('import-step-import')).toHaveAttribute('data-state', 'done');
      await ui(page.getByTestId('import-added')).toContainText('Stage');
      await ui(page).toHaveURL(/run=imp/);
      const href = await page.getByTestId('import-go-to-board').getAttribute('href');
      boardId = href?.split('/').pop() ?? null;
      expect(boardId).toBeTruthy();

      // Exactly five items even though the first batch's reply was dropped and the batch re-sent.
      // (Polled: the busy shared server occasionally answers a fresh board's first read with a 404.)
      let names: string[] = [];
      await expect
        .poll(
          async () => {
            const listed = await client.items(boardId as string);
            if (!listed.ok()) return `HTTP ${listed.status()}`;
            const body = (await listed.json()) as { data: { name: string }[] };
            names = body.data.map((item) => item.name).sort();
            return 'ok';
          },
          { timeout: 120_000, intervals: [2_000, 5_000] },
        )
        .toBe('ok');
      expect(names).toEqual(
        ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Katherine Johnson', 'Linus Torvalds'].sort(),
      );

      // Export the new board (CSV + XLSX)
      const csv = await client.exportBoard(boardId as string, 'csv');
      expect(csv.ok()).toBe(true);
      expect(csv.headers()['content-disposition']).toContain('.csv');
      const text = await csv.text();
      expect(text).toContain('Ada Lovelace');
      expect(text).toContain('alan@turing.example');
      expect(text).toContain('Qualified');
      expect(text).toContain('+1 415 555 0100');
      expect(text).not.toContain("'+1");
      const xlsx = await client.exportBoard(boardId as string, 'xlsx');
      expect(xlsx.ok()).toBe(true);
      const bytes = await xlsx.body();
      expect(bytes.subarray(0, 2).toString()).toBe('PK');

      // Undo the whole import; the empty board it created goes to the trash too.
      await page.getByTestId('import-undo').click();
      await ui(page.getByTestId('import-undo-delete-board')).toBeChecked();
      await page.getByTestId('import-undo-confirm').click();
      await ui(runPanel).toHaveAttribute('data-status', 'undone', { timeout: 180_000 });
      await ui(page.getByTestId('import-count-archived')).toContainText('5');
      await ui(page.getByTestId('import-run-subtitle')).toContainText('moved to the trash');
      const after = await client.items(boardId as string);
      expect(after.ok()).toBe(false);
      boardId = null;

      await page.getByTestId('import-another').click();
      await ui(page.getByTestId('import-dropzone')).toBeVisible();
      await waitForSettled(page);
      // Network-level "Failed to load resource" lines are excluded: the 502 is the reply this test
      // drops on purpose, and the overloaded shared server can 5xx unrelated shell requests.
      const errors = diagnostics.errors.filter((message) => !message.includes('Failed to load resource'));
      expect(errors, 'console errors during import').toEqual([]);
    } finally {
      if (boardId) await client.removeBoard(boardId);
    }
  });

  test('prepare, batches and complete are idempotent per batch id', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const slug = await orgSlug(page);
    const client = api(page.request, slug, baseURL ?? 'http://localhost:3100');
    const workspaces = (await (await client.workspaces()).json()) as { data: { id: string }[] };
    const workspaceId = workspaces.data[0]?.id as string;
    const batchId = `e2eidem${Date.now()}`;
    const prepareBody = {
      batchId,
      destination: { type: 'new', workspaceId, name: `${BOARD_PREFIX}${Date.now()} idempotency`, kind: 'custom' },
      newColumns: [{ ref: 'new_1', title: 'Note', type: 'text' }],
    };
    let boardId: string | null = null;
    try {
      const first = await client.post('prepare', prepareBody);
      expect(first.ok()).toBe(true);
      const prepared = (await first.json()) as { data: { board: { id: string }; groupId: string; keyByRef: Record<string, string> } };
      boardId = prepared.data.board.id;
      const again = (await (await client.post('prepare', prepareBody)).json()) as typeof prepared;
      expect(again.data.board.id).toBe(boardId);
      expect(again.data.groupId).toBe(prepared.data.groupId);

      const noteKey = prepared.data.keyByRef.new_1 as string;
      const batch = {
        batchId,
        boardId,
        groupId: prepared.data.groupId,
        fileName: 'dup.csv',
        rows: ['Dup One', 'Dup Two', 'Dup Three'].map((name, index) => ({ row: index + 2, name, values: { [noteKey]: `n${index}` } })),
      };
      const sent = (await (await client.post('batches', batch)).json()) as { data: { created: number } };
      const resent = (await (await client.post('batches', batch)).json()) as { data: { created: number } };
      expect(sent.data.created).toBe(3);
      expect(resent.data.created).toBe(3);
      const items = (await (await client.items(boardId)).json()) as { data: { name: string }[] };
      expect(items.data.map((item) => item.name).sort()).toEqual(['Dup One', 'Dup Three', 'Dup Two']);

      // Completion can't be forged and is recorded once.
      expect((await client.post('complete', { batchId: 'fakefakefake', boardId })).status()).toBe(404);
      expect((await client.post('complete', { batchId, boardId })).ok()).toBe(true);
      const second = (await (await client.post('complete', { batchId, boardId })).json()) as { data: { notified: boolean } };
      expect(second.data.notified).toBe(false);

      const undo = await client.post('undo', { batchId, boardId, deleteBoard: true });
      expect(undo.ok()).toBe(true);
      expect(((await undo.json()) as { data: { boardDeleted: boolean } }).data.boardDeleted).toBe(true);
      boardId = null;
    } finally {
      if (boardId) await client.removeBoard(boardId);
    }
  });

  test('clamps deep links, blocks empty steps and rejects unsupported files inline', async ({ page }) => {
    test.setTimeout(300_000);
    const slug = await orgSlug(page);
    await page.goto(`/${slug}/import?step=review`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await ui(page.getByTestId('import-panel-upload')).toBeVisible();
    await ui(page).toHaveURL(/step=upload/);
    // Arrow keys move between sources and check the focused one (WAI-ARIA radio group).
    await page.getByTestId('import-source-file').focus();
    await page.keyboard.press('ArrowRight');
    await ui(page.getByTestId('import-source-paste')).toBeFocused();
    await ui(page.getByTestId('import-source-paste')).toHaveAttribute('aria-checked', 'true');
    await ui(page.getByTestId('import-paste')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await ui(page.getByTestId('import-source-file')).toHaveAttribute('aria-checked', 'true');
    // Next without a file explains what's missing and focuses the browse button.
    await page.getByTestId('import-next').click();
    await ui(page.getByTestId('import-upload-error')).toContainText('Choose a file');
    await ui(page.getByTestId('import-browse')).toBeFocused();
    await page.getByTestId('import-file-input').setInputFiles({
      name: 'legacy.xls',
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    });
    await ui(page.getByTestId('import-upload-error')).toContainText('Legacy .xls');
  });
});
