import { describe, expect, test } from 'vitest';
import { EMAIL_NAME_MESSAGE, meterStrength, passwordWarning, usesEmailName } from './password-meter';
import { EASY_TO_GUESS_MESSAGE, isRulesIssue, passwordIssue } from './password-rules';

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

  test('the company name counts as easy to guess', () => {
    expect(passwordWarning('Whitlock-Supply-2026!', { company: 'Whitlock Supply' })).toBe(EASY_TO_GUESS_MESSAGE);
  });

  test('whatever the form would refuse for a reason off the checklist, the meter calls too weak', () => {
    const samples = ['passwordpassword', 'danadanadanadana', 'correct horse battery staple', 'Brave-Lantern-12', 'P@ssw0rd2024!!', 'sevenbluekitesfly', 'dana-Secret-12!', 'x'.repeat(80)];
    for (const password of samples) {
      const issue = passwordIssue(password, DANA);
      if (issue !== null && !isRulesIssue(password)) {
        expect(meterStrength(password, DANA).label, password).toBe('Too weak');
        expect(passwordWarning(password, DANA), password).toBe(issue);
      }
      if (issue === null) expect(passwordWarning(password, DANA), password).toBeNull();
    }
  });

  test('an empty field says nothing', () => {
    expect(passwordWarning('', DANA)).toBeNull();
    expect(meterStrength('', DANA)).toEqual({ score: 0, label: '' });
  });
});
