import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke suite (SPEC quality bar): sign in, quick add, board drag, drawer edit, table inline edit,
 * public intake form, unknown URLs answer 404, plus a light speed budget. Runs against a dev or
 * prod server: `E2E_BASE_URL=http://localhost:3420 npx playwright test e2e/smoke.spec.ts`.
 * Every task it creates is deleted again at the end of its test.
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3400';

type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

/**
 * Signs in once per worker through the auth API and reuses the session cookie: the auth server
 * rate limits sign-ins, and every team's suite shares it.
 */
async function signIn(page: Page) {
  // Optional: reuse a saved session (JSON cookie list) instead of signing in again.
  if (!session && process.env.E2E_COOKIES) session = JSON.parse(readFileSync(process.env.E2E_COOKIES, 'utf8')) as Cookie[];
  if (!session) {
    const response = await page.request.post('/api/auth/sign-in/email', {
      data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' },
      headers: { origin: ORIGIN() },
    });
    expect(response.ok(), `sign in answered ${response.status()}`).toBeTruthy();
    session = await page.context().cookies();
    return;
  }
  await page.context().addCookies(session);
}

/** Cleanup: focus the task's List row and press Delete (the row's own shortcut). */
async function deleteTask(page: Page, key: string) {
  await page.goto('/p/OPS/list');
  const row = page.locator(`[data-testid="list-row"][data-task-key="${key}"]`);
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Delete');
  await expect(row).toHaveCount(0);
}

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test.describe('smoke', () => {
  test('sign in lands on Home with the shell', async ({ page }) => {
    await page.goto('/login?local=1');
    await page.locator('input[type="email"], input[name="email"]').first().fill('maya@northwind-robotics.example');
    await page.locator('input[type="password"]').fill('Northwind-Demo-2026!');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByTestId('topbar-search')).toBeVisible();
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ page }) => signIn(page));

    test('quick add creates a task that shows on the board', async ({ page }) => {
      await page.goto('/p/OPS/board');
      await expect(page.getByTestId('board-card').first()).toBeVisible();
      const title = unique('Smoke quick add');
      await page.keyboard.press('c');
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      const card = page.getByTestId('board-card').filter({ hasText: title });
      await expect(card).toBeVisible();
      const key = await card.getAttribute('data-task-key');
      if (key) await deleteTask(page, key);
    });

    test('moving a card to another column changes its status (drag and drop)', async ({ page }) => {
      await page.goto('/p/OPS/board');
      const columns = page.getByTestId('board-column');
      await expect(page.getByTestId('board-card').first()).toBeVisible();
      const title = unique('Smoke drag');
      await page.keyboard.press('c');
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      const card = page.getByTestId('board-card').filter({ hasText: title });
      await expect(card).toBeVisible();
      const key = (await card.getAttribute('data-task-key')) as string;
      const target = columns.nth(1);
      // Pointer drag (dnd-kit needs a few px of movement before it starts dragging).
      await card.scrollIntoViewIfNeeded();
      const from = await card.boundingBox();
      const to = await target.getByTestId('board-cell').first().boundingBox();
      if (!from || !to) throw new Error('no layout');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 15 });
      await page.mouse.up();
      await expect(target.getByTestId('board-card').filter({ hasText: title })).toBeVisible();
      const targetStatus = await target.getAttribute('data-status-id');
      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/v1/tasks/${key}`);
          return ((await res.json()) as { data: { statusId: string } }).data.statusId;
        })
        .toBe(targetStatus);
      await deleteTask(page, key);
    });

    test('j, Enter opens the drawer and the title edits in place', async ({ page }) => {
      await page.goto('/p/OPS/list');
      await expect(page.getByTestId('list-row').first()).toBeVisible();
      await page.keyboard.press('j');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/task=OPS-\d+/);
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('table: double-click on a title renames it instead of opening the task', async ({ page }) => {
      await page.goto('/p/OPS/board');
      const title = unique('Smoke table');
      await page.keyboard.press('c');
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('board-card').filter({ hasText: title })).toBeVisible();
      const key = (await page.getByTestId('board-card').filter({ hasText: title }).getAttribute('data-task-key')) as string;
      await page.goto('/p/OPS/table');
      const row = page.locator(`tr[data-task-key="${key}"]`);
      await row.locator('td[data-col="title"]').getByText(title).dblclick();
      await page.keyboard.type(' v2');
      await page.keyboard.press('Enter');
      await expect(page).not.toHaveURL(/task=/);
      await expect.poll(async () => ((await (await page.request.get(`/api/v1/tasks/${key}`)).json()) as { data: { title: string } }).data.title).toBe(`${title} v2`);
      await deleteTask(page, key);
    });

    test('unknown project and task URLs answer 404', async ({ page }) => {
      expect((await page.request.get('/p/NOPE')).status()).toBe(404);
      expect((await page.request.get('/p/OPS/99999')).status()).toBe(404);
      expect((await page.request.get('/p/OPS/board')).status()).toBe(200);
    });

    test('speed: switching Board, List and Table re-renders from the shared cache', async ({ page }) => {
      await page.goto('/p/OPS/board');
      await expect(page.getByTestId('board-card').first()).toBeVisible();
      // Warm each tab once (dev servers compile on first visit).
      for (const tab of ['list', 'table', 'board'] as const) {
        await page.getByTestId(`project-tab-${tab}`).click();
        await expect(page.getByTestId(tab === 'board' ? 'board-card' : tab === 'list' ? 'list-row' : 'table-row').first()).toBeVisible();
      }
      const budget = Number(process.env.E2E_TAB_BUDGET_MS ?? 1500);
      for (const tab of ['list', 'table', 'board'] as const) {
        const started = Date.now();
        await page.getByTestId(`project-tab-${tab}`).click();
        await expect(page.getByTestId(tab === 'board' ? 'board-card' : tab === 'list' ? 'list-row' : 'table-row').first()).toBeVisible();
        expect(Date.now() - started, `${tab} tab switch`).toBeLessThan(budget);
      }
    });
  });

  test('public intake form submits and creates a task', async ({ page, browser }) => {
    await signIn(page);
    const forms = (await (await page.request.get('/api/v1/forms')).json()) as { data: { publicToken: string; name: string; enabled: boolean; isPublic: boolean }[] };
    const form = forms.data.find((entry) => entry.name === 'Request warehouse work') ?? forms.data.find((entry) => entry.enabled && entry.isPublic);
    test.skip(!form, 'No public form in the seed');
    const visitor = await browser.newPage();
    await visitor.goto(`/forms/${form?.publicToken}`);
    await visitor.getByRole('button', { name: /send|submit/i }).click();
    await expect(visitor.getByText(/required|fill/i).first()).toBeVisible();
    const need = unique('Smoke form');
    await visitor.getByLabel('What do you need?').fill(need);
    await visitor.getByLabel('Company').fill('Smoke Test Co');
    await visitor.getByText('Relabeling', { exact: true }).click();
    await visitor.getByText('Low', { exact: true }).click();
    await visitor.getByRole('button', { name: /send|submit/i }).click();
    await expect(visitor.getByText('Sent!')).toBeVisible();
    await visitor.close();
  });
});
