import { describe, expect, it } from 'vitest';
import { parseRoles } from '@/server/rbac/permissions';
import {
  auditCategoryPrefixes,
  csvCell,
  daysUntil,
  decodeMemberRole,
  describeAuditAction,
  emailDomainAllowed,
  encodeDeactivatedRole,
  invalidIpRules,
  ipAllowed,
  ipMatchesRule,
  mergeSettings,
  parseIp,
  parseUserAgent,
  purgeDate,
  readKitstakMetadata,
  toCsv,
  writeKitstakMetadata,
} from './admin-policy';
import { DEFAULT_ORG_SETTINGS, DEFAULT_PROFILE_PREFS, updateProfileSchema } from './admin-contracts';

describe('org metadata', () => {
  it('returns defaults for empty or malformed metadata', () => {
    expect(readKitstakMetadata(null).settings).toEqual(DEFAULT_ORG_SETTINGS);
    expect(readKitstakMetadata('not json').settings).toEqual(DEFAULT_ORG_SETTINGS);
    expect(readKitstakMetadata('[1,2]').profiles).toEqual({});
  });

  it('preserves foreign keys when writing the kitstak section', () => {
    const raw = JSON.stringify({ teamSize: '21-100', demo: true });
    const meta = readKitstakMetadata(raw);
    const next = writeKitstakMetadata(raw, {
      ...meta,
      settings: mergeSettings(meta.settings, { boardCreation: 'admins' }),
    });
    const parsed = JSON.parse(next) as Record<string, unknown>;
    expect(parsed.teamSize).toBe('21-100');
    expect(parsed.demo).toBe(true);
    expect(readKitstakMetadata(next).settings.boardCreation).toBe('admins');
  });

  it('repairs invalid stored values field by field', () => {
    const raw = JSON.stringify({
      kitstak: {
        settings: { boardCreation: 'nobody', ipAllowListEnabled: true },
        profiles: { u1: { theme: 'neon', timeFormat: '24h' } },
      },
    });
    const meta = readKitstakMetadata(raw);
    expect(meta.settings.boardCreation).toBe('members');
    expect(meta.settings.ipAllowListEnabled).toBe(true);
    expect(meta.profiles.u1?.theme).toBe('system');
    expect(meta.profiles.u1?.timeFormat).toBe('24h');
    expect(meta.profiles.u1?.locale).toBe(DEFAULT_PROFILE_PREFS.locale);
  });
});

describe('deactivated roles', () => {
  it('round-trips the previous role', () => {
    expect(decodeMemberRole(encodeDeactivatedRole('admin'))).toEqual({ role: 'admin', deactivated: true });
    expect(decodeMemberRole('member')).toEqual({ role: 'member', deactivated: false });
    expect(decodeMemberRole('member,admin')).toEqual({ role: 'admin', deactivated: false });
  });

  it('is rejected by the RBAC role parser (fails closed)', () => {
    expect(parseRoles(encodeDeactivatedRole('owner'))).toEqual([]);
  });

  it('falls back to member for a corrupted previous role', () => {
    expect(decodeMemberRole('deactivated:superuser')).toEqual({ role: 'member', deactivated: true });
  });
});

describe('IP allow-list', () => {
  it('parses IPv4, IPv6 and IPv4-mapped IPv6', () => {
    expect(parseIp('203.0.113.7')?.version).toBe(4);
    expect(parseIp('2001:db8::1')?.version).toBe(6);
    expect(parseIp('::ffff:203.0.113.7')).toEqual(parseIp('203.0.113.7'));
    expect(parseIp('999.1.1.1')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
  });

  it('matches single addresses and CIDR ranges', () => {
    expect(ipMatchesRule('203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(ipMatchesRule('203.0.114.7', '203.0.113.0/24')).toBe(false);
    expect(ipMatchesRule('10.1.2.3', '10.1.2.3')).toBe(true);
    expect(ipMatchesRule('2001:db8::abcd', '2001:db8::/32')).toBe(true);
    expect(ipMatchesRule('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipMatchesRule('10.0.0.1', '::/0')).toBe(false);
    expect(ipMatchesRule('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('denies unknown IPs and reports invalid rules', () => {
    expect(ipAllowed(null, ['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('1.2.3.4', [])).toBe(false);
    expect(invalidIpRules(['10.0.0.0/8', '10.0.0.0/33', 'abc', '::1/129'])).toEqual([
      '10.0.0.0/33',
      'abc',
      '::1/129',
    ]);
  });
});

describe('email domain policy', () => {
  it('allows everything when the list is empty', () => {
    expect(emailDomainAllowed('a@anything.io', [])).toBe(true);
  });

  it('allows exact domains and their subdomains only', () => {
    const domains = ['northwind.example'];
    expect(emailDomainAllowed('A@Northwind.Example', domains)).toBe(true);
    expect(emailDomainAllowed('a@eu.northwind.example', domains)).toBe(true);
    expect(emailDomainAllowed('a@evilnorthwind.example', domains)).toBe(false);
    expect(emailDomainAllowed('no-at-sign', domains)).toBe(false);
  });
});

describe('user agent parsing', () => {
  it('detects common browsers and platforms', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
    expect(parseUserAgent(chrome)).toEqual({ browser: 'Chrome 158', os: 'Windows', kind: 'desktop' });
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(iphone)).toEqual({ browser: 'Safari 18', os: 'iOS', kind: 'mobile' });
    expect(parseUserAgent('Playwright/1.65.0 (x64; windows 10.0) node/24.15').kind).toBe('bot');
    expect(parseUserAgent(null).kind).toBe('unknown');
  });
});

describe('CSV', () => {
  it('quotes delimiters and neutralizes formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('emits a BOM, header row and CRLF lines', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });
});

describe('retention + audit helpers', () => {
  it('computes purge dates and remaining days', () => {
    const deleted = new Date('2026-01-01T00:00:00Z');
    const purge = purgeDate(deleted, 30);
    expect(purge.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(daysUntil(purge, new Date('2026-01-30T12:00:00Z'))).toBe(1);
    expect(daysUntil(purge, new Date('2026-02-05T00:00:00Z'))).toBe(0);
  });

  it('maps categories to action prefixes and describes actions', () => {
    expect(auditCategoryPrefixes('member')).toEqual(['member.']);
    expect(auditCategoryPrefixes('security')).toContain('auth.forbidden');
    expect(describeAuditAction('member.role_changed')).toBe('Changed a role');
    expect(describeAuditAction('widget.moved_around')).toBe('Moved around');
    expect(describeAuditAction('crm.lead_converted')).toBe('Lead converted to deal');
  });
});

describe('profile input', () => {
  it('validates phone numbers and asset-only image urls', () => {
    expect(updateProfileSchema.safeParse({ phone: '+1 (555) 010-2000' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ phone: 'call me' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ image: 'https://evil.example/x.png' }).success).toBe(false);
    expect(
      updateProfileSchema.safeParse({ image: '/api/v1/assets/0f8fad5b-d9cb-469f-a165-70867728950e.png' }).success,
    ).toBe(true);
    expect(updateProfileSchema.safeParse({ unknownKey: 1 }).success).toBe(false);
  });
});
