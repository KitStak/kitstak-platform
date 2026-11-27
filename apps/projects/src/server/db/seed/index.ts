/**
 * `pnpm --filter kitstak-projects db:seed [-- --org=<slug>]`
 *
 * Rich demo data for the two seeded orgs (KitStak, Northwind Robotics), written through the
 * domain layer and then backdated (see builder.ts / backdate.ts). Idempotent: each run first
 * wipes the `pm` rows of the orgs it seeds. Nothing in other orgs or other schemas is touched.
 *
 * Runs with `tsx --conditions=react-server` so the `server-only` guard resolves to its no-op build.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { closeSeed, orgBySlug } from './context';
import { OrgBuilder, type OrgSeedStats } from './builder';
import { kitstakSeed } from './data/kitstak';
import { northwindSeed } from './data/northwind';
import type { OrgSeed } from './types';
import { ProgramBuilder } from './program-builder';
import { northwindPrograms } from './data/northwind-programs';
import { kitstakPrograms } from './data/kitstak-programs';
import type { OrgProgramsSeed } from './program-types';
import { seedCheck } from './seed-check';
import { seedContext } from './context';
import { todayIn } from '@kitstak/programs-engine/schedule';

const ALL: readonly OrgSeed[] = [kitstakSeed, northwindSeed];

function selectedOrgs(argv: readonly string[]): readonly OrgSeed[] {
  const arg = argv.find((a) => a.startsWith('--org='));
  if (!arg) return ALL;
  const slugs = arg.slice('--org='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const picked = ALL.filter((spec) => slugs.includes(spec.slug));
  if (picked.length !== slugs.length) {
    throw new Error(`Unknown org in ${arg}. Seeds exist for: ${ALL.map((s) => s.slug).join(', ')}`);
  }
  return picked;
}

const COUNTED = [
  'spaces',
  'projects',
  'tasks',
  'comments',
  'activity',
  'notifications',
  'time_entries',
  'task_dependencies',
  'integration_links',
  'milestones',
  'goals',
  'goal_key_results',
  'saved_views',
  'automations',
  'automation_runs',
  'forms',
  'form_submissions',
  'templates',
  'attachments',
] as const;

async function report(spec: OrgSeed, stats: OrgSeedStats): Promise<void> {
  const org = await orgBySlug(spec.slug);
  if (!org) return;
  const parts = COUNTED.map((table) => sql`(select count(*) from ${sql.raw(`pm.${table}`)} where org_id = ${org.id})::int as ${sql.raw(table)}`);
  const result = await db.execute<Record<string, number>>(sql`select ${sql.join(parts, sql`, `)}`);
  const row = result.rows[0] ?? {};
  const linkTypes = await db.execute<{ target_type: string; n: number }>(
    sql`select target_type, count(*)::int as n from pm.integration_links where org_id = ${org.id} group by 1 order by 1`,
  );
  process.stdout.write(`\n${spec.slug}\n`);
  process.stdout.write(`  ${COUNTED.map((table) => `${table}=${row[table] ?? 0}`).join('  ')}\n`);
  process.stdout.write(`  links by type: ${linkTypes.rows.map((r) => `${r.target_type}=${r.n}`).join('  ') || 'none'}\n`);
  if (stats.warnings.length) process.stdout.write(`  ${stats.warnings.length} warning(s), see above\n`);
}

/** WMS net kitting capacity of APX-KIT-TEE3 at seed time (SPEC 7.2), 200 when WMS has no row yet. */
async function teeCapacity(): Promise<number> {
  try {
    const result = await db.execute<{ net: string | null }>(sql`select sum(s.net_kitting_capacity)::text as net from wms.kit_inventory_stats s
      join wms.products p on p.id::text = s.kit_product_id::text where p.sku = 'APX-KIT-TEE3'`);
    const net = Number(result.rows[0]?.net ?? 0);
    return net > 0 ? net : 200;
  } catch {
    return 200;
  }
}

async function programsFor(slug: string): Promise<OrgProgramsSeed | null> {
  if (slug === 'northwind-robotics') return northwindPrograms;
  if (slug === 'kitstak') return kitstakPrograms(await teeCapacity());
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const orgs = selectedOrgs(argv);
  const started = Date.now();
  const results: [OrgSeed, OrgSeedStats][] = [];
  const problems: string[] = [];
  const today = todayIn('America/Chicago', new Date());
  for (const spec of orgs) {
    if (!argv.includes('--check-only')) {
      results.push([spec, await new OrgBuilder(spec).run()]);
      const programs = await programsFor(spec.slug);
      if (programs) {
        const built = await new ProgramBuilder(programs).run();
        process.stdout.write(`  ${spec.slug}: ${built.programs.length} programs, ${built.idsMoved} rows given stable ids\n`);
      }
    }
    const programs = await programsFor(spec.slug);
    if (programs) {
      const email = programs.people[programs.me]!;
      problems.push(...(await seedCheck(await seedContext(spec.slug, email), { today, pulse: argv.includes('--with-pulse') })));
    }
  }
  for (const [spec, stats] of results) await report(spec, stats);
  process.stdout.write(`\nSeed finished in ${Math.round((Date.now() - started) / 1000)}s\n`);
  if (problems.length > 0) throw new Error(`Seed check failed: ${problems.length} value(s) differ from docs/programs/SPEC.md 7.4`);
}

main()
  .then(() => closeSeed())
  .catch(async (error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    await closeSeed().catch(() => undefined);
    process.exit(1);
  });
