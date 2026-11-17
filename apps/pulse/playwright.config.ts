import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks against a running dev server (start one first, e.g. `pnpm dev`, or point
 * E2E_BASE_URL at your own port). Each spec signs in as the seeded demo admin.
 *   E2E_BASE_URL=http://localhost:3511 npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3500',
    navigationTimeout: 90_000,
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
