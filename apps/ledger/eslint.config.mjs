import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// One writer of the books (docs/ledger/SPEC.md 4.3): only src/server/domain/posting.ts inserts
// journal rows. src/server/domain/posting-writer.test.ts also scans for raw SQL inserts.
const ONE_WRITER = {
  selector: "CallExpression[callee.property.name='insert'] > Identifier[name=/^journal(Entries|Lines)$/]",
  message: 'Only src/server/domain/posting.ts writes journal rows. Call postEntry or reverseEntry.',
};

// Brand copy rule: no em or en dashes in anything a person reads. Ranges read "to" ("2 to 10",
// "A to Z"); separators use a middle dot. Regex literals (undash, parsers) are not checked.
const NO_DASH = 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.';
const DASHES = [
  { selector: 'Literal[value=/[\\u2013\\u2014]/]', message: NO_DASH },
  { selector: 'TemplateElement[value.raw=/[\\u2013\\u2014]/]', message: NO_DASH },
  { selector: 'JSXText[value=/[\\u2013\\u2014]/]', message: NO_DASH },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    ignores: ['src/server/domain/posting.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ONE_WRITER] },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ONE_WRITER, ...DASHES] },
  },
  // Override default ignores of eslint-config-next (plus per-agent dev dist dirs and local uploads).
  globalIgnores([
    '.next/**',
    '.next-*/**',
    '.data/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
  ]),
]);

export default eslintConfig;
