import { defineConfig } from 'vitest/config';
import { coverageThresholds, sharedTestOptions } from '@kitstak/config/vitest/base';

export default defineConfig({
  test: {
    ...sharedTestOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.fixture.ts', 'src/types.ts', 'src/index.ts'],
      thresholds: coverageThresholds,
    },
  },
});
