import type { ViteUserConfig } from 'vitest/config';

type TestOptions = NonNullable<ViteUserConfig['test']>;
type CoverageOptions = NonNullable<TestOptions['coverage']>;
type CoverageThresholds = NonNullable<CoverageOptions['thresholds']>;

/**
 * Shared vitest defaults for KitStak apps. Each app spreads what it needs into
 * its own `defineConfig` — environments, includes, and aliases stay app-local.
 */

/** Coverage gates every workspace project must meet (see BLUEPRINT.md §4). */
export const coverageThresholds = {
  lines: 80,
  functions: 80,
  branches: 75,
} as const satisfies CoverageThresholds;

/** Test options common to every app: mocks are restored between tests. */
export const sharedTestOptions = {
  restoreMocks: true,
} as const satisfies TestOptions;
