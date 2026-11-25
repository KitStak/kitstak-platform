import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for signup and billing (docs/billing/SPEC.md section 14.3, docs/billing/TESTING.md).
 *
 * They run against a dev server that is already up, in test gateway mode (no Stripe keys):
 *   deploy/dev/app-start.sh portal
 *   pnpm -F kitstak-portal e2e
 *
 * Point at another server with E2E_BASE_URL (default http://localhost:3300). The specs make their own
 * accounts and organizations, read emails from /dev/outbox and move time with the test tools, so
 * they need the local database from docs/billing/DEV.md (E2E_DATABASE_URL to change it).
 *
 * The launcher tile check needs the portal started with ENTITLEMENTS_DEV_ALLOW_ALL=0, and the product
 * app checks need those apps running in that mode. A part that cannot run is skipped and named in the
 * output, never passed silently.
 *
 * One worker: the specs share one database and one clock of test tools per organization, and the
 * auth server rate limits signups per address.
 */
/**
 * Which Chromium to run. E2E_CHROMIUM wins. Otherwise the browser this Playwright version expects,
 * and when that one is not on the machine (a dev container ships one fixed build and says not to
 * download another), the newest headless shell found in the browsers folder.
 */
function chromiumPath(): string | undefined {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // Fall through to the search below.
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const candidate = path.join(root, build, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const executablePath = chromiumPath();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3300',
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});
