/**
 * Regenerates the Better Auth Drizzle schema from the shared auth options, then rewraps
 * the generated `pgTable(...)` calls into the shared `core` pg schema (the Better Auth
 * tables were relocated from `public` to `core` by drizzle/0003_core_auth.sql —
 * BLUEPRINT.md §1.3/§2.1). The CLI has no schema option, so the wrap is a deterministic
 * post-process here; keep it in lockstep with `src/server/db/schema/auth.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** Shared home (blueprint §1.4): both apps import this module from @kitstak/db. */
const OUTPUT = '../../packages/db/src/schema/core/auth.ts';

const CORE_SCHEMA_BANNER = `/**
 * Better Auth tables live in the shared \`core\` schema (BLUEPRINT.md §1.3/§2.1;
 * relocated from \`public\` by apps/crm/drizzle/0003_core_auth.sql, created from
 * scratch for WMS-local databases by apps/wms/drizzle/0007_core_auth.sql).
 * Shared home for BOTH apps (blueprint §1.4): CRM re-exports this module from
 * \`apps/crm/src/server/db/schema/auth.ts\`; WMS passes these objects to the Better
 * Auth drizzle adapter. The CRM \`auth:schema\` generator regenerates THIS file and
 * post-processes its output into the same \`core.table(...)\` wrapping — see
 * apps/crm/scripts/generate-auth-schema.ts.
 */
const core = pgSchema("core");
`;

function wrapInCoreSchema(source: string): string {
  if (!source.includes('pgTable')) return source;
  const importsFixed = source.replace(/\bpgTable\b(?=,|\s*,|\s*\})/, 'pgSchema');
  const tablesWrapped = importsFixed.replace(/\bpgTable\(/g, 'core.table(');
  return tablesWrapped.replace(/(} from "drizzle-orm\/pg-core";\r?\n)/, `$1\n${CORE_SCHEMA_BANNER}`);
}

const result = spawnSync(
  'npx',
  [
    '--yes',
    'auth@1.7.18',
    'generate',
    '--config',
    'scripts/auth-schema.config.ts',
    '--output',
    OUTPUT,
    '--adapter',
    'drizzle',
    '--dialect',
    'postgresql',
    '--yes',
  ],
  { stdio: 'inherit', shell: true },
);

if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const generated = readFileSync(OUTPUT, 'utf8');
const wrapped = wrapInCoreSchema(generated);
if (wrapped !== generated) {
  writeFileSync(OUTPUT, wrapped);
  process.stdout.write(`auth:schema - wrapped generated tables in pgSchema('core') (${OUTPUT})\n`);
}
process.exit(0);
