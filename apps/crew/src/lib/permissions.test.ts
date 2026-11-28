import { describe, expect, it } from 'vitest';
import { assignableRoles, canCrew, canSelf, CREW_ACTION_MIN, CREW_ROLE_LABELS, CREW_ROLES, type CrewAction } from './permissions';

const can = (role: Parameters<typeof canCrew>[0], actions: readonly CrewAction[]) => actions.every((action) => canCrew(role, action));

describe('Crew action table (SPEC 3.3)', () => {
  it('covers every action in the spec', () => {
    expect(Object.keys(CREW_ACTION_MIN)).toHaveLength(29);
  });

  it('a viewer reads the schedule, the board and skills, and changes nothing', () => {
    expect(can('viewer', ['crew:read', 'schedule:read'])).toBe(true);
    for (const action of ['schedule:draft', 'person:manage', 'plan:read', 'pay:read', 'attendance:read'] as const) expect(canCrew('viewer', action), action).toBe(false);
  });

  it('a lead reads the plan but edits nothing and never sees pay or attendance', () => {
    expect(can('lead', ['crew:read', 'schedule:read', 'plan:read'])).toBe(true);
    for (const action of ['plan:manage', 'punch:edit', 'attendance:read', 'person:private_read', 'pay:read'] as const) expect(canCrew('lead', action), action).toBe(false);
  });

  it('a supervisor runs the floor but has no pay rights', () => {
    expect(can('supervisor', ['schedule:publish', 'punch:edit', 'hours:approve', 'person:private_read', 'import:run', 'plan:manage'])).toBe(true);
    for (const action of ['pay:read', 'pay:manage', 'week:reopen', 'export:payroll', 'settings:manage'] as const) expect(canCrew('supervisor', action), action).toBe(false);
  });

  it('payroll has every supervisor right plus pay, and no setup rights', () => {
    expect(can('payroll', ['hours:approve', 'pay:read', 'pay:manage', 'week:reopen', 'export:payroll', 'timeoff:balance'])).toBe(true);
    for (const action of ['kiosk:manage', 'rules:manage', 'roles:manage', 'settings:manage'] as const) expect(canCrew('payroll', action), action).toBe(false);
  });

  it('an admin sets Crew up; only the owner may delete all data', () => {
    expect(can('admin', ['kiosk:manage', 'rules:manage', 'certtype:manage', 'roles:manage', 'settings:manage', 'sample:manage', 'pay:read'])).toBe(true);
    expect(canCrew('admin', 'data:purge')).toBe(false);
    expect(canCrew('owner', 'data:purge')).toBe(true);
  });

  it('role none and a missing role can do nothing', () => {
    for (const action of Object.keys(CREW_ACTION_MIN) as CrewAction[]) {
      expect(canCrew('none', action)).toBe(false);
      expect(canCrew(null, action)).toBe(false);
    }
  });
});

describe('self rights', () => {
  it('need a linked live person, whatever the role', () => {
    expect(canSelf('p1')).toBe(true);
    expect(canSelf(null)).toBe(false);
    expect(canSelf('')).toBe(false);
  });
});

describe('roles', () => {
  it('only an owner hands out the owner role', () => {
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('admin')).toContain('payroll');
    expect(assignableRoles('supervisor')).toEqual([]);
  });

  it('every role has a label', () => {
    for (const role of CREW_ROLES) expect(CREW_ROLE_LABELS[role]).toBeTruthy();
  });
});
