import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** `.mts` (not `.ts`): the package is CommonJS, and Vite warns about ESM configs loaded as CJS. */
const root = path.dirname(fileURLToPath(import.meta.url));

const resolve = {
  alias: {
    '@': path.resolve(root, 'src'),
    // `server-only` throws outside a React Server Component bundle; unit tests import server modules directly.
    'server-only': path.resolve(root, 'src/test/server-only-stub.ts'),
  },
};

const shared = {
  restoreMocks: true,
  passWithNoTests: true,
  environment: 'node' as const,
  // Loads .env.local so database tests can find DATABASE_URL (they skip when it is not reachable).
  setupFiles: ['src/test/setup-env.ts'],
  exclude: ['node_modules/**', '.next/**', '.next-*/**'],
};

/**
 * Two projects: `unit` (pure tests) and `db` (`*.db.test.ts` against DATABASE_URL, one file at a
 * time, each suite in its own throwaway org). `vitest run` runs both; `vitest run --project db`
 * runs only the database tests.
 */
export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: { ...shared, name: 'unit', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], exclude: [...shared.exclude, 'src/**/*.db.test.ts'] },
      },
      {
        resolve,
        test: { ...shared, name: 'db', include: ['src/**/*.db.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
  },
});
