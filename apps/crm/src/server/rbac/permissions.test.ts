import { describe, expect, it } from 'vitest';
import {
  canManageRole,
  hasPermission,
  parseRoles,
  permissionsFor,
  primaryRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from './permissions';

describe('rbac matrix', () => {
  it('grants owners every permission', () => {
    expect(ROLE_PERMISSIONS.owner.size).toBe(PERMISSIONS.length);
  });

  it('denies admins org deletion and billing only', () => {
    expect(hasPermission('admin', 'org:delete')).toBe(false);
    expect(hasPermission('admin', 'org:billing')).toBe(false);
    expect(hasPermission('admin', 'audit:read')).toBe(true);
    expect(hasPermission('admin', 'member:invite')).toBe(true);
  });

  it('lets members edit boards and items but not manage members', () => {
    expect(hasPermission('member', 'board:write')).toBe(true);
    expect(hasPermission('member', 'item:write')).toBe(true);
    expect(hasPermission('member', 'member:invite')).toBe(false);
    expect(hasPermission('member', 'audit:read')).toBe(false);
  });

  it('keeps viewers read-only apart from commenting', () => {
    expect(hasPermission('viewer', 'board:read')).toBe(true);
    expect(hasPermission('viewer', 'update:write')).toBe(true);
    expect(hasPermission('viewer', 'item:write')).toBe(false);
    expect(hasPermission('viewer', 'board:create')).toBe(false);
  });

  it('restricts guests to shared-board item work', () => {
    expect(hasPermission('guest', 'item:write')).toBe(true);
    expect(hasPermission('guest', 'workspace:read')).toBe(false);
    expect(hasPermission('guest', 'member:read')).toBe(false);
  });

  it('combines multiple roles', () => {
    expect(hasPermission(['viewer', 'member'], 'item:write')).toBe(true);
    expect(permissionsFor(['viewer', 'guest'])).toContain('item:write');
  });
});

describe('role parsing', () => {
  it('parses comma separated roles and drops unknown values', () => {
    expect(parseRoles('admin, member,superuser')).toEqual(['admin', 'member']);
    expect(parseRoles('')).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
  });

  it('picks the highest role', () => {
    expect(primaryRole(['viewer', 'admin', 'member'])).toBe('admin');
    expect(primaryRole([])).toBeUndefined();
  });

  it('only lets actors manage lower roles (owners manage all)', () => {
    expect(canManageRole('owner', 'owner')).toBe(true);
    expect(canManageRole('admin', 'member')).toBe(true);
    expect(canManageRole('admin', 'admin')).toBe(false);
    expect(canManageRole('member', 'viewer')).toBe(true);
    expect(canManageRole('guest', 'guest')).toBe(false);
  });
});
