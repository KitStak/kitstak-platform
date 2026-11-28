/**
 * `pnpm -F kitstak-ledger db:seed [org-slug]` (docs/ledger/SPEC.md 11), idempotent. Phase 0 runs
 * step 1: wipe the org's `ledger` rows under `ledger.allow_purge`, then build the setup through
 * the domain layer: the default chart, terms, numbering and reminders (`writeDefaults`), the
 * items, the Austin tax rate, the WMS and program fee mappings and the demo roles. Later phases
 * add steps 2 to 9 here. Prints row counts at the end.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { accounts, items, memberRoles, sourceMappings, taxRates } from '@/server/db/schema';
import { asSystem, withOrg } from '@/server/db/scope';
import { writeDefaults } from '@/server/domain/setup';
import { purgeLedgerRows } from '@/server/domain/purge';
import { SEED_ITEMS, SEED_MAPPINGS, SEED_ROLES, SEED_TAX_RATE } from './setup-data';

loadDotenv({ path: path.resolve(__dirname, '../../../../.env.local'), quiet: true });
loadDotenv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

async function findOrg(slug: string): Promise<{ id: string; slug: string }> {
  const result = await asSystem('seed: find the org by slug and its people by email', () =>
    db.execute<{ id: string; slug: string }>(sql`select id, slug from core.organization where slug = ${slug} limit 1`),
  );
  const org = result.rows[0];
  if (!org) throw new Error(`No organization with slug "${slug}". Run the core seed first.`);
  return org;
}

async function seedSetup(orgId: string, slug: string): Promise<void> {
  await withOrg(orgId, () =>
    db.transaction(async (tx) => {
      await purgeLedgerRows(tx, orgId);
      await writeDefaults(tx, orgId);
      const chart = await tx.select({ id: accounts.id, number: accounts.number, key: accounts.systemKey }).from(accounts).where(eq(accounts.orgId, orgId));
      const byNumber = new Map(chart.map((row) => [row.number, row.id]));
      const salesTax = chart.find((row) => row.key === 'sales_tax');
      const [rate] = await tx
        .insert(taxRates)
        .values({ orgId, name: SEED_TAX_RATE.name, rateMillionths: SEED_TAX_RATE.rateMillionths, agency: SEED_TAX_RATE.agency, accountId: salesTax!.id })
        .returning({ id: taxRates.id });
      const madeItems = await tx
        .insert(items)
        .values(
          SEED_ITEMS.map((item) => ({
            orgId,
            code: item.code,
            name: item.name,
            unitLabel: item.unitLabel,
            defaultPrice: item.price,
            accountId: byNumber.get(item.account)!,
            taxRateId: item.taxed ? rate!.id : null,
          })),
        )
        .returning({ id: items.id, code: items.code });
      const itemId = new Map(madeItems.map((row) => [row.code, row.id]));
      await tx.insert(sourceMappings).values(SEED_MAPPINGS.map((mapping) => ({ orgId, source: mapping.source, key: mapping.key, itemId: itemId.get(mapping.item)! })));
      const people = await tx.execute<{ user_id: string; email: string }>(
        sql`select m.user_id, lower(u.email) as email from core.member m join core."user" u on u.id = m.user_id where m.organization_id = ${orgId}::uuid`,
      );
      const userByEmail = new Map(people.rows.map((row) => [row.email, row.user_id]));
      for (const { email, role } of SEED_ROLES[slug] ?? []) {
        const userId = userByEmail.get(email);
        if (!userId) {
          process.stdout.write(`db:seed - ${email} is not a member of ${slug}, skipped\n`);
          continue;
        }
        await tx.insert(memberRoles).values({ orgId, userId, role }).onConflictDoNothing();
      }
    }),
  );
}

async function counts(orgId: string): Promise<Record<string, number>> {
  const tables = ['accounts', 'terms', 'number_sequences', 'reminder_rules', 'items', 'tax_rates', 'source_mappings', 'member_roles'];
  const out: Record<string, number> = {};
  await withOrg(orgId, async () => {
    for (const table of tables) {
      const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier('ledger')}.${sql.identifier(table)} where org_id = ${orgId}::uuid`);
      out[table] = result.rows[0]?.n ?? 0;
    }
    const check = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.orgId, orgId), sql`${accounts.systemKey} is not null`));
    out.system_accounts = check.length;
  });
  return out;
}

async function main(): Promise<void> {
  const slug = process.argv[2]?.trim() || 'kitstak';
  const org = await findOrg(slug);
  await seedSetup(org.id, org.slug);
  process.stdout.write(`db:seed - ${slug} step 1 (setup) done: ${JSON.stringify(await counts(org.id))}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
