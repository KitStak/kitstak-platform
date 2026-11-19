/**
 * The database guard at work (CONTRACTS section 12, rule 13): with PULSE_DB_GUARD on, the app runs every
 * statement as the plain role `pulse_app` with the workspace setting, so the policies of
 * migration 0007 apply to the app itself. These tests hand org B's ids straight to org A's
 * context through raw SQL and check that the database, not the WHERE clause, keeps them apart.
 * Skipped when no database answers or the role of migration 0009 is not there.
 */
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { asSystem, currentDbScope, DB_GUARD_ROLE, DbGuardError, dbGuardRefusals, scoped, withOrg } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';
import { jobs } from '@/server/db/schema';
import { inTx, rows, type DomainContext } from '@/server/domain/_shared';
import { createClient, createJob, getJob, listJobs, listOrgPeople, saveProductionEntry, updateJob } from '@/server/domain/test-exports';
import { isDomainError } from '@/server/errors';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

const who = (executor: Parameters<typeof rows>[0] = db) =>
  rows<{ role: string; org: string | null }>(executor, sql`select current_user::text as role, nullif(current_setting('pulse.org_id', true), '') as org`).then((found) => found[0]!);

describe.skipIf(!ready)('the database guard ties the running app to one workspace', () => {
  let orgA: TestOrg;
  let orgB: TestOrg;
  let ownerA: DomainContext;
  let ownerB: DomainContext;
  let jobA: string;
  let jobB: string;
  let clientB: string;
  let loginRole: string;

  beforeAll(async () => {
    vi.stubEnv('PULSE_DB_GUARD', '1');
    orgA = await createTestOrg('pulse-guard-a');
    orgB = await createTestOrg('pulse-guard-b');
    ownerA = await orgA.member('owner', 'Guard Owner A');
    ownerB = await orgB.member('owner', 'Guard Owner B');
    const made: string[] = [];
    for (const owner of [ownerA, ownerB]) {
      const client = await createClient(owner, { name: `Guard Client ${owner.orgSlug}` });
      const job = await createJob(owner, { name: 'Guard job', clientId: client.id, status: 'active', plannedUnits: '100', unitPrice: '2.0000' });
      await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-11-02', unitsGood: '10', hours: '1' });
      made.push(job.id);
      if (owner === ownerB) clientB = client.id;
    }
    [jobA, jobB] = made as [string, string];
    loginRole = (await orgA.query<{ role: string }>('select current_user::text as role'))[0]!.role;
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv('PULSE_DB_GUARD', '1');
    dbGuardRefusals(true);
  });
  afterEach(() => {
    // Refusals a test made on purpose must not fail the whole run (see src/test/setup-env.ts).
    dbGuardRefusals(true);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await orgA?.destroy();
    await orgB?.destroy();
  });

  it('runs a single statement and a transaction as the plain role with the workspace set', async () => {
    expect(loginRole).not.toBe(DB_GUARD_ROLE);
    await withOrg(ownerA.orgId, async () => {
      expect(currentDbScope()).toEqual({ org: ownerA.orgId, system: false });
      expect(await who()).toEqual({ role: DB_GUARD_ROLE, org: ownerA.orgId });
      await inTx(async (tx) => {
        expect(await who(tx)).toEqual({ role: DB_GUARD_ROLE, org: ownerA.orgId });
        // A nested transaction (savepoint) stays in the same role and workspace.
        await inTx(async (inner) => expect(await who(inner)).toEqual({ role: DB_GUARD_ROLE, org: ownerA.orgId }), tx);
      });
      // The typed query builder goes through the same guard.
      const typed = await db.select({ id: jobs.id }).from(jobs);
      expect(typed.map((row) => row.id)).toEqual([jobA]);
    });
  });

  it('cannot read org B rows from org A, even with the ids in hand and no org filter', async () => {
    await withOrg(ownerA.orgId, async () => {
      // No WHERE org_id at all: the policy is the only thing in the way.
      expect(await rows(db, sql`select id from pulse.jobs where id = ${jobB}`)).toEqual([]);
      expect(await rows(db, sql`select id from pulse.clients where id = ${clientB}`)).toEqual([]);
      expect(await rows(db, sql`select 1 from pulse.production_entries where job_id = ${jobB}`)).toEqual([]);
      expect(await rows(db, sql`select 1 from pulse.v_facts where job_id = ${jobB}`)).toEqual([]);
      expect(await rows(db, sql`select 1 from pulse.activity where org_id = ${ownerB.orgId}`)).toEqual([]);
      expect((await rows<{ orgs: string[] }>(db, sql`select coalesce(array_agg(distinct org_id::text), '{}') as orgs from pulse.jobs`))[0]?.orgs).toEqual([ownerA.orgId]);
      // The same inside the transaction helper.
      await inTx(async (tx) => {
        expect(await rows(tx, sql`select id from pulse.jobs where id = ${jobB}`)).toEqual([]);
        expect(await rows(tx, sql`select id from pulse.jobs where org_id = ${ownerB.orgId}`)).toEqual([]);
        expect((await rows<{ n: number }>(tx, sql`select count(*)::int as n from pulse.jobs`))[0]?.n).toBe(1);
      });
    });
  });

  it('cannot change, remove or add org B rows from org A', async () => {
    await withOrg(ownerA.orgId, async () => {
      await inTx(async (tx) => {
        const changed = await tx.execute(sql`update pulse.jobs set name = 'taken over' where id = ${jobB}`);
        expect(changed.rowCount).toBe(0);
        const removed = await tx.execute(sql`delete from pulse.production_entries where job_id = ${jobB}`);
        expect(removed.rowCount).toBe(0);
      });
      // A new row for the other workspace, and a move of an own row into it, are refused outright.
      await expect(db.execute(sql`insert into pulse.sites (org_id, code, name, timezone) values (${ownerB.orgId}, 'SNEAK', 'Sneak', 'UTC')`)).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(db.execute(sql`update pulse.jobs set org_id = ${ownerB.orgId} where id = ${jobA}`)).rejects.toMatchObject({ cause: { code: '42501' } });
    });
    const [untouched] = await orgB.query<{ name: string; entries: number }>('select j.name, (select count(*)::int from pulse.production_entries p where p.job_id = j.id) as entries from pulse.jobs j where j.id = $1', [jobB]);
    expect(untouched).toEqual({ name: 'Guard job', entries: 1 });
    expect(await orgB.query("select 1 from pulse.sites where code = 'SNEAK'")).toEqual([]);
  });

  it('holds for a domain function that forgets its org filter', async () => {
    // A domain function with a bug: it trusts the id and filters by nothing else.
    const leakyRead = scoped(async function leakyRead(_ctx: DomainContext, id: string) {
      return rows<{ id: string }>(db, sql`select id from pulse.jobs where id = ${id}`);
    });
    const leakyWrite = scoped(async function leakyWrite(_ctx: DomainContext, id: string) {
      return inTx(async (tx) => (await tx.execute(sql`update pulse.jobs set name = 'leaked' where id = ${id}`)).rowCount);
    });
    // A query builder returned without await still runs inside the scope.
    const lazy = scoped(function lazy(ctx: DomainContext) {
      return db.select({ id: jobs.id }).from(jobs).where(sql`${ctx.orgId}::uuid is not null`);
    });
    expect(await leakyRead(ownerA, jobA)).toEqual([{ id: jobA }]);
    expect(await leakyRead(ownerA, jobB)).toEqual([]);
    expect(await leakyWrite(ownerA, jobB)).toBe(0);
    expect(await leakyWrite(ownerB, jobB)).toBe(1);
    expect((await lazy(ownerA)).map((row) => row.id)).toEqual([jobA]);
    expect((await lazy(ownerB)).map((row) => row.id)).toEqual([jobB]);
    // The real domain layer answers the same way.
    expect((await listJobs(ownerA)).map((job) => job.id)).toEqual([jobA]);
    const caught = await getJob(ownerA, jobB).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isDomainError(caught) && caught.code).toBe('NOT_FOUND');
    await expect(updateJob(ownerA, jobB, { name: 'mine now' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await orgB.query("update pulse.jobs set name = 'Guard job' where id = $1", [jobB]);
  });

  it('refuses a call for one workspace that turns to another half way', async () => {
    await withOrg(ownerA.orgId, async () => {
      expect(() => withOrg(ownerB.orgId, () => 1)).toThrow(DbGuardError);
      await expect(Promise.resolve().then(() => listJobs(ownerB))).rejects.toBeInstanceOf(DbGuardError);
    });
    expect(() => withOrg('not-a-uuid', () => 1)).toThrow(DbGuardError);
  });

  it('refuses a statement with no scope, and a plain role with no setting sees nothing', async () => {
    expect(currentDbScope()).toBeNull();
    await expect(rows(db, sql`select 1`)).rejects.toMatchObject({ cause: expect.any(DbGuardError) });
    await expect(db.transaction(async (tx) => rows(tx, sql`select 1`))).rejects.toBeInstanceOf(DbGuardError);
    await expect(inTx(async (tx) => rows(tx, sql`select 1`))).rejects.toBeInstanceOf(DbGuardError);
    expect(dbGuardRefusals().length).toBe(3);
    // Below the app: the role with a forgotten setting gets nothing back, and cannot write.
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`begin; set local role "${DB_GUARD_ROLE}"`);
      for (const table of ['jobs', 'clients', 'production_entries', 'activity', 'settings', 'v_facts']) {
        expect((await client.query(`select count(*)::int as n from pulse.${table}`)).rows[0].n, table).toBe(0);
      }
      expect((await client.query('select count(*)::int as n from core.member')).rows[0].n).toBe(0);
      expect((await client.query(`update pulse.jobs set name = 'x' where id = $1`, [jobA])).rowCount).toBe(0);
      await expect(client.query(`insert into pulse.sites (org_id, code, name, timezone) values ($1, 'NOSET', 'No setting', 'UTC')`, [ownerA.orgId])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('rollback').catch(() => undefined);
      await client.end();
    }
  });

  it('lets the plain role read only its own people in core, and nothing else there', async () => {
    await withOrg(ownerA.orgId, async () => {
      expect((await rows<{ id: string }>(db, sql`select id from core.organization`)).map((row) => row.id)).toEqual([ownerA.orgId]);
      expect((await rows<{ user_id: string }>(db, sql`select user_id from core.member`)).map((row) => row.user_id)).toEqual([ownerA.userId]);
      expect((await rows<{ id: string }>(db, sql`select id from core."user"`)).map((row) => row.id)).toEqual([ownerA.userId]);
      await expect(rows(db, sql`select 1 from core.account limit 1`)).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(rows(db, sql`select 1 from core.session limit 1`)).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(db.execute(sql`update core.organization set name = name where id = ${ownerA.orgId}`)).rejects.toMatchObject({ cause: { code: '42501' } });
    });
    expect((await listOrgPeople(ownerA)).map((person) => person.id)).toEqual([ownerA.userId]);
  });

  it('keeps parallel calls for two workspaces apart on the shared pool', async () => {
    const seen = await Promise.all(
      Array.from({ length: 24 }, (_, index) => {
        const owner = index % 2 === 0 ? ownerA : ownerB;
        return withOrg(owner.orgId, async () => {
          const single = await rows<{ org_id: string }>(db, sql`select distinct org_id::text as org_id from pulse.jobs`);
          const inside = await inTx((tx) => rows<{ org_id: string }>(tx, sql`select distinct org_id::text as org_id from pulse.production_entries`));
          return { want: owner.orgId, single: single.map((row) => row.org_id), inside: inside.map((row) => row.org_id) };
        });
      }),
    );
    for (const result of seen) expect(result).toEqual({ want: result.want, single: [result.want], inside: [result.want] });
    // A pooled connection goes back clean: the role and the setting end with each transaction.
    expect(await asSystem('test: read the session of a pooled connection', () => who())).toEqual({ role: loginRole, org: null });
  });

  it('rolls a guarded transaction back as one piece', async () => {
    await withOrg(ownerA.orgId, async () => {
      await expect(
        inTx(async (tx) => {
          await tx.execute(sql`update pulse.jobs set name = 'half done' where id = ${jobA}`);
          throw new Error('stop');
        }),
      ).rejects.toThrow('stop');
      expect((await rows<{ name: string }>(db, sql`select name from pulse.jobs where id = ${jobA}`))[0]?.name).toBe('Guard job');
    });
  });

  it('asSystem is the one way across workspaces, and a domain call inside it is still tied to its workspace', async () => {
    await asSystem('test: read two workspaces', async () => {
      expect(currentDbScope()).toEqual({ org: null, system: true });
      expect(await who()).toEqual({ role: loginRole, org: null });
      const both = await rows<{ id: string }>(db, sql`select id from pulse.jobs where id in (${jobA}, ${jobB}) order by id`);
      expect(both.map((row) => row.id).sort()).toEqual([jobA, jobB].sort());
      expect((await listJobs(ownerA)).map((job) => job.id)).toEqual([jobA]);
      expect((await listJobs(ownerB)).map((job) => job.id)).toEqual([jobB]);
    });
  });

  it('with the flag off the app runs as before: the login role, no scope needed', async () => {
    vi.stubEnv('PULSE_DB_GUARD', '0');
    expect(await who()).toEqual({ role: loginRole, org: null });
    expect(await withOrg(ownerA.orgId, () => who())).toEqual({ role: loginRole, org: null });
    expect((await rows<{ n: number }>(db, sql`select count(*)::int as n from pulse.jobs where id in (${jobA}, ${jobB})`))[0]?.n).toBe(2);
    expect((await listJobs(ownerA)).map((job) => job.id)).toEqual([jobA]);
  });
});
