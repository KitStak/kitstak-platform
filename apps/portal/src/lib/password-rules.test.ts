import { describe, expect, test } from 'vitest';
import { isUnchangedPassword } from '@kitstak/auth/password-policy';

describe('isUnchangedPassword', () => {
  test('is true when the new password equals the current one', () => {
    expect(isUnchangedPassword('Same-Password-1', 'Same-Password-1')).toBe(true);
  });

  test('is false when they differ, including by case', () => {
    expect(isUnchangedPassword('Old-Password-1', 'New-Password-2')).toBe(false);
    expect(isUnchangedPassword('Password-1x', 'password-1x')).toBe(false);
  });

  test('treats composed and decomposed forms of the same characters as unchanged', () => {
    expect(isUnchangedPassword('Caf\u00e9-Password-1', 'Cafe\u0301-Password-1')).toBe(true);
  });

  test('is false when either value is missing or not a string', () => {
    expect(isUnchangedPassword(undefined, 'New-Password-2')).toBe(false);
    expect(isUnchangedPassword('Old-Password-1', undefined)).toBe(false);
    expect(isUnchangedPassword(undefined, undefined)).toBe(false);
  });
});
