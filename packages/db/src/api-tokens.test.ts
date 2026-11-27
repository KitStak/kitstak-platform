/**
 * Platform API token rules that need no database (docs/integration/AGENT_WRITE_API.md W1 to W3):
 * token shape, hashing, the bearer header, scopes and expiry.
 */
import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_MAX_DAYS,
  ApiTokenError,
  expiresAtFor,
  generateApiToken,
  hashApiToken,
  normalizeScopes,
  parseApiTokenBearer,
  scopeAllows,
  tokenDisplayPrefix,
  tokenNameIssue,
  tokenState,
} from './api-tokens';

describe('token values', () => {
  it('makes ks_pat_ tokens with 32 random bytes', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a).toMatch(/^ks_pat_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes to 64 hex characters and never returns the token', () => {
    const token = generateApiToken();
    const hash = hashApiToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(7, 20));
    expect(hashApiToken(token)).toBe(hash);
  });

  it('shows only the first characters', () => {
    const token = 'ks_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    expect(tokenDisplayPrefix(token)).toBe('ks_pat_abcd');
  });
});

describe('bearer header', () => {
  const token = generateApiToken();

  it('reads a platform token', () => {
    expect(parseApiTokenBearer(`Bearer ${token}`)).toBe(token);
    expect(parseApiTokenBearer(`bearer   ${token}  `)).toBe(token);
  });

  it('ignores CRM tokens, other schemes and junk', () => {
    expect(parseApiTokenBearer('Bearer ks_live_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')).toBeNull();
    expect(parseApiTokenBearer(`Basic ${token}`)).toBeNull();
    expect(parseApiTokenBearer(`Bearer ${token}x`)).toBeNull();
    expect(parseApiTokenBearer(`Bearer ${token} extra`)).toBeNull();
    expect(parseApiTokenBearer('')).toBeNull();
    expect(parseApiTokenBearer(null)).toBeNull();
  });
});

describe('scopes', () => {
  it('keeps known scopes once, in catalog order, and adds read under write', () => {
    expect(normalizeScopes(['pulse:write', 'crm:read', 'crm:read'])).toEqual(['crm:read', 'pulse:read', 'pulse:write']);
  });

  it('refuses unknown or empty scope lists', () => {
    expect(() => normalizeScopes([])).toThrow(ApiTokenError);
    expect(() => normalizeScopes(['wms:write'])).toThrow(ApiTokenError);
    expect(() => normalizeScopes(['crm:read', 'admin'])).toThrow(ApiTokenError);
  });

  it('lets write imply read, never the other way', () => {
    expect(scopeAllows(['projects:write'], 'projects', 'read')).toBe(true);
    expect(scopeAllows(['projects:write'], 'projects', 'write')).toBe(true);
    expect(scopeAllows(['projects:read'], 'projects', 'write')).toBe(false);
    expect(scopeAllows(['crm:write'], 'pulse', 'read')).toBe(false);
  });
});

describe('expiry and names', () => {
  const now = new Date('2026-11-27T12:00:00.000Z');

  it('counts whole days from now, up to 90', () => {
    expect(expiresAtFor(30, now).toISOString()).toBe('2026-12-27T12:00:00.000Z');
    expect(expiresAtFor(API_TOKEN_MAX_DAYS, now).toISOString()).toBe('2027-02-25T12:00:00.000Z');
  });

  it('refuses 0, fractions and more than 90 days', () => {
    for (const days of [0, -1, 1.5, 91, Number.NaN]) expect(() => expiresAtFor(days, now)).toThrow(ApiTokenError);
  });

  it('wants a name of 1 to 80 characters', () => {
    expect(tokenNameIssue('Claude migration')).toBeNull();
    expect(tokenNameIssue('   ')).toBe('Give the token a name.');
    expect(tokenNameIssue('x'.repeat(81))).toBe('Use 80 characters or fewer.');
  });

  it('says whether a token is active, expired or revoked', () => {
    const later = new Date('2026-12-01T00:00:00.000Z');
    expect(tokenState({ expiresAt: later, revokedAt: null }, now)).toBe('active');
    expect(tokenState({ expiresAt: new Date('2026-11-01T00:00:00.000Z'), revokedAt: null }, now)).toBe('expired');
    expect(tokenState({ expiresAt: later, revokedAt: new Date('2026-11-20T00:00:00.000Z') }, now)).toBe('revoked');
  });
});
