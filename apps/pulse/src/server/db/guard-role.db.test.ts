/**
 * Can the app's login really use the plain role (CONTRACTS section 12, rule 13)? These tests make probe roles, run
 * the readiness check and migration 0012 as each kind of migration role, and drop the roles at the end:
 *
 *   - a superuser,
 *   - a role with CREATEROLE that is not a superuser (on PostgreSQL 16 the role it makes gives it
 *     ADMIN only: MEMBER is true but SET ROLE is refused, the round four false green),
 *   - a plain owner with no CREATEROLE (the grant is skipped with a NOTICE, an admin grants by hand),
 *   - the two login setup: a login that owns nothing and may only become the plain role.
 *
 * And the fallback: with the flag on and a login that cannot use the role, statements run as the
 * owner and a loud line is logged, instead of every request failing.
 *
 * Needs a superuser on DATABASE_URL (the local database). Skipped otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkGuardRole, createGuardedDb, dbGuardInForce } from '@/server/db';
import { withOrg } from '@/server/db/scope';
import { databaseReady, TEST_DATABASE_URL } from '@/test/db';

const MIGRATION_0012 = fs.readFileSync(path.resolve(__dirname, '../../../drizzle/0012_db_guard_set_grant.sql'), 'utf8');

async function isSuperuser(): Promise<boolean> {
  if (!(await databaseReady())) return false;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return Boolean((await client.query<{ s: boolean }>('select rolsuper as s from pg_roles where rolname = current_user')).rows[0]?.s);
  } finally {
    await client.end();
  }
}

const ready = await isSuperuser();
const tag = `g5t_${randomBytes(3).toString('hex')}`;
const password = `pw-${randomBytes(9).toString('hex')}`;
const urlFor = (role: string): string => {
  const url = new URL(TEST_DATABASE_URL);
  url.username = role;
  url.password = password;
  return url.toString();
};

describe.skipIf(!ready)('the plain role check and migration 0012, with probe roles', () => {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  const pools: pg.Pool[] = [];
  const roles: string[] = [];
  const poolAs = (role: string): pg.Pool => {
    const pool = new pg.Pool({ connectionString: urlFor(role), max: 2 });
    pools.push(pool);
    return pool;
  };
  /** A plain role like pulse_app: no login, cannot skip RLS, reads and writes pulse.jobs, reads core.member. */
  const grantLikePulseApp = async (role: string): Promise<void> => {
    await admin.query(`grant usage on schema pulse to ${role}; grant select, insert, update, delete on pulse.jobs to ${role}; grant usage on schema core to ${role}; grant select on core.member to ${role}`);
  };
  /** Migration 0012 as written, for a probe role in place of pulse_app, run as `migrator`. Returns its NOTICE lines. */
  const run0012As = async (migrator: string, role: string): Promise<string[]> => {
    const client = new pg.Client({ connectionString: urlFor(migrator) });
    const notices: string[] = [];
    client.on('notice', (notice) => notices.push(notice.message ?? ''));
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(MIGRATION_0012.replaceAll('pulse_app', role));
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
    return notices;
  };
  const membership = async (role: string, member: string) =>
    (
      await admin.query<{ admin_option: boolean; inherit_option: boolean; set_option: boolean }>(
        `select m.admin_option, m.inherit_option, m.set_option from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
          where r.rolname = $1 and u.rolname = $2 order by m.set_option`,
        [role, member],
      )
    ).rows;

  beforeAll(async () => {
    const pg16 = Number((await admin.query<{ v: string }>("select current_setting('server_version_num') as v")).rows[0]?.v) >= 160000;
    expect(pg16, 'these probes are written for PostgreSQL 16').toBe(true);
  });

  afterAll(async () => {
    for (const pool of pools) await pool.end().catch(() => undefined);
    // Probe roles own nothing but their grants. Reverse order: the made roles before their makers.
    for (const role of [...roles].reverse()) {
      await admin.query(`drop owned by ${role}`).catch(() => undefined);
      await admin.query(`drop role if exists ${role}`).catch(() => undefined);
    }
    const left = await admin.query('select rolname from pg_roles where rolname like $1', [`${tag}%`]);
    await admin.end();
    expect(left.rows).toEqual([]);
  });

  it('a superuser login is ready, and could step out of the guard with RESET ROLE', async () => {
    const app = `${tag}_su_app`;
    roles.push(app);
    await admin.query(`create role ${app} nologin noinherit nobypassrls`);
    await grantLikePulseApp(app);
    const check = await checkGuardRole(admin, app);
    expect(check).toMatchObject({ ready: true, definite: true, reason: null, loginCanStepOut: true });
  });

  it('a CREATEROLE login that made the role: MEMBER is true, SET ROLE is refused, the check says not ready, and 0012 fixes it', async () => {
    const migrator = `${tag}_mig`;
    const app = `${tag}_mig_app`;
    roles.push(migrator, app);
    await admin.query(`create role ${migrator} login password '${password}' nosuperuser createrole`);
    const asMigrator = poolAs(migrator);
    await asMigrator.query(`create role ${app} nologin noinherit`);
    await grantLikePulseApp(app);

    // The round four repro: an ADMIN only membership, so MEMBER is true and SET is false.
    expect(await membership(app, migrator)).toEqual([{ admin_option: true, inherit_option: false, set_option: false }]);
    const rights = (await asMigrator.query<{ member: boolean; usage: boolean; set: boolean }>(`select pg_has_role(current_user, $1, 'MEMBER') as member, pg_has_role(current_user, $1, 'USAGE') as usage, pg_has_role(current_user, $1, 'SET') as set`, [app])).rows[0];
    expect(rights).toEqual({ member: true, usage: false, set: false });
    const client = await asMigrator.connect();
    try {
      await client.query('begin');
      await expect(client.query(`set local role ${app}`)).rejects.toMatchObject({ code: '42501', message: expect.stringContaining('permission denied to set role') });
    } finally {
      await client.query('rollback');
      client.release();
    }

    // The check tries the real thing, so it is not fooled.
    const before = await checkGuardRole(asMigrator, app);
    expect(before.ready).toBe(false);
    expect(before.definite).toBe(true);
    expect(before.reason).toContain(`may not switch to ${app}`);
    expect(before.reason).toContain(`GRANT ${app} TO ${migrator} WITH SET TRUE`);

    // 0012 grants the SET right with the role's own ADMIN membership.
    const notices = await run0012As(migrator, app);
    expect(notices.join('\n')).toContain(`granted ${app} to ${migrator}`);
    expect(await membership(app, migrator)).toEqual([
      { admin_option: true, inherit_option: false, set_option: false },
      { admin_option: false, inherit_option: false, set_option: true },
    ]);
    expect(await checkGuardRole(asMigrator, app)).toMatchObject({ ready: true, reason: null, login: migrator });

    // Safe to run again: nothing more is granted.
    expect(await run0012As(migrator, app)).toEqual([]);
    expect(await membership(app, migrator)).toHaveLength(2);
  });

  it('a plain owner with no CREATEROLE: 0012 skips the grant with a NOTICE, and an admin grant makes it ready', async () => {
    const owner = `${tag}_own`;
    const app = `${tag}_own_app`;
    roles.push(owner, app);
    await admin.query(`create role ${owner} login password '${password}' nosuperuser nocreaterole`);
    await admin.query(`create role ${app} nologin noinherit`);
    await grantLikePulseApp(app);
    const asOwner = poolAs(owner);

    expect((await checkGuardRole(asOwner, app)).reason).toContain(`may not switch to ${app}`);
    const notices = await run0012As(owner, app);
    expect(notices.join('\n')).toContain(`skipped GRANT ${app} TO ${owner} (not allowed)`);
    expect((await checkGuardRole(asOwner, app)).ready).toBe(false);

    await admin.query(`grant ${app} to ${owner} with set true`);
    expect(await checkGuardRole(asOwner, app)).toMatchObject({ ready: true, loginCanStepOut: false });
  });

  it('says why when the role is missing, can skip row level security, or has no grants', async () => {
    expect((await checkGuardRole(admin, `${tag}_none`)).reason).toContain('is not in the database');
    const bypass = `${tag}_bypass`;
    const bare = `${tag}_bare`;
    roles.push(bypass, bare);
    await admin.query(`create role ${bypass} nologin bypassrls`);
    await grantLikePulseApp(bypass);
    expect((await checkGuardRole(admin, bypass)).reason).toContain('can skip row level security');
    await admin.query(`create role ${bare} nologin noinherit`);
    expect((await checkGuardRole(admin, bare)).reason).toContain('has no read grant');
    expect(await checkGuardRole(admin, 'Robert"; drop')).toMatchObject({ ready: false, reason: 'The role name is not valid.' });
  });

  it('the two login setup: a login that owns nothing and may only become the plain role cannot step out with RESET ROLE', async () => {
    const login = `${tag}_login`;
    const app = `${tag}_two_app`;
    roles.push(login, app);
    await admin.query(`create role ${app} nologin noinherit nobypassrls`);
    await grantLikePulseApp(app);
    // The SQL of CONTRACTS section 12, rule 13 (two logins), with probe names.
    await admin.query(`create role ${login} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await admin.query(`grant ${app} to ${login} with inherit false, set true`);
    const asLogin = poolAs(login);
    expect(await checkGuardRole(asLogin, app)).toMatchObject({ ready: true, loginCanStepOut: false, login });
    const client = await asLogin.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${app}`);
      await client.query('select 1 from pulse.jobs limit 0');
      await client.query('reset role');
      expect((await client.query<{ u: string }>('select current_user::text as u')).rows[0]?.u).toBe(login);
      // Stepped out, the login sees nothing at all: no grants and no ownership of its own.
      await expect(client.query('select count(*) from pulse.jobs')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('with the flag on and a login that cannot use the role, statements run as the owner with a loud log, then use the role once it is granted', async () => {
    const login = `${tag}_nolink`;
    roles.push(login);
    await admin.query(`create role ${login} login password '${password}' nosuperuser nocreaterole`);
    // A login that is not a member of pulse_app: SET LOCAL ROLE pulse_app is refused.
    const appPool = poolAs(login);
    const ownerPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    pools.push(ownerPool);
    const guarded = createGuardedDb(appPool, () => ownerPool);
    vi.stubEnv('PULSE_DB_GUARD', '1');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const orgId = '00000000-0000-4000-8000-000000000001';
      const who = () => withOrg(orgId, () => guarded.execute<{ u: string }>(sql`select current_user::text as u`)).then((result) => result.rows[0]?.u);
      // Not broken: the statement runs, as the owner login.
      expect(await who()).toBe((await admin.query<{ u: string }>('select current_user::text as u')).rows[0]?.u);
      expect(await withOrg(orgId, () => guarded.transaction(async (tx) => (await tx.execute<{ u: string }>(sql`select current_user::text as u`)).rows[0]?.u))).not.toBe('pulse_app');
      expect(logged.mock.calls.map((call) => String(call[0])).join('\n')).toContain('THE DATABASE GUARD IS NOT IN FORCE');
      expect(logged.mock.calls.map((call) => String(call[0])).join('\n')).toContain(`The login ${login} may not switch to pulse_app`);
      expect(dbGuardInForce(appPool)).toMatchObject({ requested: true, active: false });
      // Checked once, then trusted for 30 seconds: no new check, no new log line, on each statement.
      const lines = logged.mock.calls.length;
      await who();
      expect(logged.mock.calls.length).toBe(lines);

      // An admin grants the role. After the next check the guard is in force without a restart.
      await admin.query(`grant pulse_app to ${login} with set true`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect(await who()).toBe('pulse_app');
      expect(dbGuardInForce(appPool)).toMatchObject({ requested: true, active: true });
    } finally {
      vi.useRealTimers();
      logged.mockRestore();
      vi.unstubAllEnvs();
      await admin.query(`revoke pulse_app from ${login}`).catch(() => undefined);
    }
  });
});
