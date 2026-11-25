import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from '@kitstak/config/vitest/base';

export default defineConfig({
  test: {
    ...sharedTestOptions,
    // Node by default (pure token/theme helpers); DOM-dependent suites opt in with
    // `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
