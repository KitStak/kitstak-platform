/**
 * Permission model (pure; safe in client code to hide affordances — the server check in
 * src/server/domain/access.ts is the only authoritative one).
 *
 * Two layers:
 *  1. Org role (Better Auth member role): owner/admin manage the workspace; members create
 *     projects; viewers read and comment; guests only see projects they were added to.
 *  2. Project role (pm.project_members): owner/editor/commenter/viewer. Org-visible projects
 *     give non-members an implicit role derived from their org role; private projects only
 *     admit explicit members (org owners/admins always get owner).
 */
import type { ProjectRole, ProjectVisibility } from './constants';

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };
const PROJECT_ROLE_RANK: Readonly<Record<ProjectRole, number>> = { owner: 4, editor: 3, commenter: 2, viewer: 1 };

/** Better Auth stores roles as a comma list ("admin,member"); CRM prefixes deactivated members. */
export function parseOrgRole(raw: string | null | undefined): OrgRole | null {
  if (!raw || raw.startsWith('deactivated:')) return null;
  let best: OrgRole | null = null;
  for (const part of raw.split(',')) {
    const role = part.trim() as OrgRole;
    if (!(role in ORG_ROLE_RANK)) continue;
    if (!best || ORG_ROLE_RANK[role] > ORG_ROLE_RANK[best]) best = role;
  }
  return best;
}

export type OrgAction =
  | 'workspace:manage'
  | 'space:manage'
  | 'project:create'
  | 'template:manage'
  | 'goal:manage'
  | 'dashboard:manage'
  | 'automation:manage_global'
  | 'member:read';

const ORG_ACTION_MIN: Readonly<Record<OrgAction, OrgRole>> = {
  'workspace:manage': 'admin',
  'space:manage': 'member',
  'project:create': 'member',
  'template:manage': 'member',
  'goal:manage': 'member',
  'dashboard:manage': 'member',
  'automation:manage_global': 'admin',
  'member:read': 'viewer',
};

export function canOrg(role: OrgRole | null, action: OrgAction): boolean {
  if (!role) return false;
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[ORG_ACTION_MIN[action]];
}

export interface ProjectAccessInput {
  readonly orgRole: OrgRole | null;
  /** Explicit pm.project_members role, if any. */
  readonly memberRole: ProjectRole | null;
  readonly visibility: ProjectVisibility;
  /** pm.projects.owner_id === user. */
  readonly isProjectOwner?: boolean;
}

/** Implicit role on an org-visible project for someone who is not an explicit member. */
const IMPLICIT_ORG_PROJECT_ROLE: Readonly<Record<OrgRole, ProjectRole | null>> = {
  owner: 'owner',
  admin: 'owner',
  member: 'editor',
  viewer: 'commenter',
  guest: null,
};

/** The role a user effectively holds on a project, or null for no access. */
export function effectiveProjectRole(input: ProjectAccessInput): ProjectRole | null {
  const { orgRole, memberRole, visibility, isProjectOwner } = input;
  if (!orgRole) return null;
  if (orgRole === 'owner' || orgRole === 'admin' || isProjectOwner) return 'owner';
  const implicit = visibility === 'org' ? IMPLICIT_ORG_PROJECT_ROLE[orgRole] : null;
  if (!memberRole) return implicit;
  if (!implicit) return memberRole;
  return PROJECT_ROLE_RANK[memberRole] >= PROJECT_ROLE_RANK[implicit] ? memberRole : implicit;
}

export type ProjectAction =
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage_members'
  | 'structure:manage'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'comment:create'
  | 'time:log'
  | 'view:save_shared'
  | 'automation:manage'
  | 'form:manage'
  | 'file:upload'
  | 'money:read'
  | 'pricing:propose'
  | 'pricing:manage'
  | 'output:log'
  | 'build:plan'
  | 'schedule:manage'
  | 'program:close';

/** Actions a project role answers by rank. `money:read` is not one of them (see `canReadMoney`). */
type RankedProjectAction = Exclude<ProjectAction, 'money:read'>;

const PROJECT_ACTION_MIN: Readonly<Record<RankedProjectAction, ProjectRole>> = {
  'project:read': 'viewer',
  'project:update': 'editor',
  'project:delete': 'owner',
  'project:manage_members': 'owner',
  'structure:manage': 'editor',
  'task:create': 'editor',
  'task:update': 'editor',
  'task:delete': 'editor',
  'comment:create': 'commenter',
  'time:log': 'editor',
  'view:save_shared': 'editor',
  'automation:manage': 'editor',
  'form:manage': 'editor',
  'file:upload': 'commenter',
  // Programs (docs/programs/SPEC.md 8.1). `money:read` has no minimum role here on purpose: an
  // effective role (which folds in the implicit org role) can never answer it. Only an explicit
  // membership at or above the program's `money_min_role` does, through canReadMoney.
  'pricing:propose': 'editor',
  'pricing:manage': 'owner',
  'output:log': 'editor',
  'build:plan': 'editor',
  'schedule:manage': 'editor',
  'program:close': 'owner',
};

/**
 * Role check for an action. Always false for `money:read`: a role alone cannot say who sees money
 * (an org guest can hold an explicit owner role, and the implicit role never counts), so money
 * goes through `canReadMoney` only.
 */
export function canProject(role: ProjectRole | null, action: ProjectAction): boolean {
  if (!role || action === 'money:read') return false;
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[PROJECT_ACTION_MIN[action]];
}

export interface MoneyAccessInput {
  readonly orgRole: OrgRole | null;
  /** Explicit pm.project_members role, if any. The implicit org role never counts here. */
  readonly memberRole: ProjectRole | null;
  /** pm.projects.owner_id === user. */
  readonly isProjectOwner?: boolean;
  /** pm.program_settings.money_min_role (default editor). */
  readonly moneyMinRole: ProjectRole;
}

/**
 * `money:read` (A10): org owners and admins always pass; anyone else needs an explicit program role
 * at or above the program's `money_min_role`, or to own the program. Guests never see money. Kept in
 * lockstep with packages/pm-bridge/src/permissions.ts through the shared case table
 * `MONEY_READ_CASES` (@kitstak/db/programs).
 */
export function canReadMoney(input: MoneyAccessInput): boolean {
  const { orgRole, memberRole, isProjectOwner, moneyMinRole } = input;
  if (!orgRole || orgRole === 'guest') return false;
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  if (isProjectOwner) return true;
  if (!memberRole) return false;
  return PROJECT_ROLE_RANK[memberRole] >= PROJECT_ROLE_RANK[moneyMinRole];
}

/** Program owners and org owners and admins see sync details (parity, Sync now, sync alerts). */
export function canSeeSync(input: { readonly orgRole: OrgRole | null; readonly role: ProjectRole | null }): boolean {
  if (input.orgRole === 'owner' || input.orgRole === 'admin') return true;
  return input.role === 'owner' && input.orgRole !== 'guest' && input.orgRole !== null;
}

/**
 * Every action a role allows (client capability maps). `money:read` is always false here, so the
 * map can never be used as the money rule: money visibility comes from canReadMoney only.
 */
export function projectCapabilities(role: ProjectRole | null): Readonly<Record<ProjectAction, boolean>> {
  const entries = (Object.keys(PROJECT_ACTION_MIN) as RankedProjectAction[]).map((action) => [action, canProject(role, action)]);
  return { ...(Object.fromEntries(entries) as Record<RankedProjectAction, boolean>), 'money:read': false };
}
