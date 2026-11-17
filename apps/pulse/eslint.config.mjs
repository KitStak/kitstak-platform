import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Brand copy rule: no em or en dashes in anything a person reads. Ranges read "to" ("2 to 10",
  // "A to Z"); separators use a middle dot. Regex literals (undash, parsers) are not checked.
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/[\\u2013\\u2014]/]', message: 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.' },
        { selector: 'TemplateElement[value.raw=/[\\u2013\\u2014]/]', message: 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.' },
        { selector: 'JSXText[value=/[\\u2013\\u2014]/]', message: 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.' },
      ],
    },
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
