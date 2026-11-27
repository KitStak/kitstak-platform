import { describe, expect, test } from 'vitest';
import { resolveSignupStep, stepHref, type SignupFacts } from './resume';

/** A person in the middle of signup: account, organization, open intent, nothing else yet. */
const base: SignupFacts = {
  signedIn: true,
  hasOrg: true,
  canStartTrial: true,
  isManager: true,
  planUntouched: true,
  hasOpenIntent: true,
  emailVerified: false,
  verifySkipped: false,
  profileSaved: false,
};

describe('resolveSignupStep (SPEC 5.6)', () => {
  test('signed out goes to signup', () => {
    expect(resolveSignupStep({ ...base, signedIn: false })).toBe('/signup');
  });

  test('signed in with no organization goes to the company step', () => {
    expect(resolveSignupStep({ ...base, hasOrg: false })).toBe('/signup/company');
    // Also with no open intent: an account from Google or Microsoft starts here.
    expect(resolveSignupStep({ ...base, hasOrg: false, hasOpenIntent: false })).toBe('/signup/company');
  });

  test('an organization with no trial and no plan goes to the picker', () => {
    expect(resolveSignupStep(base)).toBe('/signup/plan');
  });

  test('a member who cannot start a trial is never sent to the picker', () => {
    expect(resolveSignupStep({ ...base, canStartTrial: false, isManager: false })).toBe('/');
  });

  test('trial started and email not verified goes to verification, once', () => {
    const started = { ...base, planUntouched: false };
    expect(resolveSignupStep(started)).toBe('/verify-email');
    expect(resolveSignupStep({ ...started, verifySkipped: true })).toBe('/welcome');
    expect(resolveSignupStep({ ...started, emailVerified: true })).toBe('/welcome');
  });

  test('the welcome wizard is for owners and admins who have not answered yet', () => {
    const verified = { ...base, planUntouched: false, emailVerified: true };
    expect(resolveSignupStep(verified)).toBe('/welcome');
    expect(resolveSignupStep({ ...verified, profileSaved: true })).toBe('/');
    expect(resolveSignupStep({ ...verified, isManager: false })).toBe('/');
  });

  test('with no open signup a person is simply home, whatever else is true', () => {
    for (const planUntouched of [true, false]) {
      for (const emailVerified of [true, false]) {
        for (const profileSaved of [true, false]) {
          expect(resolveSignupStep({ ...base, hasOpenIntent: false, planUntouched, emailVerified, profileSaved })).toBe('/');
        }
      }
    }
  });
});

describe('stepHref', () => {
  test('verification knows where to go next', () => {
    expect(stepHref('/verify-email')).toBe('/verify-email?next=/welcome');
    expect(stepHref('/signup/plan')).toBe('/signup/plan');
    expect(stepHref('/')).toBe('/');
  });
});
