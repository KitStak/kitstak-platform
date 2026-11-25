import { describe, expect, it } from 'vitest';
import { MONEY_READ_CASES, canReadProgramMoney } from '@kitstak/db/programs';
import { canEditProject, canSeeProgramMoney, effectiveProjectRole, parseOrgRole } from './permissions';
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

describe('canSeeProgramMoney (shared table with Projects)', () => {
  it.each(MONEY_READ_CASES.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(
      canSeeProgramMoney({
        orgRole: entry.orgRole,
        memberRole: entry.memberRole,
        isProjectOwner: entry.isProjectOwner,
        moneyMinRole: entry.moneyMinRole,
      }),
    ).toBe(entry.expected);
  });
  it('agrees with the shared rule for every role combination', () => {
    const orgRoles = ['owner', 'admin', 'member', 'viewer', 'guest', null] as const;
    const projectRoles = ['owner', 'editor', 'commenter', 'viewer', null] as const;
    const minimums = ['owner', 'editor', 'commenter', 'viewer'] as const;
    for (const orgRole of orgRoles)
      for (const memberRole of projectRoles)
        for (const moneyMinRole of minimums)
          for (const isProjectOwner of [true, false]) {
            const input = { orgRole, memberRole, moneyMinRole, isProjectOwner };
            expect(canSeeProgramMoney(input)).toBe(canReadProgramMoney(input));
          }
  });
});
