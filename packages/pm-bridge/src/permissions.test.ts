import { describe, expect, it } from 'vitest';
import { canEditProject, effectiveProjectRole, parseOrgRole } from './permissions';
import { plainTextToHtml } from './write';
import { rowsOf } from './executor';

describe('parseOrgRole', () => {
  it('picks the strongest role from a comma list', () => {
    expect(parseOrgRole('member,admin')).toBe('admin');
    expect(parseOrgRole('viewer')).toBe('viewer');
  });
  it('treats deactivated, empty and unknown roles as no access', () => {
    expect(parseOrgRole('deactivated:admin')).toBeNull();
    expect(parseOrgRole('')).toBeNull();
    expect(parseOrgRole('robot')).toBeNull();
  });
});

describe('effectiveProjectRole', () => {
  const base = { memberRole: null, visibility: 'org', isProjectOwner: false } as const;
  it('gives org owners/admins and project owners full access', () => {
    expect(effectiveProjectRole({ ...base, orgRole: 'admin' })).toBe('owner');
    expect(effectiveProjectRole({ ...base, orgRole: 'viewer', isProjectOwner: true })).toBe('owner');
  });
  it('derives implicit roles on org-visible projects', () => {
    expect(effectiveProjectRole({ ...base, orgRole: 'member' })).toBe('editor');
    expect(effectiveProjectRole({ ...base, orgRole: 'viewer' })).toBe('commenter');
    expect(effectiveProjectRole({ ...base, orgRole: 'guest' })).toBeNull();
  });
  it('admits only explicit members to private projects', () => {
    expect(effectiveProjectRole({ ...base, visibility: 'private', orgRole: 'member' })).toBeNull();
    expect(effectiveProjectRole({ ...base, visibility: 'private', orgRole: 'member', memberRole: 'viewer' })).toBe('viewer');
  });
  it('never lowers the implicit role', () => {
    expect(effectiveProjectRole({ ...base, orgRole: 'member', memberRole: 'viewer' })).toBe('editor');
    expect(effectiveProjectRole({ ...base, orgRole: 'viewer', memberRole: 'editor' })).toBe('editor');
  });
  it('lets editors and owners add tasks', () => {
    expect(canEditProject('editor')).toBe(true);
    expect(canEditProject('owner')).toBe(true);
    expect(canEditProject('commenter')).toBe(false);
    expect(canEditProject(null)).toBe(false);
  });
});

describe('helpers', () => {
  it('turns plain text into escaped paragraphs', () => {
    expect(plainTextToHtml('Hi <b>team</b>\n\nCall Acme')).toBe('<p>Hi &lt;b&gt;team&lt;/b&gt;</p><p></p><p>Call Acme</p>');
    expect(plainTextToHtml('   ')).toBeNull();
    expect(plainTextToHtml(null)).toBeNull();
  });
  it('normalizes driver result shapes', () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});
