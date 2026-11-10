import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every list page uses the canonical fetch-in-effect pattern
      // (setLoading(true) before fetch, setPage(1) on filter change).
      // The React Compiler lint flags synchronous setState in effects as a
      // performance advisory, not a correctness bug. Keep it visible as a
      // warning; revisit if data fetching moves to a query library.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local data, coverage and Playwright reports/traces (generated, gitignored).
    ".data/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
