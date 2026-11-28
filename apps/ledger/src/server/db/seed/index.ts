/**
 * `pnpm -F kitstak-ledger db:seed [org-slug]` (docs/ledger/SPEC.md 11), idempotent. Phase 1 runs
 * steps 1 and 2: wipe the org's `ledger` rows under `ledger.allow_purge`, then build the setup through
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
import { SEED_CUSTOMER_PROFILES, SEED_ITEMS, SEED_MAPPINGS, SEED_ROLES, SEED_TAX_RATE, SEED_VENDORS } from './setup-data';
import { saveCustomer } from '@/server/domain/customers';
import { insertVendor, saveVendor } from '@/server/domain/vendors';
import type { DomainContext } from '@/server/domain/_shared';
import type { Transaction } from '@/server/db';

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
      await seedParties(tx, { orgId, orgSlug: slug, userId: 'seed', userName: 'Seed', orgRole: 'owner', actorKind: 'system' }, rate!.id);
    }),
  );
}

/**
 * Step 2 (SPEC 11): customers and vendors. Customers are the org's own `core.customers` rows
 * (never made here); each gets its Ledger profile. Vendors are made up and kept in the shared
 * `core.vendors` by name: a second run finds them and only adds missing kinds, so it is idempotent.
 */
async function seedParties(tx: Transaction, ctx: DomainContext, taxRateId: string): Promise<void> {
  const ids = async (query: ReturnType<typeof sql>) => new Map((await tx.execute<{ key: string; id: string }>(query)).rows.map((row) => [row.key, row.id]));
  const termIds = await ids(sql`select lower(name) as key, id from ledger.terms where org_id = ${ctx.orgId}::uuid and active`);
  const accountIds = await ids(sql`select number as key, id from ledger.accounts where org_id = ${ctx.orgId}::uuid and archived_at is null`);
  const customerIds = await ids(sql`select code as key, id from core.customers where org_id = ${ctx.orgId}::uuid and deleted_at is null`);
  const meta = { seed: true };
  for (const profile of SEED_CUSTOMER_PROFILES[ctx.orgSlug] ?? []) {
    const id = customerIds.get(profile.code);
    if (!id) {
      process.stdout.write(`db:seed - customer ${profile.code} is not in core.customers for ${ctx.orgSlug}, skipped
`);
      continue;
    }
    const core = await tx.execute<{ name: string; phone: string | null }>(sql`select name, phone from core.customers where id = ${id}::uuid`);
    await saveCustomer(
      tx,
      ctx,
      id,
      {
        code: profile.code,
        name: core.rows[0]!.name,
        phone: core.rows[0]!.phone,
        billingContactName: profile.billingContact,
        billingEmails: profile.billingEmails,
        billingAddress: profile.address,
        termsId: termIds.get(profile.terms.toLowerCase()) ?? null,
        defaultTaxRateId: profile.taxed ? taxRateId : null,
        taxExempt: false,
        exemptionNote: null,
        remindersEnabled: profile.remindersEnabled ?? true,
        notes: null,
      },
      null,
      meta,
    );
  }
  if (!(ctx.orgSlug in SEED_CUSTOMER_PROFILES)) return;
  const vendorIds = await ids(sql`select lower(name) as key, id from core.vendors where org_id = ${ctx.orgId}::uuid and archived_at is null and deleted_at is null`);
  for (const vendor of SEED_VENDORS) {
    const input = {
      name: vendor.name,
      kinds: vendor.kinds,
      email: vendor.email,
      phone: vendor.phone,
      address: { line1: '100 Industrial Blvd', city: 'Austin', region: 'TX', postalCode: '78744', country: 'US' },
      notes: null,
      termsId: termIds.get(vendor.terms.toLowerCase()) ?? null,
      defaultAccountId: accountIds.get(vendor.account) ?? null,
      tracks1099: vendor.tracks1099 ?? false,
      w9OnFile: vendor.w9OnFile ?? false,
    };
    const existing = vendorIds.get(vendor.name.toLowerCase());
    if (existing) await saveVendor(tx, ctx, existing, input, { version: null, mode: 'import', meta });
    else await insertVendor(tx, ctx, input, meta);
  }
}

async function counts(orgId: string): Promise<Record<string, number>> {
  const tables = ['accounts', 'terms', 'number_sequences', 'reminder_rules', 'items', 'tax_rates', 'source_mappings', 'member_roles', 'customer_profiles', 'vendor_profiles'];
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
  process.stdout.write(`db:seed - ${slug} steps 1 and 2 (setup, customers and vendors) done: ${JSON.stringify(await counts(org.id))}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
