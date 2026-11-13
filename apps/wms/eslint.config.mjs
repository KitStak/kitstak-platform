import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Every list page uses the canonical fetch-in-effect pattern
      // (setLoading(true) before fetch, setPage(1) on filter change).
      // The React Compiler lint flags synchronous setState in effects as a
      // performance advisory, not a correctness bug. Keep it visible as a
      // warning; revisit if data fetching moves to a query library.
      "react-hooks/set-state-in-effect": "warn",
      // React Compiler advisories (reading refs during render in wizard step
      // guards, Date.now in a dashboard clock). Not correctness bugs today;
      // kept visible as warnings.
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // Column-definition factories return inline cell renderers.
    files: ["src/components/**/*-columns.tsx"],
    rules: { "react/display-name": "off" },
  },
  {
    // Node CommonJS helper scripts.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Brand rule: UI copy never uses em dashes, en dashes or double dashes. Write "to" for
    // ranges, " · " for separators and "None" (EMPTY_VALUE from @kitstak/ui/text) for empty
    // values. Escapes ('—') stay allowed for code that parses stored text.
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal:not([regex])[raw=/[–—]/]",
          message: "No em or en dashes in UI strings: use 'to' for ranges, ' · ' as a separator, or EMPTY_VALUE for an empty value.",
        },
        {
          selector: "TemplateElement[value.raw=/[–—]/]",
          message: "No em or en dashes in UI strings: use 'to' for ranges, ' · ' as a separator, or EMPTY_VALUE for an empty value.",
        },
        {
          selector: "JSXText[value=/[–—]|--/]",
          message: "No em dashes, en dashes or double dashes in UI copy.",
        },
      ],
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
