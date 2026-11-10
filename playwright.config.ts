import { defineConfig, devices } from "@playwright/test";
import { DEFAULT_BASE_URL, e2eBaseUrl, storageStatePath } from "./tests/e2e/fixtures/roles";

/**
 * E2E runner. Targets an already-running app (default http://localhost:3000)
 * and reuses it; only starts `next dev` when nothing is listening locally.
 *
 * Projects:
 *   auth-setup        logs in once per role -> .data/e2e-auth/<role>.json
 *   e2e               every tests/e2e/** suite (admin storage state by default)
 *   dead-click-audit  the crawler (`npm run audit:dead-clicks`)
 */
const baseURL = e2eBaseUrl();
const isLocalDefault = baseURL === DEFAULT_BASE_URL;
const OUTPUT_ROOT = ".data/playwright";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `${OUTPUT_ROOT}/test-results`,
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: `${OUTPUT_ROOT}/report`, open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    // Optional override when the pinned Playwright browser build is not installed locally.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /fixtures[\\/]auth\.setup\.ts$/,
    },
    {
      name: "e2e",
      testIgnore: [/fixtures[\\/]/],
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: storageStatePath("admin") },
    },
    {
      name: "dead-click-audit",
      testMatch: /fixtures[\\/]dead-click-audit\.spec\.ts$/,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: isLocalDefault
    ? {
        command: "npx next dev -p 3000",
        url: `${DEFAULT_BASE_URL}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
