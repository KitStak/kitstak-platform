import { describe, expect, it } from 'vitest';
import { adminAuditQuerySchema, isCalendarDay } from './admin-contracts';
import { humanizeAuditDetails, metadataTouchesKitstak, redactOrgMetadata } from './admin-policy';
import {
  effectiveTokenPermissions,
  parseBearerToken,
  scopesAllow,
  shouldTouchLastUsed,
  TOKEN_LAST_USED_THROTTLE_MS,
} from './admin-token-scopes';

describe('organization metadata redaction', () => {
  it('removes the kitstak section from string and object metadata, deeply', () => {
    const payload = {
      id: 'o1',
      metadata: JSON.stringify({ brand: 'blue', kitstak: { settings: { ipAllowList: ['1.2.3.4'] } } }),
      members: [{ organization: { metadata: { kitstak: { profiles: {} }, other: 1 } } }],
    };
    const redacted = redactOrgMetadata(payload);
    expect(JSON.parse(redacted.metadata)).toEqual({ brand: 'blue' });
    expect(redacted.members[0]?.organization.metadata).toEqual({ other: 1 });
    expect(JSON.stringify(redacted)).not.toContain('ipAllowList');
    // Original is untouched (immutable copy).
    expect(payload.metadata).toContain('kitstak');
  });

  it('detects writes that touch the reserved key', () => {
    expect(metadataTouchesKitstak({ kitstak: {} })).toBe(true);
    expect(metadataTouchesKitstak('{"kitstak":1}')).toBe(true);
    expect(metadataTouchesKitstak({ brand: 'x' })).toBe(false);
    expect(metadataTouchesKitstak(undefined)).toBe(false);
  });
});

describe('API token scopes', () => {
  it('parses only well-formed KitStak bearer tokens', () => {
    expect(parseBearerToken('Bearer ks_live_abcdefghijklmnopqrstuvwxyz012345')).toBe(
      'ks_live_abcdefghijklmnopqrstuvwxyz012345',
    );
    expect(parseBearerToken('Bearer sk_other_123')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
  });

  it('maps scopes to permissions and intersects with the role', () => {
    expect(scopesAllow(['boards:read'], 'board:read')).toBe(true);
    expect(scopesAllow(['boards:read'], 'item:write')).toBe(false);
    expect(scopesAllow(['audit:read'], 'org:update')).toBe(false);
    expect(effectiveTokenPermissions(['board:read', 'item:write', 'org:update'], ['boards:read'])).toEqual(['board:read']);
  });

  it('throttles last-used writes to once a minute', () => {
    const now = Date.now();
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(new Date(now - 1000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now - TOKEN_LAST_USED_THROTTLE_MS), now)).toBe(true);
  });
});

describe('audit query validation', () => {
  it('rejects impossible calendar days and inverted ranges', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(isCalendarDay('2026-13-45')).toBe(false);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ from: '2026-13-45' }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ from: '2026-05-02', to: '2026-05-01' }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ tz: 'Mars/Olympus' }).success).toBe(false);
    const ok = adminAuditQuerySchema.parse({ from: '2026-05-01', to: '2026-05-01', tz: 'America/Chicago' });
    expect(ok.order).toBe('desc');
  });

  it('humanises metadata and hides payload blobs', () => {
    const rows = humanizeAuditDetails({ durationMs: 109, ok: false, requestBody: '{"a":1}', attempt: 2 });
    expect(rows.map((row) => row.key)).toEqual(['durationMs', 'ok', 'attempt']);
    expect(rows.find((row) => row.key === 'durationMs')?.value).toBe('109 ms');
    expect(rows.find((row) => row.key === 'ok')).toMatchObject({ label: 'Succeeded', value: 'No' });
  });
});
