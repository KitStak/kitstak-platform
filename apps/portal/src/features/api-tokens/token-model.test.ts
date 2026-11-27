import { describe, expect, it } from 'vitest';
import { describeScopes, isTokenManager, scopesFor, tokenDate } from './token-model';

describe('API token screen model', () => {
  it('builds scopes in catalog order, with read under change', () => {
    expect(scopesFor(['pulse', 'crm'], 'read')).toEqual(['crm:read', 'pulse:read']);
    expect(scopesFor(['projects'], 'write')).toEqual(['projects:read', 'projects:write']);
    expect(scopesFor([], 'write')).toEqual([]);
  });

  it('describes scopes in plain words', () => {
    expect(describeScopes(['crm:read', 'crm:write', 'pulse:read'])).toBe('CRM: read and change · Pulse: read');
    expect(describeScopes([])).toBe('');
  });

  it('treats owners and admins as managers, from comma role lists too', () => {
    expect(isTokenManager('owner')).toBe(true);
    expect(isTokenManager('member, admin')).toBe(true);
    expect(isTokenManager('member')).toBe(false);
    expect(isTokenManager('deactivated:admin')).toBe(false);
  });

  it('formats dates and falls back for none', () => {
    expect(tokenDate('2026-12-27T12:00:00.000Z')).toBe('Dec 27, 2026');
    expect(tokenDate(null)).toBe('Never');
    expect(tokenDate('nope', 'Unknown')).toBe('Unknown');
  });
});
