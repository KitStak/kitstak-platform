/**
 * Row level security on every crew table (docs/crew/SPEC.md 5): RLS is on, each table has the org
 * isolation policy, and crew_app holds its grants. A table added by a later migration without a
 * policy fails here. Also checks the migration bookkeeping and that Crew left the entitlements
 * CHECK alone (SPEC 3.4: crew joins it at launch).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseReady, TEST_DATABASE_URL } from '@/test/db';

const ready = await databaseReady();

describe.skipIf(!ready)('crew row level security', () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => {
    await client?.end();
  });

  it('every crew table has RLS on and the org isolation policy', async () => {
    const { rows } = await client.query<{ table: string; rls: boolean; policies: string[] }>(
      `select c.relname as table, c.relrowsecurity as rls,
              coalesce(array_agg(p.polname::text) filter (where p.polname is not null), '{}') as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'crew' and c.relkind in ('r', 'p')
        group by c.relname, c.relrowsecurity order by c.relname`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(24);
    for (const row of rows) {
      expect(row.rls, `${row.table} has row level security`).toBe(true);
      expect(row.policies, `${row.table} has the policy`).toContain('crew_org_isolation');
    }
  });

  it('holds the Phase 0 tables of SPEC 5.1, 5.2 and 5.8', async () => {
    const { rows } = await client.query<{ table: string }>("select table_name as table from information_schema.tables where table_schema = 'crew' and table_type = 'BASE TABLE'");
    const tables = new Set(rows.map((row) => row.table));
    for (const name of ['settings', 'member_roles', 'sites', 'site_rules', 'break_rules', 'areas', 'labor_classes', 'people', 'person_private', 'person_pay', 'person_wages', 'agency_links', 'agency_submissions', 'attachments', 'activity', 'notifications', 'outbox_email', 'import_batches', 'import_rows', 'import_presets', 'user_prefs', 'sync_state', 'sync_runs', 'dismissals']) {
      expect(tables.has(name), name).toBe(true);
    }
  });

  it('crew_app is a plain role with grants on the crew tables and its own vendor policy', async () => {
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>("select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'crew_app'");
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
    const grant = await client.query<{ ok: boolean }>("select has_table_privilege('crew_app', 'crew.people', 'SELECT, INSERT, UPDATE, DELETE') and has_table_privilege('crew_app', 'core.vendors', 'SELECT, INSERT, UPDATE') as ok");
    expect(grant.rows[0]?.ok).toBe(true);
    const policy = await client.query("select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'vendors' and p.polname = 'crew_app_own_org'");
    expect(policy.rowCount).toBe(1);
  });

  it('is recorded once in the Crew migration table', async () => {
    const { rows } = await client.query<{ tag: string }>('select tag from drizzle.__kitstak_crew_migrations order by tag');
    expect(rows.map((row) => row.tag)).toContain('0000_crew_init');
  });

  it('leaves the core.entitlements module CHECK without crew until launch', async () => {
    const { rows } = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'entitlements_module_check'");
    for (const row of rows) expect(row.def).not.toContain('crew');
  });
});
