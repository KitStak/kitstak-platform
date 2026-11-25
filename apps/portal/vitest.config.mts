import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** `.mts` (not `.ts`): the package is CommonJS, and Vite warns about ESM configs loaded as CJS. */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // `server-only` throws outside a React Server Component bundle; unit tests import server modules directly.
      'server-only': path.resolve(root, 'src/server/billing/server-only-stub.ts'),
    },
  },
  test: {
    restoreMocks: true,
    passWithNoTests: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Playwright specs live in e2e/ and run with `pnpm e2e`, never with vitest.
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
  },
});
