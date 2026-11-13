import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@kitstak/config/vitest/base';

export default defineConfig({
  test: {
    ...sharedTestOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
