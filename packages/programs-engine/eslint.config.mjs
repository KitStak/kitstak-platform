import { defineConfig, globalIgnores } from 'eslint/config';
import nextTs from 'eslint-config-next/typescript';

/**
 * Lint for the pure engine: the same TypeScript rules the apps use (eslint-config-next/typescript)
 * and the brand copy rule, because the engine returns UI copy (labels, reasons, messages) that the
 * apps show as is. No em or en dashes in anything a person reads; ranges read "to".
 */
const eslintConfig = defineConfig([
  ...nextTs,
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/[\\u2013\\u2014]/]', message: 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.' },
        { selector: 'TemplateElement[value.raw=/[\\u2013\\u2014]/]', message: 'No em or en dashes in UI copy. Use "to" for ranges or a middle dot.' },
      ],
    },
  },
  globalIgnores(['coverage/**', 'node_modules/**']),
]);

export default eslintConfig;
