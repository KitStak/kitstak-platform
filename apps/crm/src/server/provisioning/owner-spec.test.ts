import { describe, expect, test } from 'vitest';
import { onboardingRows, parseOwnerSpec, passwordProblems } from './owner-spec';

const BASE = ['--email', 'Dana.Reyes@Example.com', '--name', 'Dana Reyes', '--org', 'Northwind Supply', '--slug', 'northwind', '--modules', 'crm'];

describe('parseOwnerSpec', () => {
  test('accepts a complete spec and lowercases the email', () => {
    const result = parseOwnerSpec(BASE);

    expect(result).toEqual({
      ok: true,
      spec: {
        email: 'dana.reyes@example.com',
        name: 'Dana Reyes',
        orgName: 'Northwind Supply',
        orgSlug: 'northwind',
        modules: ['crm'],
        skipOnboarding: true,
        requirePasswordChange: true,
        dryRun: false,
        assumeYes: false,
      },
    });
  });

  test('reads the opt-out switches', () => {
    const result = parseOwnerSpec([...BASE, '--keep-onboarding', '--no-password-change', '--dry-run']);

    expect(result.ok && result.spec).toMatchObject({ skipOnboarding: false, requirePasswordChange: false, dryRun: true });
  });

  test('accepts several modules without repeats', () => {
    const result = parseOwnerSpec([...BASE.slice(0, -1), 'crm,wms,crm', '--no-password-change']);

    expect(result.ok && result.spec.modules).toEqual(['crm', 'wms']);
  });

  test('refuses the WMS while a password change is required, because the WMS does not enforce it', () => {
    const result = parseOwnerSpec([...BASE.slice(0, -1), 'crm,wms']);

    expect(!result.ok && result.errors.join(' ')).toContain('cannot be combined with a required password change');
  });

  test('reads --yes', () => {
    const result = parseOwnerSpec([...BASE, '--yes']);

    expect(result.ok && result.spec.assumeYes).toBe(true);
  });

  test('reports every missing field', () => {
    const result = parseOwnerSpec([]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(5);
  });

  test('rejects an unknown module, a bad slug and a bad email', () => {
    const result = parseOwnerSpec(['--email', 'nope', '--name', 'A', '--org', 'B', '--slug', 'Bad Slug', '--modules', 'erp']);

    const errors = result.ok ? [] : result.errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        '--email must be a valid email address.',
        '--slug must be lowercase letters, digits and hyphens (e.g. midland).',
        "Unknown module 'erp'.",
      ]),
    );
  });

  test('rejects unknown flags and a flag with no value', () => {
    const result = parseOwnerSpec([...BASE, '--password', 'x', '--org']);

    expect(!result.ok && result.errors).toEqual(
      expect.arrayContaining(["Unknown argument '--password'.", "Unknown argument 'x'.", '--org needs a value.']),
    );
  });
});

describe('passwordProblems', () => {
  const who = { email: 'dana.reyes@example.com', name: 'Dana Reyes' };

  test('accepts a password that meets the sign-up policy', () => {
    expect(passwordProblems('Harbor-Pine-42!', who)).toEqual([]);
  });

  test('rejects a short or simple password', () => {
    expect(passwordProblems('short', who).length).toBeGreaterThan(0);
    // 14 lowercase letters: long enough for the minimum, too short to count as a passphrase.
    expect(passwordProblems('alllowercasepw', who).length).toBeGreaterThan(0);
  });

  test('accepts a passphrase of 15 or more characters with no capital, number or symbol', () => {
    // The shared sign-up policy (`passphraseLength` in @kitstak/auth): length does the work.
    expect(passwordProblems('alllowercaseletters', who)).toEqual([]);
    expect(passwordProblems('correct horse battery staple', who)).toEqual([]);
  });
});

describe('onboardingRows', () => {
  test('closes the portal and CRM guides for a CRM-only org', () => {
    const rows = onboardingRows({ modules: ['crm'] });

    expect(rows.map((row) => `${row.scope}:${row.stepKey}:${row.status}`)).toEqual([
      'portal:profile:completed',
      'portal:guide:dismissed',
      'crm:guide:dismissed',
    ]);
    expect(rows[0]?.payload).toEqual({ focus: 'crm', businessType: 'other', teamSize: 'solo', startMode: 'fresh' });
  });

  test('sets the focus to both and closes the WMS guide when both modules are granted', () => {
    const rows = onboardingRows({ modules: ['crm', 'wms'] });

    expect(rows[0]?.payload.focus).toBe('both');
    expect(rows.map((row) => row.scope)).toContain('wms');
  });
});
