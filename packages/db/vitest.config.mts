import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@kitstak/config/vitest/base';

/**
 * Unit tests (`*.test.ts`) are pure. Database tests (`*.db.test.ts`) run against DATABASE_URL and
 * skip when it does not answer; each suite makes its own throwaway organization (B.3).
 */
const root = path.dirname(fileURLToPath(import.meta.url));
for (const file of ['.env.local', '.env', '../../apps/projects/.env.local']) loadEnv({ path: path.resolve(root, file), quiet: true });

export default defineConfig({
  test: {
    ...sharedTestOptions,
    passWithNoTests: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
