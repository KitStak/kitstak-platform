/**
 * Helpers for the @kitstak/db database tests (not exported from the package). Each suite makes a
 * throwaway organization and removes it at the end, so suites can run next to the dev servers and
 * other people's tests on the shared local database (SPEC B.3); the org cascade removes every row.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Executor } from './executor';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

/**
 * What to do when the database is not ready for a suite: in CI (`CI=true`) or with
 * `REQUIRE_DB=1` the suite fails, so acceptance tests are never skipped silently; anywhere else
 * a loud warning says why the suites are skipped.
 */
function reportNotReady(reason: string): void {
  const message = `DATABASE TESTS SKIPPED: ${reason}. Set DATABASE_URL to a migrated database to run them.`;
  if (process.env.CI === 'true' || process.env.REQUIRE_DB === '1') throw new Error(message);
  process.stderr.write(`\n\u001b[33m!!! ${message} !!!\u001b[0m\n\n`);
}

/**
 * True when the database answers and the given tables exist. Throws in CI (or with REQUIRE_DB=1)
 * instead of returning false, and warns loudly otherwise, so a skipped suite is never silent.
 */
export async function databaseReady(tables: readonly string[] = ['core.organization']): Promise<boolean> {
  if (!TEST_DATABASE_URL) {
    reportNotReady('DATABASE_URL is not set');
    return false;
  }
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  let missing: string | null = null;
  try {
    await client.connect();
    for (const table of tables) {
      const result = await client.query('select to_regclass($1) is not null as ok', [table]);
      if (result.rows[0]?.ok !== true) {
        missing = `table ${table} is missing (run db:migrate)`;
        break;
      }
    }
  } catch (error) {
    missing = `the database does not answer (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    await client.end().catch(() => undefined);
  }
  if (missing) {
    reportNotReady(missing);
    return false;
  }
  return true;
}

export interface TestOrg {
  readonly orgId: string;
  readonly userId: string;
  readonly pool: pg.Pool;
  readonly db: Executor;
  readonly query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  /** Runs the callback in one transaction on one client (COMMIT on success, ROLLBACK on error). */
  readonly tx: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  readonly addUser: (orgRole?: string) => Promise<string>;
  readonly destroy: () => Promise<void>;
}

export async function createTestOrg(label = 'db-test'): Promise<TestOrg> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const orgId = randomUUID();
  const userIds: string[] = [];
  const slug = `${label}-${orgId.slice(0, 8)}`;
  await pool.query('insert into core.organization (id, name, slug, created_at) values ($1, $2, $3, now())', [orgId, `Test ${slug}`, slug]);
  const addUser = async (orgRole = 'owner'): Promise<string> => {
    const userId = randomUUID();
    userIds.push(userId);
    await pool.query('insert into core."user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())', [userId, `Test ${orgRole}`, `${userId}@db-test.example`]);
    await pool.query('insert into core.member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, $4, now())', [randomUUID(), orgId, userId, orgRole]);
    return userId;
  };
  const userId = await addUser('owner');
  return {
    orgId,
    userId,
    pool,
    db: drizzle(pool) as unknown as Executor,
    query: async (text, values) => (await pool.query(text, values)).rows,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    addUser,
    destroy: async () => {
      await pool.query('delete from core.organization where id = $1', [orgId]);
      if (userIds.length > 0) await pool.query('delete from core."user" where id = any($1::uuid[])', [userIds]);
      await pool.end();
    },
  };
}

/** The Postgres error code of a failed statement (pg puts it on the error itself). */
export function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

export interface GloveFixture {
  readonly programId: string;
  readonly projectId: string;
  readonly statusTodo: string;
  readonly statusDone: string;
  readonly statusCancelled: string;
  readonly variants: Readonly<Record<string, string>>;
  readonly v1: string;
  readonly v2: string;
  readonly setupId: string;
}

/**
 * The SPEC 3.15 GLOVE setup: Size S, M, L, XL x Color BRN, YLW (8 variants); card v1 from
 * 2026-09-15 (per kit $1.85, "Size is XL: set $2.10", fee $1,500 and minimum $30,000, both with
 * prorate on), card v2 from 2026-11-01 (per kit $1.95, "Size is XL: add $0.25"); setup fee
 * $2,500 on 2026-09-15; Mon to Fri; workspace holiday 2026-11-26; starts 2026-09-15; Chicago.
 *
 * With `output: true` it also logs the E14 to E16 volumes: 100 of each variant on every work day
 * from Sep 15 through Nov 24, except 50 of each on Oct 12 to 16, priced like the domain would.
 */
export async function seedGloveFixture(org: TestOrg, opts: { output?: boolean; key?: string } = {}): Promise<GloveFixture> {
  const key = opts.key ?? 'GLOVE';
  return org.tx(async (client) => {
    const one = async <T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T> => (await client.query<T>(text, values)).rows[0] as T;
    const { id: programId } = await one<{ id: string }>(
      `insert into pm.projects (org_id, key, name, kind, position, start_date, owner_id, created_by)
       values ($1, $2, 'Glove program', 'program', 'a0', '2026-09-15', $3, $3) returning id`,
      [org.orgId, key, org.userId],
    );
    const { id: projectId } = await one<{ id: string }>(
      `insert into pm.projects (org_id, key, name, kind, position) values ($1, $2, 'Plant move', 'project', 'a1') returning id`,
      [org.orgId, `${key.slice(0, 4)}P`],
    );
    const status = async (projectRow: string, name: string, category: string, position: string, isDefault = false) =>
      (await one<{ id: string }>(
        `insert into pm.statuses (org_id, project_id, name, category, position, is_default) values ($1, $2, $3, $4, $5, $6) returning id`,
        [org.orgId, projectRow, name, category, position, isDefault],
      )).id;
    const statusTodo = await status(programId, 'Planned', 'todo', 'a0', true);
    const statusDone = await status(programId, 'Done', 'done', 'a4');
    const statusCancelled = await status(programId, 'Cancelled', 'cancelled', 'a5');
    await status(projectId, 'To do', 'todo', 'a0', true);
    await status(projectId, 'Done', 'done', 'a3');
    await client.query(
      `insert into pm.org_calendar (org_id, timezone, holidays) values ($1, 'America/Chicago', '[{"date":"2026-11-26","name":"Thanksgiving"}]'::jsonb)
       on conflict (org_id) do nothing`,
      [org.orgId],
    );
    await client.query(`insert into pm.program_settings (program_id, org_id, timezone) values ($1, $2, 'America/Chicago')`, [programId, org.orgId]);
    const { id: sizeId } = await one<{ id: string }>(
      `insert into pm.program_attributes (org_id, program_id, name, values, position) values ($1, $2, 'Size',
         '[{"id":"s","label":"Small","code":"S","color":null},{"id":"m","label":"Medium","code":"M","color":null},{"id":"l","label":"Large","code":"L","color":null},{"id":"xl","label":"XL","code":"XL","color":null}]'::jsonb, 'a0') returning id`,
      [org.orgId, programId],
    );
    const { id: colorId } = await one<{ id: string }>(
      `insert into pm.program_attributes (org_id, program_id, name, values, position) values ($1, $2, 'Color',
         '[{"id":"brn","label":"Brown","code":"BRN","color":"brown"},{"id":"ylw","label":"Yellow","code":"YLW","color":"yellow"}]'::jsonb, 'a1') returning id`,
      [org.orgId, programId],
    );
    const sizes = [['s', 'S', 'Small'], ['m', 'M', 'Medium'], ['l', 'L', 'Large'], ['xl', 'XL', 'XL']] as const;
    const colors = [['brn', 'BRN', 'Brown'], ['ylw', 'YLW', 'Yellow']] as const;
    const variants: Record<string, string> = {};
    let position = 0;
    for (const [sizeValue, sizeCode, sizeLabel] of sizes) {
      for (const [colorValue, colorCode, colorLabel] of colors) {
        const variantKey = `${sizeCode}-${colorCode}`;
        const { id } = await one<{ id: string }>(
          `insert into pm.program_variants (org_id, program_id, key, name, attributes, sku, position)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning id`,
          [org.orgId, programId, variantKey, `${sizeLabel} ${colorLabel}`, JSON.stringify({ [sizeId]: sizeValue, [colorId]: colorValue }), `${key}-${variantKey}`, `a${position}`],
        );
        variants[variantKey] = id;
        position += 1;
      }
    }
    const version = async (number: number, from: string) =>
      (await one<{ id: string }>(
        `insert into pm.price_card_versions (org_id, program_id, number, status, effective_from, published_at, published_by, source)
         values ($1, $2, $3, 'published', $4, now(), $5, 'seed') returning id`,
        [org.orgId, programId, number, from, org.userId],
      )).id;
    const v1 = await version(1, '2026-09-15');
    const v2 = await version(2, '2026-11-01');
    const rule = async (versionId: string, op: 'add' | 'set', amount: string) =>
      (await one<{ id: string }>(
        `insert into pm.price_card_rules (org_id, version_id, attribute_id, value_id, op, amount) values ($1, $2, $3, 'xl', $4, $5) returning id`,
        [org.orgId, versionId, sizeId, op, amount],
      )).id;
    const rule1 = await rule(v1, 'set', '2.1000');
    const rule2 = await rule(v2, 'add', '0.2500');
    const line = (versionId: string, kind: string, fields: { variantId?: string; ruleId?: string; unitPrice?: string; amountCents?: string }) =>
      client.query(
        `insert into pm.price_card_lines (org_id, version_id, kind, variant_id, rule_id, unit_price, amount_cents) values ($1, $2, $3, $4, $5, $6, $7)`,
        [org.orgId, versionId, kind, fields.variantId ?? null, fields.ruleId ?? null, fields.unitPrice ?? null, fields.amountCents ?? null],
      );
    for (const [versionId, base, xl, ruleId] of [[v1, '1.8500', '2.1000', rule1], [v2, '1.9500', '2.2000', rule2]] as const) {
      await line(versionId, 'per_unit', { unitPrice: base });
      await line(versionId, 'per_unit', { variantId: variants['XL-BRN'], ruleId, unitPrice: xl });
      await line(versionId, 'per_unit', { variantId: variants['XL-YLW'], ruleId, unitPrice: xl });
      await line(versionId, 'flat_monthly', { amountCents: '150000' });
      await line(versionId, 'monthly_minimum', { amountCents: '3000000' });
    }
    const { id: setupId } = await one<{ id: string }>(
      `insert into pm.program_one_time_charges (org_id, program_id, kind, charge_on, amount_cents, label, created_by)
       values ($1, $2, 'setup', '2026-09-15', 250000, 'Setup fee', $3) returning id`,
      [org.orgId, programId, org.userId],
    );
    if (opts.output) {
      await client.query(
        `create temp table glove_builds on commit drop as
         select gen_random_uuid() as task_id, d::date as day, v.id as variant_id, v.key as variant_key,
                row_number() over (order by d, v.position) as n,
                case when d::date between '2026-10-12' and '2026-10-16' then 50 else 100 end as qty
           from generate_series('2026-09-15'::date, '2026-11-24'::date, interval '1 day') d
           cross join pm.program_variants v
          where v.program_id = $1 and extract(isodow from d) < 6`,
        [programId],
      );
      await client.query(
        `insert into pm.tasks (id, org_id, project_id, number, title, status_id, position, kind, start_date, due_date)
         select task_id, $1, $2, n, variant_key || ' ' || day, $3, lpad(n::text, 6, '0'), 'build', day, day from glove_builds`,
        [org.orgId, programId, statusTodo],
      );
      await client.query(
        `insert into pm.builds (task_id, org_id, container_id, program_id, variant_id, build_date, planned_qty, built_qty, planned_from)
         select task_id, $1, $2, $2, variant_id, day, qty, qty, 'schedule' from glove_builds`,
        [org.orgId, programId],
      );
      await client.query(
        `insert into pm.build_output (org_id, container_id, program_id, build_id, variant_id, work_date, qty, unit_price, price_source, card_version_id, revenue_cents, posting)
         select $1, $2, $2, g.task_id, g.variant_id, g.day, g.qty, p.price,
                case when g.variant_key like 'XL-%' then 'variant' else 'card' end,
                case when g.day >= '2026-11-01' then $3::uuid else $4::uuid end,
                round(g.qty * p.price * 100)::bigint, 'program'
           from glove_builds g
           cross join lateral (select case
             when g.day >= '2026-11-01' and g.variant_key like 'XL-%' then 2.2000
             when g.day >= '2026-11-01' then 1.9500
             when g.variant_key like 'XL-%' then 2.1000
             else 1.8500 end::numeric(14,4) as price) p`,
        [org.orgId, programId, v2, v1],
      );
      await client.query(`update pm.projects set task_seq = (select count(*) from glove_builds) where id = $1`, [programId]);
    }
    return { programId, projectId, statusTodo, statusDone, statusCancelled, variants, v1, v2, setupId };
  });
}
