/**
 * M05 performance budget. For every receiving route: one warm-up load (the dev server compiles
 * the route on first hit), then the measured load, from navigation to the first data row (or the
 * screen's primary control). Also: the receipt drawer opens from the cached grid row, and the
 * putaway dialog shows its suggestions from the prefetched cache.
 *
 * Budgets default to the dev server (`next dev`, unminified, shared with other modules) and can
 * be tightened for a production build with E2E_PERF_BUDGET_MS / E2E_PERF_DRAWER_MS.
 * Run: E2E_BASE_URL=http://localhost:3000/ npx playwright test tests/e2e/inbound-receiving/perf-budget.spec.ts --project=e2e --no-deps
 */
import { expect, test } from "../fixtures/auth";
import { quietHmr } from "./helpers";

const PAGE_BUDGET_MS = Number(process.env.E2E_PERF_BUDGET_MS ?? 4_000);
const DRAWER_BUDGET_MS = Number(process.env.E2E_PERF_DRAWER_MS ?? 600);

const ROUTES: readonly (readonly [string, string])[] = [
  ["/receiving", "tr[data-row-id]"],
  ["/receiving/history", "tr[data-row-id]"],
  ["/receiving/vendors", "tr[data-row-id]"],
  ["/receiving/putaway", '[data-testid="putaway-count"]:not(:has-text("Loading"))'],
  ["/receiving/transactions", "tr[data-row-id]"],
  ["/receiving/rf", '[data-testid="rf-po-scan"]'],
  ["/receiving/import", "text=Import history"],
];

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await quietHmr(page.context());
});

test("receiving routes render their data within the budget", async ({ page }) => {
  test.setTimeout(240_000);
  const results: string[] = [];
  for (const [route, ready] of ROUTES) {
    await page.goto(route);
    await page.locator(ready).first().waitFor();
    const t0 = Date.now();
    await page.goto(route);
    await page.locator(ready).first().waitFor();
    const ms = Date.now() - t0;
    results.push(`${route} ${ms} ms`);
    expect.soft(ms, `${route} took ${ms} ms (budget ${PAGE_BUDGET_MS} ms)`).toBeLessThan(PAGE_BUDGET_MS);
  }
  test.info().annotations.push({ type: "timings", description: results.join(" · ") });
});

test("receipt drawer opens from the cached row", async ({ page }) => {
  await page.goto("/receiving/history");
  const row = page.locator("tr[data-row-id]").first();
  await row.waitFor();
  const masterId = (await row.locator("button").first().textContent())?.trim() ?? "";
  const t0 = Date.now();
  await row.getByRole("button", { name: masterId, exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Receiving type")).toBeVisible();
  const ms = Date.now() - t0;
  expect(ms, `receipt drawer took ${ms} ms`).toBeLessThan(DRAWER_BUDGET_MS);
});

test("putaway suggestions render from the prefetched cache", async ({ page }) => {
  await page.goto("/receiving/putaway");
  await page.locator('[data-testid="putaway-count"]:not(:has-text("Loading"))').waitFor();
  const row = page.locator("tr[data-row-id]").first();
  test.skip((await row.count()) === 0, "No putaway task on the dev DB");
  // Let the background prefetch of the first tasks finish.
  await page.waitForLoadState("networkidle");
  const t0 = Date.now();
  await row.click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.locator('section[aria-label="Suggested locations"] button, section[aria-label="Suggested locations"] p').first()).toBeVisible();
  await expect(dlg.locator('section[aria-label="Suggested locations"] [data-slot="skeleton"], section[aria-label="Suggested locations"] .animate-pulse')).toHaveCount(0);
  const ms = Date.now() - t0;
  expect(ms, `putaway dialog took ${ms} ms`).toBeLessThan(DRAWER_BUDGET_MS);
});
