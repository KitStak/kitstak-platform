/**
 * Design-review P1 regression gate: a dashboard load produces ZERO failed network
 * requests. Before the fix, every page load aborted five shell requests (/api/me,
 * notifications, branding, background-tasks, grid-prefs) because `useApiQuery` made
 * every query cancellable and dev StrictMode's remount aborted the first fetch.
 */
import { expect, test } from '../fixtures/auth';

test('dashboard load produces zero failed requests', async ({ adminPage: page }) => {
  const failures: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    failures.push(`${req.failure()?.errorText ?? 'failed'} ${req.method()} ${req.url()}`);
  });
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  // Settle: shell queries (me, notifications, branding, background-tasks, grid-prefs)
  // and the dashboard payload have all resolved by networkidle; give aborts a beat to surface.
  await page.waitForTimeout(1000);
  expect(failures).toEqual([]);
});
