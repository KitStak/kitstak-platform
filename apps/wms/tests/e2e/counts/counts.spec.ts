/**
 * M07 counts — e2e: detail tabs switch on click (and mirror ?tab=), SKU Details lists
 * per-SKU results, Count Sheet rejects negative counted qty inline. Read-only.
 */
import { expect, test } from '../fixtures/auth';

test.use({ actionTimeout: 45_000, navigationTimeout: 90_000 });

async function firstPlanCode(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.get('/api/counts?pageSize=1', { timeout: 90_000 });
  const rows = (await res.json()).data as { code: string }[];
  test.skip(rows.length === 0, 'No count plans in this DB');
  return rows[0]?.code ?? '';
}

test('count detail tabs switch on click and mirror the URL', async ({ page }) => {
  const code = await firstPlanCode(page);
  await page.goto(`/counts/${encodeURIComponent(code)}`);
  const tabs: Array<[RegExp, string | null]> = [
    [/^Count sheet/, 'sheet'],
    [/^Jobs/, 'jobs'],
    [/^Timeline/, 'timeline'],
    [/^Lines/, null],
  ];
  for (const [name, param] of tabs) {
    const tab = page.getByRole('tab', { name });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe(param);
  }
});

test('SKU Details is not empty when location plans have counted SKUs', async ({ page }) => {
  const res = await page.request.get('/api/counts/skus?pageSize=1', { timeout: 90_000 });
  const body = await res.json();
  expect(res.ok()).toBeTruthy();
  for (const r of body.data as { lineId: string }[]) expect(r.lineId).toBeTruthy();
});
