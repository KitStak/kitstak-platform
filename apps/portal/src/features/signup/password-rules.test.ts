import { describe, expect, test } from 'vitest';
import { DEFAULT_PASSWORD_POLICY, mergePasswordPolicy, validatePassword } from '@kitstak/auth/password-policy';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isEasyToGuess,
  isRulesIssue,
  missingRuleWords,
  passwordIssue,
  passwordRules,
  passwordStrength,
} from './password-rules';

const SAMPLES = [
  '',
  'correct horse battery staple',
  'correcthorsebatterystaple',
  'abcdefghijklmn',
  'abcdefghijklmno',
  'sevenbluekitesfly',
  'passwordpassword',
  'Brave-Lantern-12',
  'maya is my name ok',
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
  `Bx7!${'é'.repeat(34)}`,
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

  test('uses plain length messages', () => {
    expect(passwordIssue('Aa1!')).toBe('Your password still needs 10 or more characters.');
    expect(passwordIssue(`Aa1!${'x'.repeat(80)}`)).toBe('Use 72 characters or fewer.');
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
  });

  test('names every missing rule at once, in one plain sentence', () => {
    expect(passwordIssue('')).toBe('Enter a password.');
    // Once the length is fine, the easy way is named too: make it longer and nothing else is needed.
    const OR = ' Or make it 15 characters or longer.';
    expect(passwordIssue('alllowercase1!')).toBe(`Your password still needs a capital letter.${OR}`);
    expect(passwordIssue('ALLUPPERCASE1!')).toBe(`Your password still needs a small letter.${OR}`);
    expect(passwordIssue('NoNumberHere!')).toBe(`Your password still needs a number.${OR}`);
    expect(passwordIssue('NoSymbol12345')).toBe(`Your password still needs a symbol, like ! or #.${OR}`);
    expect(passwordIssue('abcdefghijklmn')).toBe(`Your password still needs a capital letter, a number and a symbol, like ! or #.${OR}`);
    // A long passphrase is a good password. No capital, number or symbol is asked for (review round 2).
    expect(passwordIssue('correct horse battery staple')).toBeNull();
    expect(passwordIssue('correcthorsebatterystaple')).toBeNull();
    expect(passwordIssue('sevenbluekitesfly')).toBeNull();
    // Length alone is not enough for a password a guessing program tries first (review round 3).
    expect(passwordIssue('abcdefghijklmno')).toBe('That one is too easy to guess. Try a few words that do not go together.');
    expect(passwordIssue('abc')).toBe('Your password still needs 10 or more characters, a capital letter, a number and a symbol, like ! or #.');
    expect(passwordIssue('1234')).toBe('Your password still needs 10 or more characters, a capital and a small letter and a symbol, like ! or #.');
    expect(passwordIssue('Maya-Secret-12!', { email: 'maya@northwind.example' })).toBe(
      'Do not use your email name in your password.',
    );
    expect(passwordIssue('Brave-Lantern-1')).toBeNull();
  });

  test('the missing words match the checklist: a rule is named exactly when its tick is off', () => {
    for (const sample of SAMPLES) {
      const unmet = passwordRules(sample).filter((rule) => !rule.met).length;
      expect({ sample, missing: missingRuleWords(sample).length }).toEqual({ sample, missing: unmet });
      if (sample !== '' && sample.length <= PASSWORD_MAX_LENGTH) expect(isRulesIssue(sample)).toBe(unmet > 0);
    }
    expect(isRulesIssue('')).toBe(false);
  });

  test('counts bytes, so a long password with accents is caught before the server refuses it', () => {
    expect(passwordIssue(`Bx7!${'é'.repeat(34)}`)).toBeNull();
    expect(passwordIssue(`Aa1!${'é'.repeat(35)}`)).toBe('Use 72 characters or fewer.');
  });
});

