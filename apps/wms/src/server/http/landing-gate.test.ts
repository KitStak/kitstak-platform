import { describe, expect, it } from 'vitest';
import { isLandingGated, landingDecision } from './landing-gate';

describe('landingDecision', () => {
  it('sends a person with no warehouse to the setup screen in one hop', () => {
    expect(landingDecision('/', { kind: 'no_warehouse', canSetUp: true, anyEntitled: true })).toBe('/setup-warehouse');
    expect(landingDecision('/dashboard', { kind: 'no_warehouse', canSetUp: true, anyEntitled: true })).toBe('/setup-warehouse');
    expect(landingDecision('/clients', { kind: 'no_warehouse', canSetUp: false, anyEntitled: true })).toBe('/setup-warehouse');
    expect(landingDecision('/setup-warehouse', { kind: 'no_warehouse', canSetUp: true, anyEntitled: true })).toBeNull();
  });

  it('sends an organization without the WMS in its plan to the lock screen', () => {
    expect(landingDecision('/', { kind: 'no_warehouse', canSetUp: false, anyEntitled: false })).toBe('/locked');
    expect(landingDecision('/setup-warehouse', { kind: 'no_warehouse', canSetUp: false, anyEntitled: false })).toBe('/locked');
    expect(landingDecision('/dashboard', { kind: 'open', locked: true })).toBe('/locked');
  });

  it('opens the dashboard from the root and leaves every other page alone', () => {
    expect(landingDecision('/', { kind: 'open', locked: false })).toBe('/dashboard');
    expect(landingDecision('/dashboard', { kind: 'open', locked: false })).toBeNull();
    expect(landingDecision('/clients', { kind: 'open', locked: false })).toBeNull();
    expect(landingDecision('/setup-warehouse', { kind: 'open', locked: true })).toBeNull();
    expect(landingDecision('/dashboard', { kind: 'other' })).toBeNull();
  });

  it('never gates the lock screen itself', () => {
    expect(isLandingGated('/locked')).toBe(false);
    expect(isLandingGated('/dashboard')).toBe(true);
    expect(isLandingGated('/setup-warehouse')).toBe(true);
  });
});
