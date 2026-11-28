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
      'server-only': path.resolve(root, 'src/test/server-only-stub.ts'),
    },
  },
  test: {
    restoreMocks: true,
    passWithNoTests: true,
    environment: 'node',
    // Loads .env.local so database tests can find DATABASE_URL (they skip when it is not reachable).
    setupFiles: ['src/test/setup-env.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', '.next-*/**'],
  },
});
