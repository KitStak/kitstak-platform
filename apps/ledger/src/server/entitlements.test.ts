/** The preview gate (docs/ledger/SPEC.md 3.1): full or locked, never view only. */
import { describe, expect, it } from 'vitest';
import { assertLedgerOpen, LOCKED_SENTENCE, orgLedgerAccess } from './entitlements';
import { isDomainError } from './errors';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as unknown as NodeJS.ProcessEnv;

describe('orgLedgerAccess', () => {
  it('lets every org in outside production unless the switch says false', () => {
    expect(orgLedgerAccess({ slug: 'northwind-robotics' }, env({ NODE_ENV: 'development' }))).toBe('full');
    expect(orgLedgerAccess({ slug: 'northwind-robotics' }, env({ NODE_ENV: 'development', ENTITLEMENTS_DEV_ALLOW_ALL: '0' }))).toBe('locked');
  });

  it('with enforcement on, lets in only the listed slugs (trimmed, any case)', () => {
    const enforced = env({ NODE_ENV: 'production', KITSTAK_PREVIEW_ORGS: ' KitStak , ledger-only,, ' });
    expect(orgLedgerAccess({ slug: 'kitstak' }, enforced)).toBe('full');
    expect(orgLedgerAccess({ slug: 'Ledger-Only' }, enforced)).toBe('full');
    expect(orgLedgerAccess({ slug: 'northwind-robotics' }, enforced)).toBe('locked');
    expect(orgLedgerAccess({ slug: null }, enforced)).toBe('locked');
  });

  it('lets every org in when ENTITLEMENTS_DEV_ALLOW_ALL is true, even in production', () => {
    expect(orgLedgerAccess({ slug: 'anyone' }, env({ NODE_ENV: 'production', ENTITLEMENTS_DEV_ALLOW_ALL: 'true' }))).toBe('full');
  });

  it('answers a locked org with 402 NOT_ENTITLED and the preview sentence', () => {
    const previous = { ...process.env };
    try {
      process.env.ENTITLEMENTS_DEV_ALLOW_ALL = '0';
      process.env.KITSTAK_PREVIEW_ORGS = 'kitstak';
      let caught: unknown;
      try {
        assertLedgerOpen({ slug: 'northwind-robotics' });
      } catch (error) {
        caught = error;
      }
      expect(isDomainError(caught) && caught.status).toBe(402);
      expect(isDomainError(caught) && caught.message).toBe(LOCKED_SENTENCE);
      expect(LOCKED_SENTENCE).toBe('Ledger is in early preview. Ask KitStak to add your workspace.');
      expect(() => assertLedgerOpen({ slug: 'kitstak' })).not.toThrow();
    } finally {
      process.env = previous;
    }
  });
});
