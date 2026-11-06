/**
 * Loads `.env*` files for CLI scripts with the same precedence rules as Next.js.
 * Import this first in every script: `import './load-env';`
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
