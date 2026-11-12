/** Regenerates the Better Auth Drizzle schema from the shared auth options. */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    '--yes',
    'auth@1.7.18',
    'generate',
    '--config',
    'scripts/auth-schema.config.ts',
    '--output',
    'src/server/db/schema/auth.ts',
    '--adapter',
    'drizzle',
    '--dialect',
    'postgresql',
    '--yes',
  ],
  { stdio: 'inherit', shell: true },
);
process.exit(result.status ?? 1);
