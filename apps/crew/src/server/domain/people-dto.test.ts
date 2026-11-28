/**
 * The DTO walk (docs/crew/SPEC.md 3.3): every people DTO built as every role. A lead or a viewer
 * must get no pay and no private field with a value, and no string that reads like money.
 */
import { describe, expect, it } from 'vitest';
import { CREW_ROLES, resolveRole, type CrewRole } from '@kitstak/crew-bridge';
import { PAY_KEYS, PRIVATE_KEYS, redactCells, toActivityDto, toPersonDto, toPersonListItem, wageOn, type PersonRecord, type Sight } from './people-dto';

const NOW = new Date('2026-11-27T15:00:00Z');

const RECORD: PersonRecord = {
  id: 'p1',
  number: 'T-1001',
  firstName: 'Maria',
  lastName: 'Lopez',
  preferredName: null,
  kind: 'temp',
  status: 'active',
  homeSiteId: 's1',
  homeSiteName: 'MLT1',
  usualAreaId: 'a1',
  usualAreaName: 'Kitting line 1',
  laborClassId: 'c1',
  laborClassName: 'Temp packer',
  leadPersonId: 'p0',
  leadName: 'Ana Ruiz',
  agencyVendorId: 'v1',
  agencyName: 'Brightway Staffing',
  agencyRef: 'BW-5531',
  startDate: '2026-11-01',
  endDate: null,
  userId: null,
  userName: null,
  wmsUserId: null,
  email: 'maria@example.com',
  phone: '555-0101',
  language: 'es',
  badgeHash: 'abc',
  pinHash: 'salt:hash',
  pinSetAt: NOW,
  pinLockedUntil: null,
  notifyEmail: true,
  notes: 'Prefers first shift',
  source: 'csv',
  version: 3,
  createdAt: NOW,
  updatedAt: NOW,
};
const PRIVATE = { emergencyName: 'Ana Lopez', emergencyPhone: '555-0199', emergencyRelation: 'Sister', homeAddress: { city: 'Mesquite' }, privateNotes: 'Bus rider' };
const PAY = { payType: 'hourly', overtimeExempt: false, wages: [{ id: 'w1', effectiveFrom: '2026-11-01', wageCents: 1950, note: null, sentToPulseAt: null }] };

const sightFor = (role: CrewRole): Sight => {
  const access = resolveRole({ explicit: { role, siteIds: null }, orgRole: 'member', defaultMemberRole: 'none' });
  return { canSeePay: access.canSeePay, canSeePrivate: access.canSeePrivate };
};

const PAY_FIELDS = ['payType', 'overtimeExempt', 'wageCents', 'wages'] as const;
const PRIVATE_FIELDS = ['email', 'phone', 'notes', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'homeAddress', 'privateNotes'] as const;
const MONEY = /[$€£]\s?\d/;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => strings(item, out));
  return out;
}

function allDtos(sight: Sight) {
  const activity = toActivityDto(
    { id: 'x', verb: 'person.updated', entityType: 'person', entityId: 'p1', actorName: 'Jonah', actorKind: 'user', before: { name: 'Maria Lopez', email: 'old@example.com', phone: '555' }, after: { name: 'Maria Lopez', email: 'maria@example.com', wageCents: 1950, wage: '$19.50' }, createdAt: NOW },
    sight,
  );
  const payActivity = toActivityDto({ id: 'y', verb: 'person.wage_set', entityType: 'person_wage', entityId: 'p1', actorName: 'Grace', actorKind: 'user', before: null, after: { wageCents: 1950 }, createdAt: NOW }, sight);
  const privateActivity = toActivityDto({ id: 'z', verb: 'person.private_changed', entityType: 'person_private', entityId: 'p1', actorName: 'Jonah', actorKind: 'user', before: null, after: { emergencyName: 'Ana' }, createdAt: NOW }, sight);
  return {
    person: toPersonDto(RECORD, { private: PRIVATE, pay: PAY, today: '2026-11-27', now: NOW }, sight),
    listItem: toPersonListItem(RECORD, sight),
    activity,
    payActivity,
    privateActivity,
    importCells: redactCells({ first_name: 'Maria', wage_per_hour: '$19.50', pay_type: 'hourly', overtime_exempt: 'no', emergency_name: 'Ana', emergency_phone: '555-0199' }, sight),
  };
}

describe('the DTO walk for every role (SPEC 3.3)', () => {
  it.each(CREW_ROLES.filter((role) => role !== 'none'))('%s', (role) => {
    const sight = sightFor(role);
    const dtos = allDtos(sight);
    const seesPay = ['owner', 'admin', 'payroll'].includes(role);
    const seesPrivate = ['owner', 'admin', 'payroll', 'supervisor'].includes(role);
    expect(sight).toEqual({ canSeePay: seesPay, canSeePrivate: seesPrivate });
    for (const field of PAY_FIELDS) expect(dtos.person[field] === null, `${role} ${field}`).toBe(!seesPay);
    for (const field of PRIVATE_FIELDS) expect(dtos.person[field] === null, `${role} ${field}`).toBe(!seesPrivate);
    expect(dtos.person.payHidden).toBe(!seesPay);
    expect(dtos.person.privateHidden).toBe(!seesPrivate);
    expect(dtos.listItem.phone === null && dtos.listItem.email === null).toBe(!seesPrivate);
    expect(dtos.payActivity === null).toBe(!seesPay);
    expect(dtos.privateActivity === null).toBe(!seesPrivate);
    expect('wage_per_hour' in dtos.importCells).toBe(seesPay);
    expect('emergency_name' in dtos.importCells).toBe(seesPrivate);
    if (!seesPay) {
      // No string anywhere reads like money, and no pay key survives in the activity.
      expect(strings(dtos).filter((text) => MONEY.test(text))).toEqual([]);
      expect(Object.keys(dtos.activity?.after ?? {}).filter((key) => PAY_KEYS.has(key))).toEqual([]);
    }
    if (!seesPrivate) {
      expect(Object.keys({ ...dtos.activity?.before, ...dtos.activity?.after }).filter((key) => PRIVATE_KEYS.has(key))).toEqual([]);
      expect(strings(dtos)).not.toContain('maria@example.com');
      expect(strings(dtos)).not.toContain('555-0199');
    }
  });

  it('a lead gets names, site, area, lead and agency, but nothing private or paid', () => {
    const person = allDtos(sightFor('lead')).person;
    expect(person).toMatchObject({ displayName: 'Maria Lopez', homeSiteName: 'MLT1', usualAreaName: 'Kitting line 1', leadName: 'Ana Ruiz', agencyName: 'Brightway Staffing', hasPin: true, hasBadge: true });
    expect(JSON.stringify(person)).not.toMatch(/1950|Bus rider|Sister|Mesquite|Prefers first shift/);
  });

  it('payroll sees the wage in force on the day', () => {
    const person = allDtos(sightFor('payroll')).person;
    expect(person.wageCents).toBe(1950);
    expect(wageOn([{ effectiveFrom: '2026-11-01', wageCents: 1950 }, { effectiveFrom: '2026-12-01', wageCents: 2050 }], '2026-11-30')).toBe(1950);
    expect(wageOn([{ effectiveFrom: '2026-12-01', wageCents: 2050 }], '2026-11-30')).toBeNull();
  });
});
