import { describe, expect, it } from 'vitest';
import { PULSE_ACTION_MIN, canImportStream, canPulse, canSeeMoney, canSeeWages, type PulseAction, type PulseRole } from '@/lib/permissions';
import { pulseRoleFromWmsUser, resolveAccess } from './access';
import { ACTIVITY_SAFE_FIELDS } from './activity';

const base = { explicit: null, wmsRole: null, orgRole: 'member' as const, defaultMemberRole: 'none' as const };

describe('resolveAccess (SPEC section 3)', () => {
  it('uses the explicit row first, even over a warehouse role and the org role', () => {
    const access = resolveAccess({ explicit: { role: 'viewer', seesMoney: false }, wmsRole: 'admin', orgRole: 'owner', defaultMemberRole: 'manager' });
    expect(access).toMatchObject({ role: 'viewer', source: 'explicit', seesMoney: false, seesWages: false });
  });

  it('uses the warehouse role before the org role', () => {
    expect(resolveAccess({ ...base, wmsRole: 'supervisor', orgRole: 'owner' })).toMatchObject({ role: 'supervisor', source: 'wms', seesMoney: false });
  });

  it('maps org roles: owner, admin, member to the workspace default, viewer and guest to none', () => {
    expect(resolveAccess({ ...base, orgRole: 'owner' }).role).toBe('owner');
    expect(resolveAccess({ ...base, orgRole: 'admin' }).role).toBe('admin');
    expect(resolveAccess({ ...base, orgRole: 'member' }).role).toBe('none');
    expect(resolveAccess({ ...base, orgRole: 'member', defaultMemberRole: 'supervisor' }).role).toBe('supervisor');
    expect(resolveAccess({ ...base, orgRole: 'viewer', defaultMemberRole: 'manager' }).role).toBe('none');
    expect(resolveAccess({ ...base, orgRole: 'guest', defaultMemberRole: 'manager' }).role).toBe('none');
    expect(resolveAccess({ ...base, orgRole: null }).role).toBe('none');
  });

  it('ignores an explicit row with an unknown role', () => {
    expect(resolveAccess({ ...base, explicit: { role: 'wizard', seesMoney: true }, orgRole: 'admin' })).toMatchObject({ role: 'admin', source: 'org' });
  });

  it('seeing money is opt in for supervisors and viewers, automatic from manager up, never for none', () => {
    const money = (role: string, seesMoney: boolean) => resolveAccess({ ...base, explicit: { role, seesMoney } }).seesMoney;
    expect(money('owner', false)).toBe(true);
    expect(money('admin', false)).toBe(true);
    expect(money('manager', false)).toBe(true);
    expect(money('supervisor', false)).toBe(false);
    expect(money('supervisor', true)).toBe(true);
    expect(money('viewer', false)).toBe(false);
    expect(money('viewer', true)).toBe(true);
    expect(money('none', true)).toBe(false);
  });

  it('wage detail is for admins and owners only: a manager sees money but never the wage', () => {
    const wages = (role: string) => resolveAccess({ ...base, explicit: { role, seesMoney: true } }).seesWages;
    expect(wages('owner')).toBe(true);
    expect(wages('admin')).toBe(true);
    expect(wages('manager')).toBe(false);
    expect(wages('supervisor')).toBe(false);
    expect(wages('viewer')).toBe(false);
  });
});

describe('pulseRoleFromWmsUser', () => {
  it('follows the warehouse role table', () => {
    expect(pulseRoleFromWmsUser({ userType: 'Owner', role: 'viewer', isApiUser: false })).toBe('admin');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'admin', isApiUser: false })).toBe('admin');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'manager', isApiUser: false })).toBe('manager');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'operator', isApiUser: false })).toBe('supervisor');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'viewer', isApiUser: false })).toBe('viewer');
    expect(pulseRoleFromWmsUser({ userType: 'Client', role: 'admin', isApiUser: false })).toBe('none');
    expect(pulseRoleFromWmsUser({ userType: 'Owner', role: 'admin', isApiUser: true })).toBe('none');
    expect(pulseRoleFromWmsUser({ userType: null, role: null, isApiUser: false })).toBeNull();
  });
});

describe('the action table', () => {
  const allow = (role: PulseRole): PulseAction[] => (Object.keys(PULSE_ACTION_MIN) as PulseAction[]).filter((action) => canPulse(role, action));

  it('gives each role exactly the rights of the spec', () => {
    expect(allow('none')).toEqual([]);
    expect(allow('viewer').sort()).toEqual(['export:run', 'pulse:read']);
    expect(allow('supervisor').sort()).toEqual(['export:run', 'material:log', 'production:log', 'pulse:read']);
    expect(allow('manager')).toEqual(expect.arrayContaining(['job:manage', 'plan:manage', 'cost:manage', 'revenue:manage', 'vas:manage', 'standard:manage', 'target:manage', 'alert:manage', 'import:run', 'day:review', 'production:edit_any', 'device:manage']));
    for (const action of ['rate:manage', 'period:close', 'roles:manage', 'settings:manage', 'sample:manage', 'period:reopen', 'data:purge'] as const) expect(canPulse('manager', action)).toBe(false);
    for (const action of ['rate:manage', 'period:close', 'roles:manage', 'settings:manage', 'sample:manage'] as const) expect(canPulse('admin', action)).toBe(true);
    expect(canPulse('admin', 'period:reopen')).toBe(false);
    expect(canPulse('admin', 'data:purge')).toBe(false);
    expect(allow('owner').length).toBe(Object.keys(PULSE_ACTION_MIN).length);
  });

  it('lets a supervisor import only the floor streams', () => {
    expect(canImportStream('supervisor', 'production')).toBe(true);
    expect(canImportStream('supervisor', 'materials')).toBe(true);
    expect(canImportStream('supervisor', 'costs')).toBe(false);
    expect(canImportStream('manager', 'costs')).toBe(true);
    expect(canImportStream('viewer', 'production')).toBe(false);
  });

  it('money and wage helpers agree with the role table', () => {
    expect(canSeeMoney('viewer')).toBe(false);
    expect(canSeeMoney('viewer', true)).toBe(true);
    expect(canSeeMoney(null, true)).toBe(false);
    expect(canSeeWages('manager')).toBe(false);
    expect(canSeeWages('admin')).toBe(true);
  });
});

describe('activity redaction allow list', () => {
  it('never lists a money, margin or rate field', () => {
    for (const [entity, fields] of Object.entries(ACTIVITY_SAFE_FIELDS)) {
      for (const field of fields) expect(`${entity}.${field}`).not.toMatch(/cents|price|cost|margin|rate|wage|amount|revenue|profit/i);
    }
  });
});

describe('singular unit word', () => {
  it('turns a unit label into one unit', async () => {
    const { singular } = await import('./_shared');
    expect(singular('kits')).toBe('kit');
    expect(singular('boxes')).toBe('box');
    expect(singular('assemblies')).toBe('assembly');
    expect(singular('pouches')).toBe('pouch');
    expect(singular('glass')).toBe('glass');
    expect(singular('each')).toBe('each');
    expect(singular('')).toBe('unit');
    expect(singular(null)).toBe('unit');
  });
});
