import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH as SERVER_MAX, PASSWORD_MIN_LENGTH as SERVER_MIN } from '@/server/auth/options';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, authErrorMessage, passwordStrength } from './form-parts';
import { onboardingSchema } from './onboarding';

describe('password limits', () => {
  it('match the server auth configuration', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SERVER_MIN);
    expect(PASSWORD_MAX_LENGTH).toBe(SERVER_MAX);
  });
});

describe('passwordStrength', () => {
  it('scores empty, weak and strong passwords', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('longerpassword').score).toBe(2);
    expect(passwordStrength('Longer-Passw0rd!').score).toBe(4);
  });
});

describe('authErrorMessage', () => {
  it('maps known codes and rate limits to friendly copy', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toMatch(/don’t match/);
    expect(authErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: 'Custom' })).toBe('Custom');
    expect(authErrorMessage(null)).toMatch(/Something went wrong/);
  });
});

describe('onboardingSchema', () => {
  it('trims and validates the organization name', () => {
    expect(onboardingSchema.parse({ organizationName: '  Acme  ' }).organizationName).toBe('Acme');
    expect(onboardingSchema.safeParse({ organizationName: 'A' }).success).toBe(false);
  });
});
