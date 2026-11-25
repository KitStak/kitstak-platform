/**
 * Entitlement backfill (docs/billing/CONTRACTS.md section 20, GO-LIVE.md step 5).
 *
 * Usage, from the repo root (DATABASE_URL must point at the core database):
 *   pnpm -F @kitstak/billing backfill check                lists every organization with no entitlement rows.
 *                                                          Exits 1 when there is at least one.
 *   pnpm -F @kitstak/billing backfill apply manual         manual grants for all four apps (today's behavior).
 *   pnpm -F @kitstak/billing backfill apply trial          a 14 day free trial of all four apps.
 *   pnpm -F @kitstak/billing backfill apply trial quiet    the same, without the welcome email.
 *
 * Against production: node deploy/with-prod-db.mjs pnpm -F @kitstak/billing backfill check
 *
 * Only organizations with no entitlement row are touched. Running it again changes nothing. Run it
 * before ENTITLEMENTS_DEV_ALLOW_ALL is removed in production, or those organizations are locked out.
 */
import { createPgClient } from '@kitstak/db/client-pg';
import { createBillingRuntime } from '../src/server/runtime';
import type { BillingDb } from '../src/server/db';
import { backfillManual, backfillTrial, entitlementCounts, findOrgsWithoutEntitlements, type BackfillLine } from './backfill-lib';

const USAGE = `Usage:
  backfill check
  backfill apply manual
  backfill apply trial
  backfill apply trial quiet`;

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).host;
  } catch {
    return 'unknown host';
  }
}

function printLines(lines: readonly BackfillLine[]): void {
  for (const line of lines) print(`${line.outcome.padEnd(14)}${line.org.slug.padEnd(34)}${line.note}`);
}

async function main(): Promise<void> {
  const [command = 'check', mode, extra] = process.argv.slice(2);
  if (command !== 'check' && command !== 'apply') fail(`Unknown command '${command}'.\n${USAGE}`);
  if (command === 'apply' && mode !== 'manual' && mode !== 'trial') fail(`Say which kind: manual or trial.\n${USAGE}`);
  if (extra !== undefined && !(mode === 'trial' && extra === 'quiet')) fail(`Unknown word '${extra}'.\n${USAGE}`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail('DATABASE_URL is required (for example postgres://postgres:postgres@127.0.0.1:5544/kitstak).');

  const client = createPgClient(connectionString, { applicationName: 'kitstak-billing-backfill', max: 2 });
  const db = client.db as unknown as BillingDb;
  try {
    // The host only. The address holds a password and is never printed.
    print(`Database: ${hostOf(connectionString)}`);
    const missing = await findOrgsWithoutEntitlements(db);

    if (command === 'check') {
      if (missing.length === 0) {
        const counts = await entitlementCounts(db);
        print(`All ${counts.orgs} organizations have entitlement rows. Nothing to do.`);
        return;
      }
      print(`${missing.length} organizations have no entitlement rows:`);
      for (const org of missing) print(`  ${org.slug.padEnd(34)}${org.name} (${org.members} ${org.members === 1 ? "person" : "people"})`);
      print();
      print('Run "backfill apply manual" (keep today\'s access) or "backfill apply trial" (start a 14 day trial).');
      process.exit(1);
    }

    if (missing.length === 0) {
      print('Every organization already has entitlement rows. Nothing was changed.');
      return;
    }

    if (mode === 'manual') {
      const lines = await backfillManual(db);
      printLines(lines);
      print();
      print(`${lines.length} organizations got manual grants.`);
      return;
    }

    // A trial needs no gateway, so the runtime is built with no Stripe key on purpose.
    const rt = createBillingRuntime({
      db,
      env: { NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development' } as NodeJS.ProcessEnv,
      portalUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? 'https://kitstak.app',
    });
    const lines = await backfillTrial(rt, { quiet: extra === 'quiet' });
    printLines(lines);
    print();
    const started = lines.filter((line) => line.outcome === 'trial_started').length;
    const skipped = lines.length - started;
    print(`${started} trials started, ${skipped} skipped.`);
    if (skipped > 0) process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
