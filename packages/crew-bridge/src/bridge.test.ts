import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  canSeePay,
  canSeePrivate,
  crewAvailability,
  crewRoleAtLeast,
  crewRoleFromOrgRole,
  crewUrls,
  getSetupSignals,
  NO_CREW_ACCESS,
  parseOrgRole,
  resetAvailabilityCache,
  resolveCrewAccess,
  resolveRole,
  type BridgeExecutor,
} from './index';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const dialect = new PgDialect();

/** A fake executor: answers each statement with the first handler whose pattern matches the SQL text. */
function fakeDb(handlers: readonly [RegExp, (params: unknown[]) => unknown[]][], log: string[] = []): BridgeExecutor {
  return {
    async execute(statement: SQL) {
      const { sql, params } = dialect.sqlToQuery(statement);
      log.push(sql);
      for (const [pattern, answer] of handlers) if (pattern.test(sql)) return { rows: answer(params) };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

/** `to_regclass` answers from a set of present tables. */
const present = (tables: readonly string[]): [RegExp, (params: unknown[]) => unknown[]][] => [
  [/to_regclass\('crew\.people'\)/, () => [{ installed: tables.includes('crew.people') }]],
  [/to_regclass\(\$1\)/, (params) => [{ ok: tables.includes(String(params[0])) }]],
];

describe('resolveRole (SPEC 3.1)', () => {
  it('an explicit Crew role wins over the org role', () => {
    const access = resolveRole({ explicit: { role: 'viewer', siteIds: null }, orgRole: 'owner', defaultMemberRole: 'supervisor' });
    expect(access).toMatchObject({ role: 'viewer', source: 'explicit', canSeePay: false, canSeePrivate: false });
  });

  it('falls back to the org role: owner, admin, member gets the default, viewer and guest get none', () => {
    expect(resolveRole({ explicit: null, orgRole: 'owner', defaultMemberRole: 'none' })).toMatchObject({ role: 'owner', source: 'org', canSeePay: true });
    expect(resolveRole({ explicit: null, orgRole: 'admin', defaultMemberRole: 'none' }).role).toBe('admin');
    expect(resolveRole({ explicit: null, orgRole: 'member', defaultMemberRole: 'lead' }).role).toBe('lead');
    expect(resolveRole({ explicit: null, orgRole: 'member', defaultMemberRole: null }).role).toBe('none');
    expect(resolveRole({ explicit: null, orgRole: 'viewer', defaultMemberRole: 'supervisor' }).role).toBe('none');
    expect(resolveRole({ explicit: null, orgRole: 'guest', defaultMemberRole: 'supervisor' }).role).toBe('none');
  });

  it('a default member role that is not allowed (payroll, owner) is ignored', () => {
    expect(resolveRole({ explicit: null, orgRole: 'member', defaultMemberRole: 'payroll' }).role).toBe('none');
    expect(resolveRole({ explicit: null, orgRole: 'member', defaultMemberRole: 'owner' }).role).toBe('none');
  });

  it('an unknown explicit role is ignored', () => {
    expect(resolveRole({ explicit: { role: 'boss', siteIds: null }, orgRole: 'admin', defaultMemberRole: 'none' })).toMatchObject({ role: 'admin', source: 'org' });
  });

  it('site scope applies to supervisors and leads only', () => {
    const site = '33333333-3333-4333-8333-333333333333';
    expect(resolveRole({ explicit: { role: 'supervisor', siteIds: [site] }, orgRole: 'member', defaultMemberRole: 'none' }).siteIds).toEqual([site]);
    expect(resolveRole({ explicit: { role: 'lead', siteIds: [site] }, orgRole: 'member', defaultMemberRole: 'none' }).siteIds).toEqual([site]);
    expect(resolveRole({ explicit: { role: 'payroll', siteIds: [site] }, orgRole: 'member', defaultMemberRole: 'none' }).siteIds).toBeNull();
    expect(resolveRole({ explicit: { role: 'supervisor', siteIds: null }, orgRole: 'member', defaultMemberRole: 'none' }).siteIds).toBeNull();
  });

  it('someone who is not in the org gets nothing, even with an explicit row', () => {
    expect(resolveRole({ explicit: { role: 'owner', siteIds: null }, orgRole: null, defaultMemberRole: 'none' })).toEqual(NO_CREW_ACCESS);
  });

  it('being linked to a person never grants a role', () => {
    const access = resolveRole({ explicit: null, orgRole: 'member', defaultMemberRole: 'none', linkedPersonId: 'p1' });
    expect(access).toMatchObject({ role: 'none', linkedPersonId: 'p1' });
  });
});

describe('role helpers', () => {
  it('pay is for payroll and up; private details for supervisors and up', () => {
    expect(['owner', 'admin', 'payroll'].every((role) => canSeePay(role as never))).toBe(true);
    expect(['supervisor', 'lead', 'viewer', 'none'].some((role) => canSeePay(role as never))).toBe(false);
    expect(canSeePrivate('supervisor')).toBe(true);
    expect(canSeePrivate('lead')).toBe(false);
    expect(crewRoleAtLeast('payroll', 'supervisor')).toBe(true);
    expect(crewRoleAtLeast('lead', 'supervisor')).toBe(false);
    expect(crewRoleAtLeast(null, 'none')).toBe(false);
  });

  it('reads the best role from a Better Auth list and skips deactivated members', () => {
    expect(parseOrgRole('member,admin')).toBe('admin');
    expect(parseOrgRole('deactivated:admin')).toBeNull();
    expect(parseOrgRole('billing')).toBeNull();
    expect(crewRoleFromOrgRole(null)).toBe('none');
  });
});

describe('crewAvailability', () => {
  it('reads to_regclass once and caches the answer for a minute', async () => {
    const log: string[] = [];
    const db = fakeDb(present(['crew.people']), log);
    expect(await crewAvailability(db, 1_000)).toEqual({ installed: true });
    expect(await crewAvailability(db, 30_000)).toEqual({ installed: true });
    expect(log).toHaveLength(1);
    await crewAvailability(db, 62_000);
    expect(log).toHaveLength(2);
  });

  it('never throws: an error reads as not installed', async () => {
    const db: BridgeExecutor = { execute: async () => Promise.reject(new Error('down')) };
    expect(await crewAvailability(db)).toEqual({ installed: false });
    resetAvailabilityCache(db);
  });

  it('understands postgres-js array results', async () => {
    const db: BridgeExecutor = { execute: async () => [{ installed: true }] };
    expect(await crewAvailability(db)).toEqual({ installed: true });
  });
});

describe('resolveCrewAccess', () => {
  it('answers role none without the schema, without touching crew tables', async () => {
    const log: string[] = [];
    expect(await resolveCrewAccess(fakeDb(present([]), log), { orgId: ORG, userId: USER })).toEqual(NO_CREW_ACCESS);
    expect(log.some((text) => /crew\.member_roles/.test(text))).toBe(false);
  });

  it('answers role none for ids that are not uuids', async () => {
    expect(await resolveCrewAccess(fakeDb([]), { orgId: 'nope', userId: USER })).toEqual(NO_CREW_ACCESS);
  });

  it('resolves from the member, role and settings rows', async () => {
    const db = fakeDb([
      ...present(['crew.people']),
      [/crew\.member_roles/, () => [{ org_role: 'member', crew_role: 'payroll', site_ids: null, default_member_role: 'none', person_id: 'p9' }]],
    ]);
    expect(await resolveCrewAccess(db, { orgId: ORG, userId: USER })).toMatchObject({ role: 'payroll', canSeePay: true, canSeePrivate: true, source: 'explicit', linkedPersonId: 'p9' });
  });

  it('never throws on a failed read', async () => {
    const db = fakeDb([
      ...present(['crew.people']),
      [/crew\.member_roles/, () => {
        throw new Error('boom');
      }],
    ]);
    expect(await resolveCrewAccess(db, { orgId: ORG, userId: USER })).toEqual(NO_CREW_ACCESS);
  });
});

describe('getSetupSignals (SPEC 9)', () => {
  it('is null quietly when crew.people is absent', async () => {
    expect(await getSetupSignals(fakeDb(present([])), { orgId: ORG })).toBeNull();
  });

  it('is null for a bad org id and on any error', async () => {
    expect(await getSetupSignals(fakeDb([]), { orgId: 'x' })).toBeNull();
    const db = fakeDb([...present(['crew.people']), [/select exists/, () => {
      throw new Error('boom');
    }]]);
    expect(await getSetupSignals(db, { orgId: ORG })).toBeNull();
  });

  it('counts real people only and leaves later phase steps false until their tables exist; no Pulse means no connect step', async () => {
    const log: string[] = [];
    const db = fakeDb([...present(['crew.people']), [/select exists/, () => [{ ok: true }]]], log);
    expect(await getSetupSignals(db, { orgId: ORG })).toEqual({ crew_people: true, crew_schedule: false, crew_kiosk: false, crew_approve: false, crew_connect: null });
    const peopleQuery = log.find((text) => /from crew\.people/.test(text)) ?? '';
    expect(peopleQuery).toMatch(/is_sample = false/);
    expect(peopleQuery).toMatch(/deleted_at is null/);
  });

  it('reads each step once its table exists, the phone clock counts for the kiosk step', async () => {
    const tables = ['crew.people', 'crew.schedule_weeks', 'crew.kiosk_devices', 'crew.punches', 'crew.week_approvals', 'pulse.time_punches'];
    const db = fakeDb([
      ...present(tables),
      [/from crew\.kiosk_devices/, () => [{ ok: false }]],
      [/from crew\.punches/, () => [{ ok: true }]],
      [/from crew\.week_approvals/, () => [{ ok: false }]],
      [/from pulse\.time_punches/, () => [{ ok: true }]],
      [/select exists/, () => [{ ok: true }]],
    ]);
    expect(await getSetupSignals(db, { orgId: ORG })).toEqual({ crew_people: true, crew_schedule: true, crew_kiosk: true, crew_approve: false, crew_connect: true });
  });
});

describe('crewUrls', () => {
  const urls = crewUrls('http://localhost:3800/');
  it('builds paths on the Crew origin and leaves empty params out', () => {
    expect(urls.home()).toBe('http://localhost:3800/');
    expect(urls.person('p 1')).toBe('http://localhost:3800/people/p%201');
    expect(urls.today()).toBe('http://localhost:3800/today');
    expect(urls.today('s1')).toBe('http://localhost:3800/today?site=s1');
    expect(urls.schedule('s1', '2026-11-29')).toBe('http://localhost:3800/schedule?site=s1&week=2026-11-29');
    expect(urls.timeWeek('s1', '2026-11-29')).toBe('http://localhost:3800/time?site=s1&week=2026-11-29');
    expect(urls.plan('s1')).toBe('http://localhost:3800/plan?site=s1');
  });
});
