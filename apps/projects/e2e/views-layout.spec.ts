import { expect, test, type Page } from '@playwright/test';

/**
 * Views layout checks (views round 3):
 * - List titles are never cut while the row has spare room: the title has first claim on the width
 *   and chips fold into "+N" first. Checked at 1280 and 1440 on OPS and PEAK.
 * - Board, List and Table paint real task rows in the first HTML (server data seeds the cache).
 *   `E2E_BASE_URL=http://localhost:3420 npx playwright test e2e/views-layout.spec.ts`
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3400';

async function signIn(page: Page) {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' },
    headers: { origin: ORIGIN() },
  });
  expect(response.ok(), `sign in answered ${response.status()}`).toBeTruthy();
}

for (const width of [1280, 1440]) {
  for (const key of ['OPS', 'PEAK']) {
    test(`list titles are not cut while there is room (${key}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      await page.goto(`/p/${key}/list`);
      await expect(page.locator('[data-testid="list-row"]').first()).toBeVisible();
      const offenders = await page.$$eval('[data-testid="list-row"]', (rows) =>
        rows.flatMap((row) => {
          const title = row.querySelector<HTMLElement>('span[title]');
          if (!title || title.scrollWidth <= title.clientWidth + 1) return [];
          // A cut title is only fair when every chip has already folded into "+N" (no chip is
          // still drawn beside it) and no empty spacer is left in the title area.
          const area = title.parentElement as HTMLElement;
          const drawnChips = Array.from(area.querySelectorAll<HTMLElement>('[data-badge]'))
            .map((badge) => badge.parentElement as HTMLElement)
            .flatMap((chips) => Array.from(chips.children) as HTMLElement[])
            .filter((chip) => !chip.dataset.badge && chip.style.visibility !== 'hidden');
          const spacer = Array.from(area.children).find((child) => child.getAttribute('aria-hidden') === 'true' && (child as HTMLElement).getBoundingClientRect().width > 40);
          return drawnChips.length || spacer ? [title.textContent ?? ''] : [];
        }),
      );
      expect(offenders).toEqual([]);
    });
  }
}

test('board, list and table render tasks in the first HTML', async ({ page }) => {
  await signIn(page);
  for (const view of ['board', 'list', 'table']) {
    const response = await page.request.get(`/p/OPS/${view}`);
    const html = await response.text();
    expect(html.match(/data-task-key/g)?.length ?? 0, `${view} server HTML has task rows`).toBeGreaterThan(0);
  }
});
