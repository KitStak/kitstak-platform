/**
 * Same harness as playwright.config.ts with patient timeouts for the shared, heavily loaded dev
 * server (many agents compile against :3100 at once). Run: npx playwright test -c e2e/admin.slow.config.ts
 */
import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

process.env.E2E_ADMIN_TIMEOUT_MS ??= '600000';
process.env.E2E_ADMIN_STEP_MS ??= '150000';

export default defineConfig({
  ...base,
  testDir: '.',
  globalSetup: './global-setup.ts',
  outputDir: '../test-results/admin-slow',
  testMatch: 'admin.spec.ts',
  workers: 1,
  retries: 1,
  timeout: 600_000,
  expect: { timeout: 90_000 },
  reporter: [['line']],
  use: { ...base.use, actionTimeout: 120_000, navigationTimeout: 180_000, trace: 'off' },
});
