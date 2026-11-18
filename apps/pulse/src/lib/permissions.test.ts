import { describe, expect, it } from 'vitest';
import {
  PULSE_ACTION_MIN,
  canImportStream,
  canPulse,
  canSeeMoney,
  canSeeWages,
  parseOrgRole,
  pulseRoleFromOrgRole,
  type PulseAction,
} from './permissions';

describe('permissions', () => {
  it('parses Better Auth role strings', () => {
    expect(parseOrgRole('admin,member')).toBe('admin');
    expect(parseOrgRole('deactivated:member')).toBeNull();
    expect(parseOrgRole('superuser')).toBeNull();
    expect(parseOrgRole(null)).toBeNull();
  });

  it('follows the action table', () => {
    expect(canPulse('viewer', 'pulse:read')).toBe(true);
    expect(canPulse('viewer', 'export:run')).toBe(true);
    expect(canPulse('viewer', 'production:log')).toBe(false);
    expect(canPulse('supervisor', 'production:log')).toBe(true);
    expect(canPulse('supervisor', 'material:log')).toBe(true);
    expect(canPulse('supervisor', 'job:manage')).toBe(false);
    expect(canPulse('manager', 'job:manage')).toBe(true);
    expect(canPulse('manager', 'rate:manage')).toBe(false);
    expect(canPulse('admin', 'period:close')).toBe(true);
    expect(canPulse('admin', 'period:reopen')).toBe(false);
    expect(canPulse('owner', 'data:purge')).toBe(true);
  });

  it('gives nothing to people with no Pulse role', () => {
    for (const action of Object.keys(PULSE_ACTION_MIN) as PulseAction[]) {
      expect(canPulse('none', action)).toBe(false);
      expect(canPulse(null, action)).toBe(false);
    }
  });

  it('lets supervisors import only the floor streams', () => {
    expect(canImportStream('supervisor', 'production')).toBe(true);
    expect(canImportStream('supervisor', 'materials')).toBe(true);
    expect(canImportStream('supervisor', 'labor_rates')).toBe(false);
    expect(canImportStream('manager', 'labor_rates')).toBe(true);
    expect(canImportStream('viewer', 'production')).toBe(false);
  });

  it('hides money unless the role or the switch allows it', () => {
    expect(canSeeMoney('manager')).toBe(true);
    expect(canSeeMoney('supervisor')).toBe(false);
    expect(canSeeMoney('supervisor', true)).toBe(true);
    expect(canSeeMoney('viewer', true)).toBe(true);
    expect(canSeeMoney('none', true)).toBe(false);
  });

  it('keeps wages to people who manage rates', () => {
    expect(canSeeWages('manager')).toBe(false);
    expect(canSeeWages('admin')).toBe(true);
  });

  it('maps org roles to a starting Pulse role', () => {
    expect(pulseRoleFromOrgRole('owner')).toBe('owner');
    expect(pulseRoleFromOrgRole('admin')).toBe('admin');
    expect(pulseRoleFromOrgRole('member')).toBe('none');
    expect(pulseRoleFromOrgRole('member', 'viewer')).toBe('viewer');
    expect(pulseRoleFromOrgRole('viewer')).toBe('none');
    expect(pulseRoleFromOrgRole('guest')).toBe('none');
  });
});
