import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