describe('passwordRules', () => {
  test('lists four rules and ticks each one as it is met', () => {
    expect(passwordRules('').map((rule) => rule.met)).toEqual([false, false, false, false]);
    expect(passwordRules('abcdefghij').map((rule) => rule.met)).toEqual([true, false, false, false]);
    expect(passwordRules('Abcdefghi1').map((rule) => rule.met)).toEqual([true, true, true, false]);
    expect(passwordRules('Good-Password-1').every((rule) => rule.met)).toBe(true);
    // 15 characters or more: every tick is on, whatever the password is made of.
    expect(passwordRules('correct horse battery staple').every((rule) => rule.met)).toBe(true);
    expect(passwordRules('abcdefghijklmn').map((rule) => rule.met)).toEqual([true, false, false, false]);
  });

  test('a password that meets every rule passes the full check', () => {
    for (const sample of SAMPLES) {
      if (sample.length > PASSWORD_MAX_LENGTH) continue;
      if (new TextEncoder().encode(sample).length > PASSWORD_MAX_LENGTH) continue;
      const allMet = passwordRules(sample).every((rule) => rule.met);
      // Every tick on, and not a password that is easy to guess (review round 3).
      expect({ sample, ok: passwordIssue(sample) === null }).toEqual({ sample, ok: allMet && !isEasyToGuess(sample) });
    }
  });
});

describe('passwordStrength', () => {
  test('never calls a password good before it meets every rule', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('abcdefghijklmn').score).toBeLessThan(3);
    expect(passwordStrength('Brave-Lamp-1').label).toBe('Good');
    expect(passwordStrength('Brave-Lantern-12').label).toBe('Strong');
    // Length alone is enough from 15 characters on, and reads "Strong" from 20.
    expect(passwordStrength('sevenbluekitesfly').label).toBe('Good');
    // But never for a straight run, a repeat or a common password.
    expect(passwordStrength('abcdefghijklmnop').label).toBe('Too weak');
    expect(passwordStrength('Good-Password-12').label).toBe('Too weak');
    expect(passwordStrength('correct horse battery staple').label).toBe('Strong');
  });
});

describe('the shared policy: 15 characters or more needs nothing else', () => {
  test('the server accepts a long passphrase and still refuses a short one without the three kinds', () => {
    expect(validatePassword('correct horse battery staple', DEFAULT_PASSWORD_POLICY)).toEqual([]);
    expect(validatePassword('sevenbluekitesfly', DEFAULT_PASSWORD_POLICY)).toEqual([]);
    expect(validatePassword('abcdefghijklmno', DEFAULT_PASSWORD_POLICY)).toEqual(['That one is too easy to guess. Try a few words that do not go together.']);
    expect(validatePassword('abcdefghijklmn', DEFAULT_PASSWORD_POLICY)).toEqual(['Include an uppercase letter.', 'Include a number.', 'Include a symbol.']);
    // The two rules that are not about kinds of characters stay for every length.
    expect(validatePassword('x'.repeat(80), DEFAULT_PASSWORD_POLICY)).toEqual(['Use at most 72 bytes.']);
    expect(validatePassword('maya likes long walks', DEFAULT_PASSWORD_POLICY, { email: 'maya@northwind.example' })).toEqual(['Do not include your email name.']);
  });

  test('a company that set its own character rules keeps them for every length', () => {
    const company = mergePasswordPolicy({ minLength: 12, requireUpper: true, requireNumber: true, requireSymbol: false });
    expect(company.passphraseLength).toBeUndefined();
    expect(validatePassword('correct horse battery staple', company)).toEqual(['Include an uppercase letter.', 'Include a number.']);
    // Unless it names a passphrase length itself.
    const both = mergePasswordPolicy({ requireUpper: true, passphraseLength: 20 });
    expect(validatePassword('correct horse battery staple', both)).toEqual([]);
    expect(validatePassword('correct horse bat', both)).not.toEqual([]);
    // A loader that only changes the lockout keeps the default passphrase rule.
    expect(mergePasswordPolicy({ lockoutThreshold: 3 }).passphraseLength).toBe(15);
  });
});
