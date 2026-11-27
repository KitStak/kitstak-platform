import { describe, expect, it } from 'vitest';
import { MONEY_READ_CASES } from '@kitstak/db/programs';
import { canOrg, canProject, canReadMoney, canSeeSync, effectiveProjectRole, parseOrgRole, projectCapabilities } from './permissions';

describe('permissions', () => {
  it('parses Better Auth role strings', () => {
    expect(parseOrgRole('admin,member')).toBe('admin');
    expect(parseOrgRole('deactivated:member')).toBeNull();
    expect(parseOrgRole('superuser')).toBeNull();
    expect(parseOrgRole(null)).toBeNull();
  });

  it('gives org admins owner rights everywhere', () => {
    expect(effectiveProjectRole({ orgRole: 'admin', memberRole: null, visibility: 'private' })).toBe('owner');
  });

  it('derives implicit roles on org-visible projects', () => {
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: null, visibility: 'org' })).toBe('editor');
    expect(effectiveProjectRole({ orgRole: 'viewer', memberRole: null, visibility: 'org' })).toBe('commenter');
    expect(effectiveProjectRole({ orgRole: 'guest', memberRole: null, visibility: 'org' })).toBeNull();
  });

  it('keeps private projects to explicit members and owners', () => {
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: null, visibility: 'private' })).toBeNull();
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: 'viewer', visibility: 'private' })).toBe('viewer');
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: null, visibility: 'private', isProjectOwner: true })).toBe('owner');
  });

  it('uses the higher of explicit and implicit roles', () => {
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: 'viewer', visibility: 'org' })).toBe('editor');
    expect(effectiveProjectRole({ orgRole: 'viewer', memberRole: 'editor', visibility: 'org' })).toBe('editor');
  });

  it('maps roles to actions', () => {
    expect(canProject('viewer', 'comment:create')).toBe(false);
    expect(canProject('commenter', 'comment:create')).toBe(true);
    expect(canProject('editor', 'task:update')).toBe(true);
    expect(canProject('editor', 'project:delete')).toBe(false);
    expect(canProject(null, 'project:read')).toBe(false);
    expect(projectCapabilities('owner')['project:manage_members']).toBe(true);
    expect(canOrg('member', 'project:create')).toBe(true);
    expect(canOrg('viewer', 'project:create')).toBe(false);
    expect(canOrg('member', 'workspace:manage')).toBe(false);
  });

  it('maps the program actions to their minimum roles', () => {
    expect(canProject('editor', 'output:log')).toBe(true);
    expect(canProject('editor', 'build:plan')).toBe(true);
    expect(canProject('editor', 'schedule:manage')).toBe(true);
    expect(canProject('editor', 'pricing:propose')).toBe(true);
    expect(canProject('commenter', 'output:log')).toBe(false);
    expect(canProject('viewer', 'pricing:propose')).toBe(false);
    expect(canProject('editor', 'pricing:manage')).toBe(false);
    expect(canProject('owner', 'pricing:manage')).toBe(true);
    expect(canProject('editor', 'program:close')).toBe(false);
    expect(canProject('owner', 'program:close')).toBe(true);
  });

  it('never lets the implicit role read money', () => {
    const implicit = effectiveProjectRole({ orgRole: 'member', memberRole: null, visibility: 'org' });
    expect(implicit).toBe('editor');
    expect(canProject(implicit, 'money:read')).toBe(false);
    expect(canReadMoney({ orgRole: 'member', memberRole: null, moneyMinRole: 'editor' })).toBe(false);
    expect(canReadMoney({ orgRole: 'member', memberRole: null, moneyMinRole: 'viewer' })).toBe(false);
    expect(projectCapabilities('editor')['money:read']).toBe(false);
  });

  it('never answers money by role rank, so an explicit owner guest cannot leak it', () => {
    for (const role of ['owner', 'editor', 'commenter', 'viewer'] as const) {
      expect(canProject(role, 'money:read')).toBe(false);
      expect(projectCapabilities(role)['money:read']).toBe(false);
    }
    expect(canReadMoney({ orgRole: 'guest', memberRole: 'owner', isProjectOwner: false, moneyMinRole: 'viewer' })).toBe(false);
    expect(canReadMoney({ orgRole: 'member', memberRole: 'owner', moneyMinRole: 'editor' })).toBe(true);
  });

  it('lets an explicit editor read money at the default money_min_role while an implicit org member cannot (8.1)', () => {
    // An org member on an org visible program: implicit editor, can log output, never sees money.
    expect(effectiveProjectRole({ orgRole: 'member', memberRole: null, visibility: 'org' })).toBe('editor');
    expect(canReadMoney({ orgRole: 'member', memberRole: null, moneyMinRole: 'editor' })).toBe(false);
    // The same person added as an explicit editor sees money at money_min_role editor (the default).
    expect(canReadMoney({ orgRole: 'member', memberRole: 'editor', moneyMinRole: 'editor' })).toBe(true);
    // Below the program's money_min_role, an explicit role does not pass; at or above it does.
    expect(canReadMoney({ orgRole: 'member', memberRole: 'editor', moneyMinRole: 'owner' })).toBe(false);
    expect(canReadMoney({ orgRole: 'member', memberRole: 'commenter', moneyMinRole: 'editor' })).toBe(false);
    expect(canReadMoney({ orgRole: 'viewer', memberRole: 'viewer', moneyMinRole: 'viewer' })).toBe(true);
    expect(canReadMoney({ orgRole: 'viewer', memberRole: 'viewer', moneyMinRole: 'commenter' })).toBe(false);
    // Org owners and admins always pass; guests never do.
    expect(canReadMoney({ orgRole: 'admin', memberRole: null, moneyMinRole: 'owner' })).toBe(true);
    expect(canReadMoney({ orgRole: 'owner', memberRole: null, moneyMinRole: 'owner' })).toBe(true);
    expect(canReadMoney({ orgRole: 'guest', memberRole: 'owner', moneyMinRole: 'viewer' })).toBe(false);
    expect(canReadMoney({ orgRole: null, memberRole: 'owner', moneyMinRole: 'viewer' })).toBe(false);
    // No effective role, implicit or explicit, answers money by rank.
    expect(canProject(effectiveProjectRole({ orgRole: 'owner', memberRole: null, visibility: 'org' }), 'money:read')).toBe(false);
    expect(Object.keys(projectCapabilities('owner'))).toContain('money:read');
  });

  it.each(MONEY_READ_CASES)('money:read matches the shared table: $name', (row) => {
    expect(canReadMoney(row)).toBe(row.expected);
  });

  it('shows sync details to org admins and program owners only', () => {
    expect(canSeeSync({ orgRole: 'admin', role: 'owner' })).toBe(true);
    expect(canSeeSync({ orgRole: 'member', role: 'owner' })).toBe(true);
    expect(canSeeSync({ orgRole: 'member', role: 'editor' })).toBe(false);
    expect(canSeeSync({ orgRole: 'guest', role: 'owner' })).toBe(false);
  });
});
