/** Pure rules behind the claim step, the setup checklist and the vendor kinds. */
import { NO_CREW_ACCESS, resolveRole } from '@kitstak/crew-bridge';
import { describe, expect, it } from 'vitest';
import { setupChecklist } from '@/lib/setup-steps';
import type { OrgRole } from '@/lib/permissions';
import { claimState } from './roles';
import { withKind } from './vendors';

const person = (userId: string, orgRole: OrgRole, explicit?: string) => ({
  userId,
  name: userId,
  orgRole,
  access: resolveRole({ explicit: explicit ? { role: explicit, siteIds: null } : null, orgRole, defaultMemberRole: 'none' }),
});

describe('claim step (SPEC 3.1)', () => {
  it('an org owner already runs Crew, so nobody is offered the claim', () => {
    const members = [person('o', 'owner'), person('a', 'admin')];
    expect(claimState(members, 'a')).toEqual({ hasOwner: true, canClaim: false, ownerNames: ['o'] });
  });

  it('with no Crew owner the admin is offered it, a member is not', () => {
    const members = [person('o', 'owner', 'viewer'), person('a', 'admin'), person('m', 'member')];
    expect(claimState(members, 'a').canClaim).toBe(true);
    expect(claimState(members, 'm').canClaim).toBe(false);
  });

  it('with no admin at all any member is offered it', () => {
    const members = [person('m', 'member'), person('n', 'member')];
    expect(claimState(members, 'n')).toMatchObject({ hasOwner: false, canClaim: true });
  });

  it('a person who is not in the list is never offered it', () => {
    expect(claimState([person('m', 'member')], 'x').canClaim).toBe(false);
    expect(NO_CREW_ACCESS.role).toBe('none');
  });
});

describe('setup checklist (SPEC 9)', () => {
  it('shows four steps without Pulse and five with it, in order', () => {
    expect(setupChecklist(null).map((step) => step.key)).toEqual(['crew_people', 'crew_schedule', 'crew_kiosk', 'crew_approve']);
    const withPulse = setupChecklist({ crew_people: true, crew_schedule: false, crew_kiosk: false, crew_approve: false, crew_connect: false });
    expect(withPulse.map((step) => step.title)).toEqual(['Add your people', 'Publish your first week', 'Set up the time clock', 'Approve a week of hours', 'Send hours to Pulse']);
  });

  it('marks done steps and steps that wait for another', () => {
    const steps = setupChecklist({ crew_people: true, crew_schedule: false, crew_kiosk: false, crew_approve: false, crew_connect: null });
    expect(steps.find((step) => step.key === 'crew_people')).toMatchObject({ done: true, waiting: false });
    expect(steps.find((step) => step.key === 'crew_schedule')).toMatchObject({ done: false, waiting: false });
    expect(steps.find((step) => step.key === 'crew_approve')).toMatchObject({ done: false, waiting: true });
  });
});

describe('vendor kinds', () => {
  it('adds a kind once, keeps known kinds and sorts them', () => {
    expect(withKind(['supplier'], 'temp_agency')).toEqual(['supplier', 'temp_agency']);
    expect(withKind(['temp_agency'], 'temp_agency')).toEqual(['temp_agency']);
    expect(withKind(['bogus', 'carrier'], 'temp_agency')).toEqual(['carrier', 'temp_agency']);
  });
});
