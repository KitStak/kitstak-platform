import { describe, expect, test } from 'vitest';
import { EMAIL_NAME_MESSAGE, meterStrength, passwordWarning, usesEmailName } from './password-meter';
import { COMPANY_NAME_MESSAGE, EASY_TO_GUESS_MESSAGE, PRODUCT_NAME_MESSAGE, isRulesIssue, passwordIssue } from './password-rules';

const DANA = { email: 'dana@whitlock.example' };

describe('the password meter says only true things', () => {
  test('a few words that do not go together are good, with no warning', () => {
    expect(passwordWarning('correct horse battery staple', DANA)).toBeNull();
    expect(['Good', 'Strong']).toContain(meterStrength('correct horse battery staple', DANA).label);
  });

  test('a repeated word, a run of digits and a common password are never Good or Strong', () => {
    for (const password of ['passwordpassword', '123456789012345', 'qwertyuiopasdfgh', 'aaaaaaaaaaaaaaaa']) {
      expect(meterStrength(password).label, password).toBe('Too weak');
      expect(passwordWarning(password), password).toBe(EASY_TO_GUESS_MESSAGE);
    }
  });

  test('the email name is named while typing, long before the button', () => {
    expect(usesEmailName('danadanadanadana', DANA.email)).toBe(true);
    expect(passwordWarning('danadanadanadana', DANA)).toBe(EMAIL_NAME_MESSAGE);
    expect(meterStrength('danadanadanadana', DANA).label).toBe('Too weak');
    // Also while the checklist is still open: the warning does not wait for the other rules.
    expect(passwordWarning('dana12', DANA)).toBe(EMAIL_NAME_MESSAGE);
    // A name of fewer than 3 characters is not a name worth a warning.
    expect(usesEmailName('jo-is-not-a-problem-here', 'jo@x.example')).toBe(false);
    expect(usesEmailName('anything', undefined)).toBe(false);
  });

  test('the company name is named as the cause, not "too easy to guess" (review round 4)', () => {
    expect(COMPANY_NAME_MESSAGE).toBe('Do not use your company name in your password.');
    expect(passwordWarning('Whitlock-Supply-2026!', { company: 'Whitlock Supply' })).toBe(COMPANY_NAME_MESSAGE);
    // The three passwords from the review. Each is long, mixed, and a few words that do not go together.
    expect(passwordWarning('Harbor-Lantern-77-quiet!', { company: 'Harbor Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
    expect(passwordWarning('Harborline#2026!', { company: 'Harborline Freight' })).toBe(COMPANY_NAME_MESSAGE);
    expect(passwordWarning('Harbor!line2026x', { company: 'Harborline Freight' })).toBe(COMPANY_NAME_MESSAGE);
    for (const password of ['Harborline#2026!', 'Harbor!line2026x']) {
      expect(passwordIssue(password, { company: 'Harborline Freight' }), password).toBe(COMPANY_NAME_MESSAGE);
      expect(meterStrength(password, { company: 'Harborline Freight' }).label, password).toBe('Too weak');
    }
  });

  test('the company line shows as I type, and follows the company field', () => {
    // As soon as the name is in the password, long before the checklist is met.
    expect(passwordWarning('Harbor', { company: 'Harbor Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
    expect(passwordWarning('harb', { company: 'Harbor Supply Co' })).toBeNull();
    // The company is filled in after the password: the same password now gets the line.
    expect(passwordWarning('Harbor-Lantern-77-quiet!', { company: '' })).toBeNull();
    expect(passwordWarning('Harbor-Lantern-77-quiet!', {})).toBeNull();
    expect(passwordWarning('Harbor-Lantern-77-quiet!', { company: 'Harbor Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
    // The company is changed: the line goes away, and the password is good.
    expect(passwordWarning('Harbor-Lantern-77-quiet!', { company: 'Pine Ridge Outfitters' })).toBeNull();
    expect(passwordIssue('Harbor-Lantern-77-quiet!', { company: 'Pine Ridge Outfitters' })).toBeNull();
    // A name that is also a repeated word still gets the line that names the cause.
    expect(passwordWarning('harborharborharbor', { company: 'Harbor Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
    expect(passwordIssue('harborharborharbor', { company: 'Harbor Supply Co' })).toBe(COMPANY_NAME_MESSAGE);
  });

  test('the product name gets its own line too', () => {
    expect(passwordWarning('KitStak-Rocks-2026!')).toBe(PRODUCT_NAME_MESSAGE);
    expect(passwordIssue('KitStak-Rocks-2026!')).toBe(PRODUCT_NAME_MESSAGE);
    expect(PRODUCT_NAME_MESSAGE).toBe('Do not use the word KitStak in your password.');
  });

  test('whatever the form would refuse for a reason off the checklist, the meter calls too weak', () => {
    const who = { ...DANA, company: 'Whitlock Supply Co' };
    const samples = [
      'passwordpassword',
      'danadanadanadana',
      'correct horse battery staple',
      'Brave-Lantern-12',
      'P@ssw0rd2024!!',
      'sevenbluekitesfly',
      'dana-Secret-12!',
      'Whitlock-Lantern-77!',
      'whitlockwhitlockwhitlock',
      'KitStak-Rocks-2026!',
      'x'.repeat(80),
    ];
    for (const context of [DANA, who]) {
      for (const password of samples) {
        const issue = passwordIssue(password, context);
        if (issue !== null && !isRulesIssue(password)) {
          expect(meterStrength(password, context).label, password).toBe('Too weak');
          expect(passwordWarning(password, context), password).toBe(issue);
        }
        if (issue === null) expect(passwordWarning(password, context), password).toBeNull();
      }
    }
  });

  test('an empty field says nothing', () => {
    expect(passwordWarning('', DANA)).toBeNull();
    expect(meterStrength('', DANA)).toEqual({ score: 0, label: '' });
  });
});
