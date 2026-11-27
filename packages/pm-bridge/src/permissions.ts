/**
 * Project access rules, mirrored from apps/projects/src/lib/permissions.ts (keep in lockstep;
 * both are unit tested). Org role comes from core.member, project role from pm.project_members.
 *
 *  - org owner/admin, or the project's owner → project owner
 *  - org-visible project: member → editor, viewer → commenter, guest → no implicit access
 *  - private project: explicit members only
 *  - an explicit role never lowers the implicit one
 */

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer';

const ORG_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };
const PROJECT_RANK: Readonly<Record<ProjectRole, number>> = { owner: 4, editor: 3, commenter: 2, viewer: 1 };

/** Better Auth stores roles as a comma list ("admin,member"); CRM prefixes deactivated members. */
export function parseOrgRole(raw: string | null | undefined): OrgRole | null {
  if (!raw || raw.startsWith('deactivated:')) return null;
  let best: OrgRole | null = null;
  for (const part of raw.split(',')) {
    const role = part.trim() as OrgRole;
    if (!(role in ORG_RANK)) continue;
    if (!best || ORG_RANK[role] > ORG_RANK[best]) best = role;
  }
  return best;
}

const IMPLICIT: Readonly<Record<OrgRole, ProjectRole | null>> = {
  owner: 'owner',
  admin: 'owner',
  member: 'editor',
  viewer: 'commenter',
  guest: null,
};

export function effectiveProjectRole(input: {
  readonly orgRole: OrgRole | null;
  readonly memberRole: ProjectRole | null;
  readonly visibility: string;
  readonly isProjectOwner: boolean;
}): ProjectRole | null {
  const { orgRole, memberRole, visibility, isProjectOwner } = input;
  if (!orgRole) return null;
  if (orgRole === 'owner' || orgRole === 'admin' || isProjectOwner) return 'owner';
  const implicit = visibility === 'org' ? IMPLICIT[orgRole] : null;
  if (!memberRole) return implicit;
  if (!implicit) return memberRole;
  return PROJECT_RANK[memberRole] >= PROJECT_RANK[implicit] ? memberRole : implicit;
}

/** Editors and above add tasks and links. */
export function canEditProject(role: ProjectRole | null): boolean {
  return role !== null && PROJECT_RANK[role] >= PROJECT_RANK.editor;
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && value in PROJECT_RANK;
}

/**
 * Who may see program money (docs/programs/SPEC.md A10 and 8.1), mirrored from
 * `apps/projects/src/lib/permissions.ts`. Both copies are tested against the shared case table
 * `MONEY_READ_CASES` in `@kitstak/db/programs`, so CRM and WMS panels hide money for exactly
 * the people Projects hides it for.
 *
 *  - org owners and admins always see money
 *  - the program's owner sees money (not a guest)
 *  - anyone else needs an EXPLICIT program role (pm.project_members) at or above the program's
 *    `money_min_role`; the implicit editor role of an org member never counts
 *  - guests and non members never see money
 */
export function canSeeProgramMoney(input: {
  readonly orgRole: OrgRole | null;
  readonly memberRole: ProjectRole | null;
  readonly isProjectOwner?: boolean;
  readonly moneyMinRole: ProjectRole;
}): boolean {
  const { orgRole, memberRole, isProjectOwner, moneyMinRole } = input;
  if (!orgRole || orgRole === 'guest') return false;
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  if (isProjectOwner) return true;
  if (!memberRole) return false;
  return PROJECT_RANK[memberRole] >= PROJECT_RANK[moneyMinRole];
}
