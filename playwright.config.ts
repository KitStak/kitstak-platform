import { defineConfig, devices } from '@playwright/test';
import { chromiumLaunchOptions } from './e2e/support/browser';
import { ADMIN_STORAGE_STATE, baseUrl } from './e2e/support/paths';

/**
 * E2E + visual harness. The dev server is NOT owned by Playwright: global setup calls
 * `ensureDevServer()` (same as `npx tsx scripts/ensure-dev.ts`), which reuses a running
 * server or starts one detached, so many agents can share a single server on :3100.
 *
 * Every test runs as the seeded demo admin (storage state from global setup) unless it
 * opts out with `test.use({ storageState: LOGGED_OUT_STATE })`.
 */
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: baseUrl(),
    storageState: ADMIN_STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Video needs Playwright's ffmpeg build (`npx playwright install ffmpeg`); opt in with E2E_VIDEO=1.
    video: process.env.E2E_VIDEO === '1' ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // Dev-mode first compiles are slow; keep headless deterministic.
    launchOptions: chromiumLaunchOptions(),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
