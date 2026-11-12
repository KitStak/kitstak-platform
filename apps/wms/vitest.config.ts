import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * Unit/integration test runner.
 *
 * - Default environment is `node` (server code: repositories, domain, query grammar).
 * - Component tests opt into the DOM per file with a docblock:
 *     // @vitest-environment jsdom
 * - Playwright specs under tests/e2e are excluded; run them with `npm run test:e2e`.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.join(root, "src")}/` },
      // Next's "server-only" guard throws outside a React Server environment.
      { find: /^server-only$/, replacement: path.join(root, "tests/setup/empty-module.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    setupFiles: ["tests/setup/vitest.setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
    // Each file gets its own fork; on a loaded machine (dev server + e2e running)
    // spawning one per core can exceed vitest's fixed 60s worker start timeout.
    maxWorkers: "50%",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: ".data/coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/app/**/page.tsx", "src/app/**/layout.tsx"],
    },
  },
});
