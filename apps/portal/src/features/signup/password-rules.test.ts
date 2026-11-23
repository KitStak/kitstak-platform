import { describe, expect, test } from 'vitest';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordIssue, passwordRules, passwordStrength } from './password-rules';

const SAMPLES = [
  '',
  'short',
  'alllowercase',
  'ALLUPPERCASE1!',
  'NoNumberHere!',
  'NoSymbol12345',
  'Good-Password-1',
  'Northwind-Demo-2026!',
  'maya-Secret-12!',
  'x'.repeat(80),
  `Aa1!${'x'.repeat(68)}`,
  `Aa1!${'x'.repeat(69)}`,
  'Passw0rd!ééé',
  `Aa1!${'é'.repeat(34)}`,
  `Aa1!${'é'.repeat(35)}`,
];

describe('passwordIssue', () => {
  test('agrees with the shared password policy on what is allowed', () => {
    for (const email of [undefined, 'maya@northwind.example']) {
      for (const sample of SAMPLES) {
        if (sample === '') continue;
        const shared = validatePassword(sample, DEFAULT_PASSWORD_POLICY, { email });
        const local = passwordIssue(sample, { email });
        expect({ sample, email, allowed: local === null }).toEqual({ sample, email, allowed: shared.length === 0 });
      }
    }
  });

  test('uses the exact length messages from the spec', () => {
    expect(passwordIssue('Aa1!')).toBe('Use at least 10 characters.');
    expect(passwordIssue(`Aa1!${'x'.repeat(80)}`)).toBe('Use 72 characters or fewer.');
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
  });

  test('names one problem at a time, in plain words', () => {
    expect(passwordIssue('')).toBe('Enter a password.');
    expect(passwordIssue('alllowercase1!')).toBe('Include a capital letter.');
    expect(passwordIssue('ALLUPPERCASE1!')).toBe('Include a small letter.');
    expect(passwordIssue('NoNumberHere!')).toBe('Include a number.');
    expect(passwordIssue('NoSymbol12345')).toBe('Include a symbol, like ! or #.');
    expect(passwordIssue('Maya-Secret-12!', { email: 'maya@northwind.example' })).toBe(
      'Do not use your email name in your password.',
    );
    expect(passwordIssue('Good-Password-1')).toBeNull();
  });

  test('counts bytes, so a long password with accents is caught before the server refuses it', () => {
    expect(passwordIssue(`Aa1!${'é'.repeat(34)}`)).toBeNull();
    expect(passwordIssue(`Aa1!${'é'.repeat(35)}`)).toBe('Use 72 characters or fewer.');
  });
});

describe('passwordRules', () => {
  test('lists four rules and ticks each one as it is met', () => {
    expect(passwordRules('').map((rule) => rule.met)).toEqual([false, false, false, false]);
    expect(passwordRules('abcdefghij').map((rule) => rule.met)).toEqual([true, false, false, false]);
    expect(passwordRules('Abcdefghi1').map((rule) => rule.met)).toEqual([true, true, true, false]);
    expect(passwordRules('Good-Password-1').every((rule) => rule.met)).toBe(true);
  });

  test('a password that meets every rule passes the full check', () => {
    for (const sample of SAMPLES) {
      if (sample.length > PASSWORD_MAX_LENGTH) continue;
      if (new TextEncoder().encode(sample).length > PASSWORD_MAX_LENGTH) continue;
      const allMet = passwordRules(sample).every((rule) => rule.met);
      expect({ sample, ok: passwordIssue(sample) === null }).toEqual({ sample, ok: allMet });
    }
  });
});

describe('passwordStrength', () => {
  test('never calls a password good before it meets every rule', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('abcdefghijklmnop').score).toBeLessThan(3);
    expect(passwordStrength('Good-Pass-1').label).toBe('Good');
    expect(passwordStrength('Good-Password-12').label).toBe('Strong');
  });
});
