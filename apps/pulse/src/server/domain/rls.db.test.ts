/**
 * Row level security in the `pulse` schema (migration 0007). The app connects as the table owner
 * and an owner skips RLS, so these checks use a plain role made for the test: it owns nothing,
 * it is not a superuser and it cannot skip RLS. The role gets its grants here, inside the test,
 * because the migration grants nothing to anyone. Skipped when no database answers.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { createClient, createJob, saveProductionEntry } from './test-exports';

const ready = await databaseReady();

/** Tables the test counts rows in as the plain role. */
const SAMPLE_TABLES = ['jobs', 'production_entries', 'clients', 'activity', 'job_stats', 'fact_days', 'settings'] as const;

describe.skipIf(!ready)('row level security keeps workspaces apart for a plain role', () => {
  const role = `pulse_rls_probe_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let ownerA: DomainContext;
  let ownerB: DomainContext;
  let client: pg.Client;

  /**
   * Runs statements as the plain role inside one transaction, with or without the workspace
   * setting, then rolls everything back. `set local` ends with the transaction.
   */
  async function asPlainRole<T>(orgId: string | null, work: (run: (text: string, values?: unknown[]) => Promise<pg.QueryResultRow[]>) => Promise<T>): Promise<T> {
    await client.query('begin');
    try {
      if (orgId !== null) await client.query("select set_config('pulse.org_id', $1, true)", [orgId]);
      await client.query(`set local role "${role}"`);
      return await work(async (text, values) => (await client.query(text, values)).rows);
    } finally {
      await client.query('rollback');
    }
  }
  const countRows = async (orgId: string | null, table: string): Promise<{ total: number; orgs: string[] }> =>
    asPlainRole(orgId, async (run) => {
      const rows = await run(`select count(*)::int as n, coalesce(array_agg(distinct org_id::text), '{}') as orgs from pulse.${table}`);
      return { total: Number(rows[0]?.n ?? 0), orgs: (rows[0]?.orgs as string[]) ?? [] };
    });

  beforeAll(async () => {
    orgA = await createTestOrg('pulse-rls-a');
    orgB = await createTestOrg('pulse-rls-b');
    ownerA = await orgA.member('owner', 'Rls Owner A');
    ownerB = await orgB.member('owner', 'Rls Owner B');
    for (const owner of [ownerA, ownerB]) {
      const made = await createClient(owner, { name: `Rls Client ${owner.orgSlug}` });
      const job = await createJob(owner, { name: 'Rls job', clientId: made.id, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
      await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-11-02', unitsGood: '10', hours: '1' });
    }
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query(`create role "${role}" nologin nosuperuser nobypassrls noinherit`);
    await client.query(`grant usage on schema pulse to "${role}"`);
    // Every table and the facts view: with grants on all of them, only the policies stand in the way.
    await client.query(`grant select, insert, update, delete on all tables in schema pulse to "${role}"`);
  }, 120_000);

  afterAll(async () => {
    if (client) {
      await client.query('rollback').catch(() => undefined);
      await client.query(`drop owned by "${role}"`).catch(() => undefined);
      await client.query(`drop role if exists "${role}"`).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    await orgA?.destroy();
    await orgB?.destroy();
  });

  it('gives every pulse table with RLS on at least one policy, and forces RLS on none', async () => {
    const rows = await orgA.query<{ table: string; policies: number; forced: boolean; has_org: boolean; rls: boolean }>(
      `select c.relname as "table", c.relrowsecurity as rls, c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
              exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0 and not a.attisdropped) as has_org
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pulse' and c.relkind in ('r', 'p')
        order by 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(46);
    // A new table from a later migration lands here until that migration adds its policy.
    expect(rows.filter((row) => !row.rls).map((row) => row.table), 'tables with RLS off').toEqual([]);
    expect(rows.filter((row) => row.policies === 0).map((row) => row.table), 'tables with RLS on and no policy').toEqual([]);
    // The app role owns the tables and must keep working: RLS is never forced on the owner.
    expect(rows.filter((row) => row.forced).map((row) => row.table), 'tables with forced RLS').toEqual([]);
  });

  it('ties every policy to the workspace setting and grants nothing', async () => {
    const policies = await orgA.query<{ tablename: string; policyname: string; cmd: string; qual: string; with_check: string }>(
      "select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'pulse' order by 1",
    );
    for (const policy of policies) {
      expect(policy.cmd, policy.tablename).toBe('ALL');
      if (policy.policyname === 'pulse_org_isolation') {
        expect(policy.qual, policy.tablename).toMatch(/org_id = .*current_setting\('pulse\.org_id'/);
        expect(policy.with_check, policy.tablename).toMatch(/org_id = .*current_setting\('pulse\.org_id'/);
      } else if (policy.policyname === 'pulse_deny_all') {
        expect(policy.qual, policy.tablename).toBe('false');
      }
    }
    // Nobody but the owner (and the role this test made) holds a grant on a pulse table.
    const grants = await orgA.query<{ grantee: string }>(
      `select distinct g.grantee from information_schema.role_table_grants g
        where g.table_schema = 'pulse' and g.grantee <> $1
          and g.grantee <> all (select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pulse')
          and g.grantee not like 'pulse_rls_probe_%'`,
      [role],
    );
    expect(grants.map((grant) => grant.grantee).filter((grantee) => ['PUBLIC', 'anon', 'authenticated'].includes(grantee))).toEqual([]);
  });

  it('shows nothing to a plain role with no setting', async () => {
    // The owner connection sees both workspaces, so the rows are really there.
    const visible = await orgA.query<{ n: number }>('select count(*)::int as n from pulse.jobs where org_id = any($1::uuid[])', [[orgA.orgId, orgB.orgId]]);
    expect(visible[0]?.n).toBe(2);
    for (const table of [...SAMPLE_TABLES, 'v_facts']) {
      expect((await countRows(null, table)).total, table).toBe(0);
    }
    // An empty setting is the same as none.
    expect((await countRows('', 'jobs')).total).toBe(0);
    expect((await countRows('', 'production_entries')).total).toBe(0);
  });

  it('shows only the workspace named in the setting', async () => {
    for (const table of ['jobs', 'production_entries', 'clients', 'v_facts']) {
      const a = await countRows(orgA.orgId, table);
      expect(a.total, `${table} for A`).toBeGreaterThan(0);
      expect(a.orgs, `${table} for A`).toEqual([orgA.orgId]);
      const b = await countRows(orgB.orgId, table);
      expect(b.total, `${table} for B`).toBeGreaterThan(0);
      expect(b.orgs, `${table} for B`).toEqual([orgB.orgId]);
    }
    for (const table of SAMPLE_TABLES) {
      expect((await countRows(orgA.orgId, table)).orgs.filter((org) => org !== orgA.orgId), table).toEqual([]);
    }
    // A workspace id that does not exist shows nothing.
    expect((await countRows(randomUUID(), 'jobs')).total).toBe(0);
  });

  it('refuses a write for another workspace, and a write with no setting', async () => {
    const insert = 'insert into pulse.clients (org_id, code, name) values ($1, $2, $3) returning id';
    // The right workspace is allowed.
    const ok = await asPlainRole(orgA.orgId, (run) => run(insert, [orgA.orgId, 'PROBE-OK', 'Rls allowed']));
    expect(ok).toHaveLength(1);
    // Workspace B with the setting for A is refused.
    await expect(asPlainRole(orgA.orgId, (run) => run(insert, [orgB.orgId, 'PROBE-NO', 'Rls refused']))).rejects.toThrow(/row-level security/);
    // No setting: refused for any workspace.
    await expect(asPlainRole(null, (run) => run(insert, [orgA.orgId, 'PROBE-NO', 'Rls refused']))).rejects.toThrow(/row-level security/);
    // Rows of B cannot be changed, moved or removed with the setting for A.
    const changed = await asPlainRole(orgA.orgId, (run) => run("update pulse.jobs set name = 'taken' where org_id = $1 returning id", [orgB.orgId]));
    expect(changed).toHaveLength(0);
    const removed = await asPlainRole(orgA.orgId, (run) => run('delete from pulse.clients where org_id = $1 returning id', [orgB.orgId]));
    expect(removed).toHaveLength(0);
    await expect(asPlainRole(orgA.orgId, (run) => run('update pulse.clients set org_id = $1 where org_id = $2', [orgB.orgId, orgA.orgId]))).rejects.toThrow(/row-level security/);
    // A setting that is not a workspace id is an error, not a way in.
    await expect(asPlainRole('not-a-uuid', (run) => run('select count(*) from pulse.jobs'))).rejects.toThrow(/uuid/);
    // Nothing above was kept: every probe ran in a transaction that was rolled back.
    const left = await orgA.query<{ n: number }>("select count(*)::int as n from pulse.clients where code like 'PROBE-%' and org_id = any($1::uuid[])", [[orgA.orgId, orgB.orgId]]);
    expect(left[0]?.n).toBe(0);
  });

  it('leaves the owner connection as it was: the app still sees its rows', async () => {
    const rows = await orgA.query<{ n: number }>('select count(*)::int as n from pulse.production_entries where org_id = $1', [orgA.orgId]);
    expect(rows[0]?.n).toBe(1);
  });
});
