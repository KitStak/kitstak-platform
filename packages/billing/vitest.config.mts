import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@kitstak/config/vitest/base';

export default defineConfig({
  test: {
    ...sharedTestOptions,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Database tests share one local Postgres; run files one at a time so they never race.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
