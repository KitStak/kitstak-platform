import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/server/rbac/permissions';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/server/auth/options';
import { PASSWORD_POLICY, type AdminUserDto, type TrashEntryDto } from '@/server/services/admin-contracts';
import {
  filterTrash,
  filterUsers,
  formatBytes,
  formatIp,
  meterTone,
  parseEmailList,
  passwordStrength,
  percent,
  pluralize,
  relativeTime,
  trashBoards,
} from './format';
import { ADMIN_SECTIONS, activeSection, adminHref, sectionsByGroup } from './nav';
import { PERMISSION_LABEL, permissionGroups } from './permission-labels';

const user = (overrides: Partial<AdminUserDto>): AdminUserDto => ({
  memberId: 'm',
  userId: 'u',
  name: 'Ana',
  email: 'ana@x.test',
  image: null,
  title: null,
  role: 'member',
  status: 'active',
  teamIds: [],
  joinedAt: '2026-01-01T00:00:00Z',
  lastActiveAt: null,
  ...overrides,
});

const entry = (overrides: Partial<TrashEntryDto>): TrashEntryDto => ({
  type: 'item',
  id: 'i',
  name: 'Item',
  boardId: 'b1',
  boardName: 'Deals',
  groupName: 'Q1',
  workspaceName: 'Sales',
  itemCount: null,
  deletedAt: '2026-01-01T00:00:00Z',
  deletedBy: null,
  purgeAt: '2026-01-31T00:00:00Z',
  canPurge: true,
  canRestore: true,
  ...overrides,
});

describe('relativeTime', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('formats past and future times', () => {
    expect(relativeTime(null, now)).toBe('Never');
    expect(relativeTime('bad', now)).toBe('None');
    expect(relativeTime('2026-11-05T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-05T11:15:00Z', now)).toBe('45 min ago');
    expect(relativeTime('2026-11-05T07:00:00Z', now)).toBe('5 hr ago');
    expect(relativeTime('2026-11-04T07:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-11-01T12:00:00Z', now)).toBe('4 days ago');
    expect(relativeTime('2026-11-05T12:30:00Z', now)).toBe('in 30 min');
    expect(relativeTime('2026-11-08T12:00:00Z', now)).toBe('in 3 days');
  });
});

describe('number helpers', () => {
  it('formats bytes, percentages and meter tones', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 ** 3)).toBe('50 GB');
    expect(percent(8, 50)).toBe(16);
    expect(percent(80, 0)).toBe(0);
    expect(percent(120, 100)).toBe(100);
    expect(meterTone(79)).toBe('primary');
    expect(meterTone(80)).toBe('warning');
    expect(meterTone(100)).toBe('danger');
    expect(pluralize(1, 'member')).toBe('1 member');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('shortens IPv6 addresses', () => {
    expect(formatIp('0000:0000:0000:0000:0000:0000:0000:0001')).toBe('::1');
    expect(formatIp('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::');
    expect(formatIp('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe('2001:db8::ff00:42:8329');
    expect(formatIp('203.0.113.1')).toBe('203.0.113.1');
    expect(formatIp(null)).toBe('None');
  });
});

describe('filters', () => {
  const people = [
    user({ memberId: '1', name: 'Ana Ortiz', role: 'admin' }),
    user({ memberId: '2', name: 'Ben Ray', email: 'ben@x.test', status: 'deactivated' }),
    user({ memberId: '3', name: 'Cy', title: 'Sales Engineer', role: 'viewer' }),
  ];
  it('filters users by text, role and status', () => {
    expect(filterUsers(people, { q: '', role: 'all', status: 'all' })).toHaveLength(3);
    expect(filterUsers(people, { q: 'engineer', role: 'all', status: 'all' }).map((u) => u.memberId)).toEqual(['3']);
    expect(filterUsers(people, { q: '', role: 'admin', status: 'all' }).map((u) => u.memberId)).toEqual(['1']);
    expect(filterUsers(people, { q: '', role: 'all', status: 'deactivated' }).map((u) => u.memberId)).toEqual(['2']);
    expect(filterUsers(people, { q: '', role: 'all', status: 'invited' })).toHaveLength(0);
  });

  it('parses pasted email lists', () => {
    expect(parseEmailList('A@x.io, b@y.io;b@y.io\nnope')).toEqual({ valid: ['a@x.io', 'b@y.io'], invalid: ['nope'] });
  });

  it('filters trash and lists its boards', () => {
    const rows = [
      entry({ id: '1', type: 'board', name: 'Old deals', boardId: 'b2', boardName: 'Old deals' }),
      entry({ id: '2', name: 'Acme renewal' }),
      entry({ id: '3', type: 'group', name: 'Q1', groupName: 'Q1' }),
    ];
    expect(filterTrash(rows, { q: 'acme', type: 'all', boardId: 'all' }).map((r) => r.id)).toEqual(['2']);
    expect(filterTrash(rows, { q: '', type: 'group', boardId: 'all' }).map((r) => r.id)).toEqual(['3']);
    expect(filterTrash(rows, { q: '', type: 'all', boardId: 'b2' }).map((r) => r.id)).toEqual(['1']);
    expect(trashBoards(rows)).toEqual([
      { id: 'b1', name: 'Deals' },
      { id: 'b2', name: 'Old deals' },
    ]);
  });
});

describe('password strength', () => {
  it('scores length and variety', () => {
    expect(passwordStrength('short').label).toBe('Too short');
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('Northwind-Demo-2026!').label).toBe('Strong');
  });

  it('mirrors the server password policy', () => {
    expect(PASSWORD_POLICY.minLength).toBe(PASSWORD_MIN_LENGTH);
    expect(PASSWORD_POLICY.maxLength).toBe(PASSWORD_MAX_LENGTH);
  });
});

describe('admin navigation', () => {
  it('resolves the active section from the pathname', () => {
    expect(activeSection('/acme/admin', 'acme').key).toBe('general');
    expect(activeSection('/acme/admin/audit-log', 'acme').key).toBe('audit');
    expect(activeSection('/acme/admin/members', 'acme').key).toBe('users');
    expect(activeSection('/acme/admin/unknown', 'acme').key).toBe('general');
    expect(adminHref('acme', '')).toBe('/acme/admin');
    expect(adminHref('acme', 'users')).toBe('/acme/admin/users');
  });

  it('groups sections in order and every section has a unique route', () => {
    expect(sectionsByGroup().map((group) => group.group)).toEqual(['Organization', 'Security', 'Account']);
    expect(new Set(ADMIN_SECTIONS.map((section) => section.segment)).size).toBe(ADMIN_SECTIONS.length);
  });
});

describe('permission labels', () => {
  it('labels every RBAC permission and groups all of them', () => {
    for (const permission of PERMISSIONS) expect(PERMISSION_LABEL[permission]).toBeTruthy();
    expect(permissionGroups().flatMap((group) => group.permissions)).toHaveLength(PERMISSIONS.length);
  });
});
