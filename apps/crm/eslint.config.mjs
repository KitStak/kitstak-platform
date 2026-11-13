import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Brand rule: UI copy never uses em dashes, en dashes or double dashes. Write "to" for
    // ranges, " · " for separators and "None" (EMPTY_VALUE from @kitstak/ui/text) for empty
    // values. Escapes ('—') stay allowed for code that parses stored text.
    files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
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
    // Local tooling output (QA screenshots, stale build caches, embedded db, reports).
    ".qa/**",
    ".data/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
