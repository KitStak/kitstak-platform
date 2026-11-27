/**
 * Review round 3: the 15 character rule no longer lets through passwords every rival refuses.
 * Covers the pure check in `@kitstak/auth/weak-passwords`, the shared server policy that every
 * instance runs (`validatePassword`), and the portal form mirror, which must agree with the server.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { COMPANY_NAME_MESSAGE, EASY_TO_GUESS_MESSAGE, PRODUCT_NAME_MESSAGE, isEasyToGuess, weakPasswordMessage, weakPasswordReason } from '@kitstak/auth/weak-passwords';
import { passwordIssue, passwordStrength } from '@/features/signup/password-rules';

const serverIssues = (password: string, context: { email?: string; company?: string } = {}) =>
  validatePassword(password, DEFAULT_PASSWORD_POLICY, context);

describe('passwords that are easy to guess are refused at every length', () => {
  test('the one kind line', () => {
    expect(EASY_TO_GUESS_MESSAGE).toBe('That one is too easy to guess. Try a few words that do not go together.');
  });

  test('the four passwords from the review', () => {
    expect(weakPasswordReason('passwordpassword')).toBe('repeated');
    expect(weakPasswordReason('aaaaaaaaaaaaaaaa')).toBe('few_characters');
    expect(weakPasswordReason('123456789012345')).toBe('straight_run');
    expect(weakPasswordReason('qwertyuiopasdfgh')).toBe('straight_run');
    for (const password of ['passwordpassword', 'aaaaaaaaaaaaaaaa', '123456789012345', 'qwertyuiopasdfgh']) {
      expect(serverIssues(password), password).toEqual([EASY_TO_GUESS_MESSAGE]);
      expect(passwordIssue(password), password).toBe(EASY_TO_GUESS_MESSAGE);
      expect(passwordStrength(password)).toEqual({ score: 0, label: 'Too weak' });
    }
  });

  test('one character repeated, and almost one character', () => {
    expect(isEasyToGuess('zzzzzzzzzzzzzzzzzzzz')).toBe(true);
    expect(isEasyToGuess('1111111111111111')).toBe(true);
    expect(isEasyToGuess('aabbaabbaabbaabb')).toBe(true);
    expect(isEasyToGuess('abababababababababab')).toBe(true);
    expect(weakPasswordReason('aaaabbbbccccdddd')).toBe('few_characters');
  });

  test('a short word or piece repeated', () => {
    expect(weakPasswordReason('kittenkittenkitten')).toBe('repeated');
    expect(weakPasswordReason('abc123abc123abc123')).toBe('repeated');
    expect(weakPasswordReason('Horse-Horse-Horse-')).toBe('repeated');
    expect(weakPasswordReason('letmeinletmeinletmein')).toBe('repeated');
  });

  test('straight runs: digits, the alphabet and keyboard rows, forward and backward', () => {
    expect(weakPasswordReason('abcdefghijklmnop')).toBe('straight_run');
    expect(weakPasswordReason('zyxwvutsrqponmlk')).toBe('straight_run');
    expect(weakPasswordReason('9876543210987654')).toBe('straight_run');
    expect(weakPasswordReason('asdfghjklzxcvbnm')).toBe('straight_run');
    expect(weakPasswordReason('1qaz2wsx3edc4rfv')).toBe('straight_run');
    expect(weakPasswordReason('Qwerty-12345-Asdf')).toBe('straight_run');
    expect(weakPasswordReason('poiuytrewq0987654')).toBe('straight_run');
  });

  test('the most common passwords, alone or dressed up with digits, symbols and look alike characters', () => {
    expect(weakPasswordReason('Password123!')).toBe('common');
    expect(weakPasswordReason('P@ssw0rd2024!!')).toBe('common');
    expect(weakPasswordReason('iloveyou1234567')).toBe('common');
    expect(weakPasswordReason('Welcome2026!')).toBe('common');
    expect(weakPasswordReason('Summer2026!!')).toBe('common');
    expect(weakPasswordReason('DragonMaster99!')).toBe('common');
    expect(weakPasswordReason('letmein-letmein!')).toBe('common');
    expect(weakPasswordReason('Tr0ub4dor&3xyz!')).toBeNull();
    // The short rules alone let these through before: a capital, a number and a symbol on a common word.
    expect(serverIssues('Password123!')).toEqual([EASY_TO_GUESS_MESSAGE]);
    expect(passwordIssue('Password123!')).toBe(EASY_TO_GUESS_MESSAGE);
  });

  test('the product name and the person\'s own company name', () => {
    expect(weakPasswordReason('KitStak-Rocks-2026!')).toBe('company_name');
    expect(weakPasswordReason('k1tst4k is my tool!')).toBe('company_name');
    expect(weakPasswordReason('Whitlock-Supply-88!', { names: ['Whitlock Supply Co'] })).toBe('company_name');
    expect(weakPasswordReason('whitlocksupplyco2026', { names: ['Whitlock Supply Co'] })).toBe('company_name');
    expect(weakPasswordReason('Whitlock-Supply-88!')).toBeNull();
    // Review round 4: the line names the cause. The server and the form say the same words.
    expect(serverIssues('Whitlock-Supply-88!', { company: 'Whitlock Supply Co' })).toEqual([COMPANY_NAME_MESSAGE]);
    expect(passwordIssue('Whitlock-Supply-88!', { company: 'Whitlock Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
    expect(serverIssues('KitStak-Rocks-2026!')).toEqual([PRODUCT_NAME_MESSAGE]);
    expect(passwordIssue('KitStak-Rocks-2026!')).toBe(PRODUCT_NAME_MESSAGE);
    for (const [password, company] of [
      ['Harbor-Lantern-77-quiet!', 'Harbor Supply Co'],
      ['Harborline#2026!', 'Harborline Freight'],
      ['Harbor!line2026x', 'Harborline Freight'],
    ] as const) {
      expect(serverIssues(password, { company }), password).toEqual(['Do not use your company name in your password.']);
      expect(passwordIssue(password, { company }), password).toBe('Do not use your company name in your password.');
      expect(weakPasswordMessage(password, { names: [company] }), password).toBe(COMPANY_NAME_MESSAGE);
      // Without that company the same password is fine.
      expect(serverIssues(password), password).toEqual([]);
    }
    expect(weakPasswordMessage('passwordpassword')).toBe(EASY_TO_GUESS_MESSAGE);
    expect(weakPasswordMessage('correct horse battery staple')).toBeNull();
    // A short or everyday word in a company name is not the name.
    expect(weakPasswordReason('The-Purple-Cart-91!', { names: ['The Cart Co'] })).toBeNull();
  });
});

describe('good passwords still pass, and 15 or more characters is still enough by itself', () => {
  const good = [
    'correct horse battery staple',
    'correcthorsebatterystaple',
    'purple monkey dishwasher lamp',
    'ledger books are fun to read',
    'Correct-Horse-9-Battery',
    'Northwind-Demo-2026!',
    'my cat eats blue socks',
    'Tr0ub4dor&3xyz!',
    'river-stone-42-Lamp',
    'sunshine princess dragon tea',
    'Xk7#mPq2!vL9',
  ];
  test.each(good)('%s', (password) => {
    expect(weakPasswordReason(password)).toBeNull();
    expect(serverIssues(password)).toEqual([]);
    expect(passwordIssue(password)).toBeNull();
    expect(passwordStrength(password).score).toBeGreaterThanOrEqual(3);
  });

  test('a long password with no capital, number or symbol needs nothing else', () => {
    expect(serverIssues('correct horse battery staple')).toEqual([]);
    expect(serverIssues('fifteen letters x')).toEqual([]);
  });

  test('a missing rule is still named first, and the easy to guess line only when nothing else is wrong', () => {
    expect(serverIssues('password')).toEqual(['Use at least 10 characters.', 'Include an uppercase letter.', 'Include a number.', 'Include a symbol.']);
    expect(passwordIssue('qwerty')).toContain('Your password still needs');
    expect(serverIssues('maya-loves-long-walks', { email: 'maya@northwind.example' })).toEqual(['Do not include your email name.']);
  });

  test('the server and the form agree on every example', () => {
    const all = [...good, 'passwordpassword', 'aaaaaaaaaaaaaaaa', '123456789012345', 'qwertyuiopasdfgh', 'Password123!', 'KitStak-Rocks-2026!', 'abcabcabcabcabc'];
    for (const password of all) {
      expect(passwordIssue(password) === null, password).toBe(serverIssues(password).length === 0);
    }
  });
});
