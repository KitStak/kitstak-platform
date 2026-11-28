/** Settings, the default site, upsertVendorKind, the claim step and the Phase 0 seed, against the local database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';
import { KITSTAK_PLAN, seedPhase0 } from '@/server/db/seed/phase0';
import { inTx, type DomainContext } from '@/server/domain/_shared';
import { freshCrewAccess } from '@/server/domain/access';
import { claimCrewOwnership, whoRunsCrew } from '@/server/domain/roles';
import { ensureSetup, listSites } from '@/server/domain/settings';
import { upsertVendorKind } from '@/server/domain/vendors';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

describe.skipIf(!ready)('Crew setup rows', () => {
  let org: TestOrg;
  let admin: DomainContext;
  let member: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('crew-setup');
    // No org owner: the first admin may claim Crew (SPEC 3.1).
    admin = await org.member('admin', 'Setup Admin');
    member = await org.member('member', 'Setup Member');
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  it('makes settings and one default Main site, once', async () => {
    const first = await ensureSetup(admin.orgId, { timezone: 'America/Denver' });
    const again = await ensureSetup(admin.orgId, { timezone: 'Europe/Paris' });
    expect(first.defaultSite).toMatchObject({ code: 'MAIN', name: 'Main site', timezone: 'America/Denver', isDefault: true, weekStart: 0 });
    expect(again.defaultSite.id).toBe(first.defaultSite.id);
    expect(first.settings).toMatchObject({ defaultMemberRole: 'none', pinLength: 4, fenceMode: 'flag', numberPrefixTemp: 'T-' });
    expect(await listSites(admin.orgId)).toHaveLength(1);
  });

  it('offers the claim to the admin, not to a member, and writes an owner row', async () => {
    expect(await whoRunsCrew(member)).toMatchObject({ hasOwner: false, canClaim: false });
    expect(await whoRunsCrew(admin)).toMatchObject({ hasOwner: false, canClaim: true });
    await expect(claimCrewOwnership(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await claimCrewOwnership(admin)).role).toBe('owner');
    expect(await freshCrewAccess(admin)).toMatchObject({ role: 'owner', source: 'explicit', canSeePay: true });
    expect(await whoRunsCrew(member)).toMatchObject({ hasOwner: true, canClaim: false, ownerNames: ['Setup Admin'] });
    const log = await org.query<{ verb: string }>("select verb from crew.activity where org_id = $1 and entity_type = 'member_role'", [org.orgId]);
    expect(log.map((row) => row.verb)).toEqual(['role.changed']);
  });

  it('adds temp_agency to a vendor that already exists instead of making a second one', async () => {
    await org.query("insert into core.vendors (org_id, name, kinds) values ($1, 'Brightway Staffing', '{supplier}')", [org.orgId]);
    const result = await withOrg(admin.orgId, () => inTx((tx) => upsertVendorKind(tx, admin, { name: '  brightway staffing ', kind: 'temp_agency' })));
    expect(result.created).toBe(false);
    expect(result.vendor.kinds).toEqual(['supplier', 'temp_agency']);
    const again = await withOrg(admin.orgId, () => inTx((tx) => upsertVendorKind(tx, admin, { name: 'Brightway Staffing', kind: 'temp_agency' })));
    expect(again.created).toBe(false);
    const made = await withOrg(admin.orgId, () => inTx((tx) => upsertVendorKind(tx, admin, { name: 'Coastline Staffing', kind: 'temp_agency' })));
    expect(made).toMatchObject({ created: true, vendor: { kinds: ['temp_agency'] } });
    expect(await org.query('select 1 from core.vendors where org_id = $1', [org.orgId])).toHaveLength(2);
  });

  it('seeds Phase 0 idempotently: two sites, Federal rules and five areas each, one default', async () => {
    const first = await seedPhase0(admin, KITSTAK_PLAN);
    const second = await seedPhase0(admin, KITSTAK_PLAN);
    expect(second).toEqual(first);
    const sites = await listSites(admin.orgId);
    expect(sites.map((site) => [site.code, site.isDefault])).toEqual([
      ['MLT1', true],
      ['KS2', false],
      ['MAIN', false],
    ]);
    const counts = await org.query<{ areas: number; rules: number }>('select (select count(*)::int from crew.areas where org_id = $1) as areas, (select count(*)::int from crew.site_rules where org_id = $1) as rules', [org.orgId]);
    expect(counts[0]).toEqual({ areas: 10, rules: 2 });
  });
});
