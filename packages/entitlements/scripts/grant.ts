/**
 * Manual entitlement CLI (the production write path while Stripe is deferred).
 *
 * Usage (from the repo root; DATABASE_URL must point at the core database):
 *   pnpm --filter @kitstak/entitlements grant grant <org-slug> <crm|wms|projects>
 *   pnpm --filter @kitstak/entitlements grant revoke <org-slug> <crm|wms|projects>
 *   pnpm --filter @kitstak/entitlements grant list <org-slug>
 *
 * Grants/revokes are written with source 'manual'.
 */
import { eq } from 'drizzle-orm';
import { createPgClient, schema } from '@kitstak/db/client-pg';
import { grantModule, revokeModule } from '../src/grant';
import { MODULES, isModule, type Module } from '../src/modules';
import { getEntitlements, isEntitled } from '../src/read';

const USAGE = `Usage:
  grant <org-slug> <${MODULES.join('|')}>
  revoke <org-slug> <${MODULES.join('|')}>
  list <org-slug>`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseModule(raw: string | undefined): Module {
  if (!raw || !isModule(raw))
    fail(`Unknown module '${raw ?? ''}'. Expected one of: ${MODULES.join(', ')}.\n${USAGE}`);
  return raw;
}

async function main(): Promise<void> {
  const [action, slug, moduleArg] = process.argv.slice(2);
  if (!action || !slug || !['grant', 'revoke', 'list'].includes(action)) fail(USAGE);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    fail('DATABASE_URL is required (e.g. postgres://postgres:postgres@127.0.0.1:5544/kitstak).');

  const client = createPgClient(connectionString, { applicationName: 'kitstak-entitlements-cli', max: 1 });
  try {
    const orgs = await client.db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1);
    const org = orgs[0];
    if (!org) fail(`No organization with slug '${slug}'.`);

    if (action === 'list') {
      const snapshot = await getEntitlements(client.db, org.id);
      process.stdout.write(`Entitlements for ${org.name} (${slug}, ${org.id}):\n`);
      for (const module of MODULES) {
        const entry = snapshot[module];
        const line = entry
          ? `${entry.status} (source ${entry.source}${
              entry.periodEnd ? `, period end ${entry.periodEnd.toISOString()}` : ''
            }) → ${isEntitled(entry) ? 'ENTITLED' : 'BLOCKED'}`
          : 'no row → BLOCKED';
        process.stdout.write(`  ${module.padEnd(4)} ${line}\n`);
      }
      return;
    }

    const module = parseModule(moduleArg);
    if (action === 'grant') {
      await grantModule(client.db, org.id, module, 'manual');
      process.stdout.write(`Granted ${module} to ${org.name} (${slug}) [source manual].\n`);
    } else {
      await revokeModule(client.db, org.id, module, 'manual');
      process.stdout.write(`Revoked ${module} from ${org.name} (${slug}) [source manual].\n`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
