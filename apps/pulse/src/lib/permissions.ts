/**
 * Permission model (pure; safe in client code to hide buttons. The server check in
 * src/server/domain/access.ts is the only one that counts). See docs/pulse/SPEC.md section 3.
 *
 * Two layers:
 *  1. Org role (Better Auth member role in core.member): who belongs to the workspace.
 *  2. Pulse role: owner, admin, manager, supervisor, viewer or none. Seeing money is opt in.
 *     The full resolver (pulse.member_roles, then the WMS role, then the org role) lives in
 *     `@kitstak/pulse-bridge` (`resolvePulseAccess`). `pulseRoleFromOrgRole` here is only its
 *     last step, used until a person has an explicit Pulse role.
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };

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

/** Pulse roles, most to least powerful. `none` means "ask an admin for access". */
export const PULSE_ROLES = ['owner', 'admin', 'manager', 'supervisor', 'viewer', 'none'] as const;
export type PulseRole = (typeof PULSE_ROLES)[number];

const PULSE_ROLE_RANK: Readonly<Record<PulseRole, number>> = { owner: 5, admin: 4, manager: 3, supervisor: 2, viewer: 1, none: 0 };

export const PULSE_ROLE_LABELS: Readonly<Record<PulseRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
  viewer: 'Viewer',
  none: 'No access',
};

export function isPulseRole(value: unknown): value is PulseRole {
  return typeof value === 'string' && value in PULSE_ROLE_RANK;
}

export type PulseAction =
  | 'pulse:read'
  | 'production:log'
  | 'production:edit_any'
  | 'material:log'
  | 'day:review'
  | 'job:manage'
  | 'plan:manage'
  | 'cost:manage'
  | 'revenue:manage'
  | 'vas:manage'
  | 'standard:manage'
  | 'target:manage'
  | 'alert:manage'
  | 'import:run'
  | 'export:run'
  | 'device:manage'
  | 'rate:manage'
  | 'period:close'
  | 'roles:manage'
  | 'settings:manage'
  | 'sample:manage'
  | 'period:reopen'
  | 'data:purge';

/** Lowest Pulse role that may perform each action (SPEC section 3 action table). */
export const PULSE_ACTION_MIN: Readonly<Record<PulseAction, PulseRole>> = {
  'pulse:read': 'viewer',
  'production:log': 'supervisor',
  'production:edit_any': 'manager',
  'material:log': 'supervisor',
  'day:review': 'manager',
  'job:manage': 'manager',
  'plan:manage': 'manager',
  'cost:manage': 'manager',
  'revenue:manage': 'manager',
  'vas:manage': 'manager',
  'standard:manage': 'manager',
  'target:manage': 'manager',
  'alert:manage': 'manager',
  'import:run': 'manager',
  'export:run': 'viewer',
  'device:manage': 'manager',
  'rate:manage': 'admin',
  'period:close': 'admin',
  'roles:manage': 'admin',
  'settings:manage': 'admin',
  'sample:manage': 'admin',
  'period:reopen': 'owner',
  'data:purge': 'owner',
};

export function canPulse(role: PulseRole | null | undefined, action: PulseAction): boolean {
  if (!role || role === 'none') return false;
  return PULSE_ROLE_RANK[role] >= PULSE_ROLE_RANK[PULSE_ACTION_MIN[action]];
}

/** Import streams a supervisor may run even though `import:run` needs a manager. */
export const SUPERVISOR_IMPORT_STREAMS = ['production', 'indirect_time', 'time_punches', 'materials'] as const;

export function canImportStream(role: PulseRole | null | undefined, stream: string): boolean {
  if (canPulse(role, 'import:run')) return true;
  return role === 'supervisor' && (SUPERVISOR_IMPORT_STREAMS as readonly string[]).includes(stream);
}

/** `money:read`: owner, admin and manager always; anyone else only with the per person switch. */
export function canSeeMoney(role: PulseRole | null | undefined, seesMoneySwitch = false): boolean {
  if (!role || role === 'none') return false;
  return PULSE_ROLE_RANK[role] >= PULSE_ROLE_RANK.manager || seesMoneySwitch;
}

/** `wage:read`: wage, tax and benefit detail of a labor rate. Same people as `rate:manage`. */
export function canSeeWages(role: PulseRole | null | undefined): boolean {
  return canPulse(role, 'rate:manage');
}

/**
 * Last step of the role resolver: the org role alone. Owners own Pulse, admins administer it,
 * members get the workspace default (none unless an admin changes it), viewers and guests get none.
 */
export function pulseRoleFromOrgRole(orgRole: OrgRole | null | undefined, defaultMemberRole: PulseRole = 'none'): PulseRole {
  if (orgRole === 'owner') return 'owner';
  if (orgRole === 'admin') return 'admin';
  if (orgRole === 'member') return defaultMemberRole;
  return 'none';
}
