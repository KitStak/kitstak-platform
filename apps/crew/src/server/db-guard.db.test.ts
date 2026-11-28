/**
 * The database guard at work (docs/crew/SPEC.md 5, the Pulse db-guard test): with CREW_DB_GUARD on,
 * the app runs every statement as the plain role `crew_app` with the workspace setting, so the
 * policies of 0000_crew_init apply to the app itself. These tests hand org B's ids straight to org
 * A's scope through raw SQL and check that the database, not the WHERE clause, keeps them apart.
 * Skipped when no database answers or the role is not usable.
 */
import { sql } from 'drizzle-orm';
import { resolveCrewAccess } from '@kitstak/crew-bridge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { DB_GUARD_ROLE, dbGuardRefusals, scoped, withOrg } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';
import { people, sites } from '@/server/db/schema';
import { inTx, rows, type DomainContext } from '@/server/domain/_shared';
import { claimCrewOwnership, whoRunsCrew } from '@/server/domain/roles';
import { ensureSetup } from '@/server/domain/settings';
import { upsertVendorKind } from '@/server/domain/vendors';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

const who = (executor: Parameters<typeof rows>[0] = db) =>
  rows<{ role: string; org: string | null }>(executor, sql`select current_user::text as role, nullif(current_setting('crew.org_id', true), '') as org`).then((found) => found[0]!);

