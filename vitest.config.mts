import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *   node — server/lib logic (`*.test.ts`)
 *   dom  — React components and browser utilities (`*.test.tsx`, `*.dom.test.ts`) in jsdom
 * Run one with `npx vitest run --project node` / `--project dom`.
 *
 * `.mts` (not `.ts`): the package is CommonJS, and Vite warns about ESM configs loaded as CJS.
 */
const root = path.dirname(fileURLToPath(import.meta.url));

const DOM_TESTS = [
  'src/**/*.test.tsx',
  'src/**/*.dom.test.ts',
  'tests/**/*.test.tsx',
  'tests/**/*.dom.test.ts',
  'e2e/support/**/*.dom.test.ts',
];

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      'server-only': path.resolve(root, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    restoreMocks: true,
    passWithNoTests: true,
    exclude: ['e2e/**/*.spec.ts', 'node_modules/**', '.next/**', '.qa/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'e2e/support/**/*.test.ts'],
          exclude: ['**/*.dom.test.ts', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: DOM_TESTS,
          css: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      // Thresholds gate logic modules; UI is covered by e2e + visual review (docs/QA.md).
      include: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
      exclude: [
        'src/server/db/schema/**',
        'src/server/db/seed/**',
        'src/server/db/embedded.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
