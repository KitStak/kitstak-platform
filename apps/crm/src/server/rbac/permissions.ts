/**
 * Application RBAC: organization role → permission matrix.
 *
 * Roles mirror the Better Auth organization member roles. Permissions are
 * `resource:action` strings checked by `withApi({ permission })`. Board-level privacy
 * (private / shareable boards, board owners) is enforced additionally in services.
 *
 * Pure module: safe to import from client code (e.g. to hide UI affordances), but the
 * server check in `withApi` is the only authoritative one.
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  // Organization
  'org:read',
  'org:update',
  'org:delete',
  'org:billing',
  // Members, teams, invitations
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'team:read',
  'team:write',
  // Workspaces & folders
  'workspace:read',
  'workspace:write',
  'workspace:delete',
  // Boards (structure: columns, groups, views, settings)
  'board:read',
  'board:create',
  'board:write',
  'board:delete',
  'board:share',
  // Items & cell values
  'item:read',
  'item:write',
  'item:delete',
  // Updates (comments) & files
  'update:read',
  'update:write',
  'update:moderate',
  'file:read',
  'file:write',
  // Dashboards
  'dashboard:read',
  'dashboard:write',
  // Automations
  'automation:read',
  'automation:write',
  // Import / export
  'data:import',
  'data:export',
  // Admin & security
  'audit:read',
  'api_token:manage',
  'webhook:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const READ_ONLY: readonly Permission[] = [
  'org:read',
  'member:read',
  'team:read',
  'workspace:read',
  'board:read',
  'item:read',
  'update:read',
  'file:read',
  'dashboard:read',
  'automation:read',
];

const MEMBER: readonly Permission[] = [
  ...READ_ONLY,
  'workspace:write',
  'board:create',
  'board:write',
  'board:delete',
  'board:share',
  'item:write',
  'item:delete',
  'update:write',
  'file:write',
  'dashboard:write',
  'automation:write',
  'data:import',
  'data:export',
  'api_token:manage',
];

/** Viewers can read and comment; guests can read, comment and edit items on boards shared with them. */
const VIEWER: readonly Permission[] = [...READ_ONLY, 'update:write'];

const GUEST: readonly Permission[] = [
  'org:read',
  'board:read',
  'item:read',
  'item:write',
  'update:read',
  'update:write',
  'file:read',
  'file:write',
];

const ADMIN: readonly Permission[] = ALL.filter(
  (permission) => permission !== 'org:delete' && permission !== 'org:billing',
);

export const ROLE_PERMISSIONS: Readonly<Record<OrgRole, ReadonlySet<Permission>>> = Object.freeze({
  owner: new Set(ALL),
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
  viewer: new Set(VIEWER),
  guest: new Set(GUEST),
});

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Better Auth stores multiple roles as a comma-separated string. Returns the known roles,
 * ignoring unknown values (fail closed).
 */
export function parseRoles(raw: string | null | undefined): OrgRole[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((role) => role.trim())
    .filter(isOrgRole);
}

export function hasPermission(roles: OrgRole | readonly OrgRole[], permission: Permission): boolean {
  const list: readonly OrgRole[] = typeof roles === 'string' ? [roles] : roles;
  return list.some((role) => ROLE_PERMISSIONS[role].has(permission));
}

export function permissionsFor(roles: readonly OrgRole[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

const ROLE_RANK: Readonly<Record<OrgRole, number>> = { owner: 4, admin: 3, member: 2, viewer: 1, guest: 0 };

/** Highest-privilege role among the given roles (for display and comparisons). */
export function primaryRole(roles: readonly OrgRole[]): OrgRole | undefined {
  return [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
}

/** True when `actor` may assign/modify a member holding `target` (cannot act on equal or higher, except owners). */
export function canManageRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'owner') return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