describe.skipIf(!ready)('the database guard keeps one workspace out of another workspace crew rows', () => {
  let orgA: TestOrg;
  let orgB: TestOrg;
  let ownerA: DomainContext;
  let ownerB: DomainContext;
  let siteA: string;
  let siteB: string;
  let personB: string;
  let vendorB: string;

  beforeAll(async () => {
    vi.stubEnv('CREW_DB_GUARD', '1');
    orgA = await createTestOrg('crew-guard-a');
    orgB = await createTestOrg('crew-guard-b');
    ownerA = await orgA.member('owner', 'Guard Owner A');
    ownerB = await orgB.member('owner', 'Guard Owner B');
    siteA = (await ensureSetup(ownerA.orgId)).defaultSite.id;
    siteB = (await ensureSetup(ownerB.orgId)).defaultSite.id;
    vendorB = (await withOrg(ownerB.orgId, () => inTx((tx) => upsertVendorKind(tx, ownerB, { name: 'Brightway Staffing', kind: 'temp_agency' })))).vendor.id;
    for (const [owner, site] of [[ownerA, siteA], [ownerB, siteB]] as const) {
      await withOrg(owner.orgId, () =>
        db.insert(people).values({ orgId: owner.orgId, number: '1001', firstName: 'Maria', lastName: `Lopez ${owner.orgSlug}`, homeSiteId: site, kind: owner === ownerB ? 'temp' : 'employee', agencyVendorId: owner === ownerB ? vendorB : null }),
      );
    }
    personB = (await orgB.query<{ id: string }>('select id from crew.people where org_id = $1', [orgB.orgId]))[0]!.id;
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv('CREW_DB_GUARD', '1');
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

  it('is in force: the flag is on and the login really becomes the plain role with the workspace set', async () => {
    expect(await dbGuardStatus()).toMatchObject({ on: true, active: true, ready: true, reason: null, role: DB_GUARD_ROLE });
    await withOrg(ownerA.orgId, async () => {
      expect(await who()).toEqual({ role: DB_GUARD_ROLE, org: ownerA.orgId });
      await inTx(async (tx) => expect(await who(tx)).toEqual({ role: DB_GUARD_ROLE, org: ownerA.orgId }));
    });
  });

  it('cannot read org B crew rows from org A, even with the ids in hand and no org filter', async () => {
    await withOrg(ownerA.orgId, async () => {
      expect(await rows(db, sql`select id from crew.people where id = ${personB}`)).toEqual([]);
      expect(await rows(db, sql`select id from crew.sites where id = ${siteB}`)).toEqual([]);
      expect(await rows(db, sql`select 1 from crew.settings where org_id = ${ownerB.orgId}`)).toEqual([]);
      expect(await rows(db, sql`select 1 from core.vendors where id = ${vendorB}`)).toEqual([]);
      expect((await rows<{ orgs: string[] }>(db, sql`select coalesce(array_agg(distinct org_id::text), '{}') as orgs from crew.people`))[0]?.orgs).toEqual([ownerA.orgId]);
      const typed = await db.select({ id: sites.id }).from(sites);
      expect(typed.map((row) => row.id)).toEqual([siteA]);
    });
  });

  it('cannot change, remove or add org B rows from org A', async () => {
    await withOrg(ownerA.orgId, async () => {
      await inTx(async (tx) => {
        expect((await tx.execute(sql`update crew.people set first_name = 'Taken' where id = ${personB}`)).rowCount).toBe(0);
        expect((await tx.execute(sql`delete from crew.sites where id = ${siteB}`)).rowCount).toBe(0);
      });
      await expect(db.execute(sql`insert into crew.sites (org_id, code, name, timezone, week_start) values (${ownerB.orgId}, 'SNEAK', 'Sneak', 'UTC', 0)`)).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(db.execute(sql`update crew.sites set org_id = ${ownerB.orgId} where id = ${siteA}`)).rejects.toMatchObject({ cause: { code: '42501' } });
    });
    const [untouched] = await orgB.query<{ first_name: string }>('select first_name from crew.people where id = $1', [personB]);
    expect(untouched?.first_name).toBe('Maria');
    expect(await orgB.query("select 1 from crew.sites where code = 'SNEAK'")).toEqual([]);
  });

  it('refuses a person in org A who points at org B parents (composite keys and the vendor trigger)', async () => {
    // As the owner, where row level security does not apply: the schema itself refuses.
    await expect(orgA.query("insert into crew.people (org_id, number, first_name, last_name, home_site_id) values ($1, '2002', 'X', 'Y', $2)", [orgA.orgId, siteB])).rejects.toMatchObject({ code: '23503' });
    await expect(orgA.query("insert into crew.people (org_id, number, first_name, last_name, home_site_id, kind, agency_vendor_id) values ($1, '2003', 'X', 'Y', $2, 'temp', $3)", [orgA.orgId, siteA, vendorB])).rejects.toMatchObject({ code: '23503' });
  });

  it('holds for a domain function that forgets its org filter', async () => {
    const leaky = scoped(async function leaky(_ctx: DomainContext, id: string) {
      return rows<{ id: string }>(db, sql`select id from crew.people where id = ${id}`);
    });
    expect(await leaky(ownerA, personB)).toEqual([]);
    expect(await leaky(ownerB, personB)).toEqual([{ id: personB }]);
  });

  it('the bridge reads access through the guard, and the claim step works under it', async () => {
    const admin = await orgA.member('admin', 'Guard Admin A');
    expect(await withOrg(ownerA.orgId, () => resolveCrewAccess(db, { orgId: ownerA.orgId, userId: ownerA.userId }))).toMatchObject({ role: 'owner', canSeePay: true });
    expect(await withOrg(ownerA.orgId, () => resolveCrewAccess(db, { orgId: ownerA.orgId, userId: ownerB.userId }))).toMatchObject({ role: 'none' });
    // An org owner already runs Crew, so the admin may not claim.
    expect((await whoRunsCrew(admin)).canClaim).toBe(false);
    await expect(claimCrewOwnership(admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps the activity log append only', async () => {
    await withOrg(ownerA.orgId, () => db.execute(sql`insert into crew.activity (org_id, verb, entity_type) values (${ownerA.orgId}, 'test.made', 'test')`));
    await expect(withOrg(ownerA.orgId, () => db.execute(sql`update crew.activity set verb = 'changed' where org_id = ${ownerA.orgId}`))).rejects.toMatchObject({ cause: { code: 'KC002' } });
  });
});
