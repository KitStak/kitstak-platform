import { describe, expect, it } from 'vitest';
import { canOrg, canProject, effectiveProjectRole, parseOrgRole, projectCapabilities } from './permissions';

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
});
