/**
 * `npx tsx scripts/inventory-hygiene.ts [--apply] [--purge-fixtures]` (owner M06).
 *
 * --purge-fixtures (with --apply) also removes free stock left in KS-CRIT-* / KS-E2E-* test
 * locations idle for 60+ minutes (--idle-minutes=N), through the ledger ("Inventory Adjustment", note "Test fixture purge").
 *
 * Without --apply: lists inventory hygiene issues (untracked lot/expiry/production values,
 * impossible dates, empty unreferenced buckets) and exits 1 when any exist.
 * With --apply: repairs them through the ledger (Attributes Change rows) and prunes empty
 * buckets, then re-checks. It also adds the default adjustment / damage reasons (Found,
 * Import, Damaged) to databases seeded before they existed. Safe to run more than once.
 */
import type { AppDb } from '../src/server/api/db';
import { closeDb, configuredDatabaseKind, getDb } from '../src/server/db';
import { withWriteTx } from '../src/server/db/sql';
import {
  findFixtureStock,
  findInventoryHygieneIssues,
  purgeFixtureStock,
  repairInventoryHygiene,
} from '../src/server/repositories/inventory-hygiene';
import { ensureDefaultInventoryReasons } from '../src/server/repositories/inventory-lookups';

const apply = process.argv.includes('--apply');
const purgeFixtures = process.argv.includes('--purge-fixtures');
const idleArg = process.argv.find((a) => a.startsWith('--idle-minutes='));
const idleMinutes = idleArg ? Math.max(0, Number(idleArg.split('=')[1]) || 60) : 60;

async function summarize(db: AppDb): Promise<number> {
  const issues = await findInventoryHygieneIssues(db);
  const byCheck = new Map<string, number>();
  for (const i of issues) byCheck.set(i.check, (byCheck.get(i.check) ?? 0) + 1);
  process.stdout.write(
    `  issues: ${issues.length}${issues.length ? ` (${[...byCheck].map(([c, n]) => `${c}=${n}`).join(', ')})` : ''}\n`,
  );
  for (const i of issues.filter((x) => x.check !== 'empty-bucket').slice(0, 30))
    process.stdout.write(`  - [${i.check}] ${i.id}: ${i.message}\n`);
  return issues.length;
}

async function main(): Promise<number> {
  try {
    const db = await getDb();
    process.stdout.write(`inventory hygiene - ${configuredDatabaseKind()}\n`);
    const before = await summarize(db);
    if (!apply) return before === 0 ? 0 : 1;
    const reasons = await withWriteTx(db, async (tx) => await ensureDefaultInventoryReasons(tx));
    process.stdout.write(
      `  default reasons added: ${reasons.length ? reasons.join(', ') : 'none (already present)'}\n`,
    );
    const fixtures = await findFixtureStock(db, new Date(), idleMinutes);
    process.stdout.write(
      `  idle fixture stock: ${fixtures.length} bucket(s)${fixtures.length ? ` (${fixtures.map((f) => `${f.sku}@${f.location}=${f.free}`).join(', ')})` : ''}\n`,
    );
    if (purgeFixtures) {
      const p = await withWriteTx(
        db,
        async (tx) => await purgeFixtureStock(tx, undefined, new Date(), idleMinutes),
      );
      process.stdout.write(
        `  purged ${p.units} fixture unit(s) from ${p.removed} bucket(s), skipped ${p.skipped.length}\n`,
      );
      for (const s of p.skipped) process.stdout.write(`  ~ [${s.check}] ${s.id}: ${s.message}\n`);
    }
    const res = await withWriteTx(db, async (tx) => await repairInventoryHygiene(tx));
    process.stdout.write(
      `  repaired ${res.repaired} bucket(s), deleted ${res.deleted} empty bucket(s), skipped ${res.skipped.length}\n`,
    );
    for (const s of res.skipped.slice(0, 30))
      process.stdout.write(`  ~ [${s.check}] ${s.id}: ${s.message}\n`);
    process.stdout.write('after:\n');
    await summarize(db);
    return 0;
  } finally {
    await closeDb();
  }
}

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `inventory hygiene failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  },
);
