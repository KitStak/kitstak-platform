import { describe, expect, it } from 'vitest';
import { parseOrgRole, pulseRoleFromWmsUser, resolveAccess } from './access';
import { formatCents, formatMarginBp, statusTone } from './format';
import { lastDays, thisMonth } from './read';
import { PULSE_STATUSES, PULSE_STATUS_LABELS } from './types';
import { pulseUrls } from './urls';

describe('resolveAccess', () => {
  it('an explicit Pulse role wins over the warehouse and the workspace role', () => {
    const access = resolveAccess({ explicit: { role: 'viewer', seesMoney: false }, wmsRole: 'admin', orgRole: 'owner', defaultMemberRole: 'manager' });
    expect(access).toMatchObject({ role: 'viewer', source: 'explicit', seesMoney: false, canLog: false, canManageJobs: false });
  });

  it('the per person switch shows money to a supervisor', () => {
    expect(resolveAccess({ explicit: { role: 'supervisor', seesMoney: true }, wmsRole: null, orgRole: 'member', defaultMemberRole: 'none' }).seesMoney).toBe(true);
    expect(resolveAccess({ explicit: { role: 'supervisor', seesMoney: false }, wmsRole: null, orgRole: 'member', defaultMemberRole: 'none' }).seesMoney).toBe(false);
  });

  it('the switch never gives money to a person with no role', () => {
    expect(resolveAccess({ explicit: { role: 'none', seesMoney: true }, wmsRole: null, orgRole: 'owner', defaultMemberRole: 'none' }).seesMoney).toBe(false);
  });

  it('falls to the warehouse role, then to the workspace role', () => {
    expect(resolveAccess({ explicit: null, wmsRole: 'supervisor', orgRole: 'owner', defaultMemberRole: 'none' })).toMatchObject({ role: 'supervisor', source: 'wms', canLog: true });
    expect(resolveAccess({ explicit: null, wmsRole: null, orgRole: 'owner', defaultMemberRole: 'none' })).toMatchObject({ role: 'owner', source: 'org', seesWages: true });
    expect(resolveAccess({ explicit: null, wmsRole: null, orgRole: 'member', defaultMemberRole: 'viewer' }).role).toBe('viewer');
    expect(resolveAccess({ explicit: null, wmsRole: null, orgRole: 'guest', defaultMemberRole: 'manager' }).role).toBe('none');
  });

  it('an unknown explicit role is ignored', () => {
    expect(resolveAccess({ explicit: { role: 'boss', seesMoney: true }, wmsRole: null, orgRole: 'admin', defaultMemberRole: 'none' })).toMatchObject({ role: 'admin', source: 'org' });
  });
});

describe('role helpers', () => {
  it('reads the best role from a Better Auth list and skips deactivated members', () => {
    expect(parseOrgRole('member,admin')).toBe('admin');
    expect(parseOrgRole('deactivated:member')).toBeNull();
    expect(parseOrgRole(null)).toBeNull();
  });

  it('maps warehouse users', () => {
    expect(pulseRoleFromWmsUser({ userType: 'Owner', role: 'Viewer', isApiUser: false })).toBe('admin');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'Operator', isApiUser: false })).toBe('supervisor');
    expect(pulseRoleFromWmsUser({ userType: 'Client', role: 'Admin', isApiUser: false })).toBe('none');
    expect(pulseRoleFromWmsUser({ userType: 'Operation', role: 'Admin', isApiUser: true })).toBe('none');
    expect(pulseRoleFromWmsUser({ userType: null, role: null, isApiUser: false })).toBeNull();
  });
});

describe('pulseUrls', () => {
  const urls = pulseUrls('http://localhost:3500/');

  it('builds job and log links', () => {
    expect(urls.job('J-1042')).toBe('http://localhost:3500/jobs/J-1042');
    expect(urls.log('abc')).toBe('http://localhost:3500/log?job=abc');
    expect(urls.log()).toBe('http://localhost:3500/log');
  });

  it('prefills a new job from a deal and leaves empty fields out', () => {
    expect(urls.newJobFromDeal({ dealId: 'd1', name: 'Spring kits & co', value: 240000, accountItemId: 'a1', coreCustomerId: null })).toBe(
      'http://localhost:3500/jobs/new?crmDeal=d1&name=Spring+kits+%26+co&value=240000&crmAccountItemId=a1',
    );
  });

  it('prefills a new ongoing job from a program (docs/programs/SPEC.md 6.1)', () => {
    expect(urls.newJobFromProgram({ programId: 'p1', name: 'Glove kits', clientHint: 'c1', unitLabel: 'kits' })).toBe(
      'http://localhost:3500/jobs/new?program=p1&name=Glove+kits&clientHint=c1&unitLabel=kits',
    );
    expect(urls.newJobFromProgram({ programId: 'p1' })).toBe('http://localhost:3500/jobs/new?program=p1');
  });

  it('links a client by whichever id is known', () => {
    expect(urls.client({ pulseClientId: 'p1' })).toBe('http://localhost:3500/clients/p1');
    expect(urls.client({ coreCustomerId: 'c1' })).toBe('http://localhost:3500/clients/by-link?coreCustomerId=c1');
    expect(urls.byLink('wms_work_order', 'w1')).toBe('http://localhost:3500/jobs/by-link?type=wms_work_order&id=w1');
  });
});

describe('format', () => {
  it('prints money and margins the same on every machine', () => {
    expect(formatCents(1234567)).toBe('$12,346');
    expect(formatCents(1234567, { cents: true })).toBe('$12,345.67');
    expect(formatCents(-5000)).toBe('-$50');
    expect(formatCents(null)).toBe('Hidden');
    expect(formatMarginBp(3150)).toBe('31.5%');
    expect(formatMarginBp(-1266)).toBe('-12.7%');
    expect(formatMarginBp(null)).toBe('No margin yet');
  });

  it('has a label and a tone for every status', () => {
    for (const status of PULSE_STATUSES) {
      expect(PULSE_STATUS_LABELS[status].length).toBeGreaterThan(0);
      expect(statusTone(status) === 'quiet').toBe(status === 'no_data');
    }
    expect(statusTone(null)).toBe('quiet');
  });
});

describe('date ranges', () => {
  const now = new Date('2026-11-18T15:00:00Z');
  it('last 30 days includes today', () => {
    expect(lastDays(30, now)).toEqual({ from: '2026-10-20', to: '2026-11-18' });
  });
  it('this month starts on the first', () => {
    expect(thisMonth(now)).toEqual({ from: '2026-11-01', to: '2026-11-18' });
  });
});
