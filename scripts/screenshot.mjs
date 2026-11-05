#!/usr/bin/env node
/**
 * Screenshot harness for visual critique.
 * Usage: node scripts/screenshot.mjs <outDir> <path1> [path2 ...]
 *
 * Every /api/* data route sits behind the session cookie (see
 * src/middleware.ts), so the harness logs in with the demo admin first — that
 * seeds the headless context — and verifies the PO list query actually
 * resolves before capturing anything. Each page is then captured at 1440x900
 * only after real content has painted: loading skeletons must clear and, when
 * the page renders a data grid, at least one real (non-skeleton) cell must
 * exist. Without these waits the capture can fire mid-hydration and freeze
 * the grid in its skeleton state.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SHOT_EMAIL ?? "admin@kitstak.io";
const PASSWORD = process.env.SHOT_PASSWORD ?? "KitStak!demo2026";

/** How long to wait for real data to paint before giving up on a page. */
const DATA_TIMEOUT_MS = 15000;
/**
 * A painted grid cell. Plain "tbody td" (not "tbody td a"): several grids
 * (e.g. /clients) render real data cells without anchors, which made the old
 * selector false-warn on fully painted grids. Skeleton rows are excluded by
 * the skeleton wait above, and loading cells contain .ks-skeleton, so a
 * non-skeleton td only exists once real rows (or empty/error states) paint.
 */
const REAL_CELL_SELECTOR = "tbody td:not(:has(.ks-skeleton))";
/** Loading placeholders (see .ks-skeleton in globals.css). */
const SKELETON_SELECTOR = ".ks-skeleton";
/** Short settle for charts/transitions after data has painted. */
const SETTLE_MS = 400;

const [outDir, ...paths] = process.argv.slice(2);
if (!outDir || paths.length === 0) {
  console.error("Usage: node scripts/screenshot.mjs <outDir> <path1> [path2 ...]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

// login once — the session cookie lands on the shared context
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');

/*
 * page.waitForURL(...) hangs here even when the SPA navigation lands on
 * /dashboard within ~3s (predicate/commit race with the client router), so
 * poll page.url() instead — resolves as soon as the URL leaves /login.
 */
const LOGIN_POLL_INTERVAL_MS = 1000;
const LOGIN_TIMEOUT_MS = 30000;
let loginWaitedMs = 0;
while (new URL(page.url()).pathname.startsWith("/login")) {
  if (loginWaitedMs >= LOGIN_TIMEOUT_MS) {
    console.error(
      `fatal: still on ${page.url()} ${LOGIN_TIMEOUT_MS}ms after submitting login — ` +
        "check the demo credentials / dev server."
    );
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  loginWaitedMs += LOGIN_POLL_INTERVAL_MS;
}

// verify the PO data query resolves with the seeded session (shares cookies)
const apiCheck = await page.request.get(
  `${BASE}/api/purchase-orders?page=1&pageSize=1`
);
if (!apiCheck.ok()) {
  console.error(
    `fatal: /api/purchase-orders returned ${apiCheck.status()} after login — ` +
      "data queries will not resolve in this context; check the seeded session."
  );
  await browser.close();
  process.exit(1);
}

/** Wait for loading skeletons to clear, then for a real grid cell (if any grid). */
async function waitForRealContent(p) {
  try {
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 0,
      SKELETON_SELECTOR,
      { timeout: DATA_TIMEOUT_MS }
    );
  } catch {
    console.warn(`warn: ${p} still shows loading skeletons after ${DATA_TIMEOUT_MS}ms`);
  }
  const hasGrid = (await page.locator("tbody").count()) > 0;
  if (!hasGrid) return;
  try {
    await page.waitForSelector(REAL_CELL_SELECTOR, { timeout: DATA_TIMEOUT_MS });
  } catch {
    console.warn(
      `warn: ${p} has a grid but no real cell (${REAL_CELL_SELECTOR}) painted ` +
        `within ${DATA_TIMEOUT_MS}ms — capture may show an empty/stalled grid`
    );
  }
}

for (const p of paths) {
  const name =
    p.replaceAll("/", "_").replaceAll("?", "-").replaceAll("=", "-").replace(/^_/, "") ||
    "home";
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  await waitForRealContent(p);
  await page.waitForTimeout(SETTLE_MS);
  const file = path.join(outDir, `${name}.png`);
  // fullPage: the viewport-only capture clipped below-the-fold cards (e.g. the
  // dashboard's rank cards mid-row and the Jobs card), making them unreviewable.
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

await browser.close();
