/**
 * Permission model (pure; safe in client code to hide buttons. The server check in
 * src/server/domain/access.ts is the only one that counts). docs/crew/SPEC.md section 3.
 *
 * Two layers:
 *  1. Org role (Better Auth member role in core.member): who belongs to the workspace.
 *  2. Crew role: owner, admin, payroll, supervisor, lead, viewer or none. The resolver
 *     (crew.member_roles, then the org role) lives in `@kitstak/crew-bridge` (`resolveRole`).
 * Site and crew scope checks (supervisor sites, a lead's crew) come with the data they guard.
 */
import { CREW_ROLES, crewRoleAtLeast, isCrewRole, parseOrgRole, type CrewRole, type OrgRole } from '@kitstak/crew-bridge';

export { CREW_ROLES, isCrewRole, parseOrgRole, type CrewRole, type OrgRole };

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;

export const CREW_ROLE_LABELS: Readonly<Record<CrewRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  payroll: 'Payroll',
  supervisor: 'Supervisor',
  lead: 'Lead',
  viewer: 'Viewer',
  none: 'No role',
};

/** One plain sentence per role (People and roles, the welcome screen). */
export const CREW_ROLE_DESCRIPTIONS: Readonly<Record<CrewRole, string>> = {
  owner: 'Runs Crew. Can do everything, and sees pay.',
  admin: 'Sets up Crew: settings, labor rules, time clocks and roles. Sees pay.',
  payroll: 'Approves and exports hours, sets wages and time off balances. Sees pay.',
  supervisor: 'Runs the floor for their sites: people, schedule, time cards and approvals. No pay.',
  lead: 'Sees their crew on the floor: schedule, punches and time cards. No edits.',
  viewer: 'Sees the published schedule, the today board and skills.',
  none: 'No Crew pages. A person linked to a login still gets the phone clock and My work.',
};

export type CrewAction =
  | 'crew:read'
  | 'schedule:read'
  | 'schedule:draft'
  | 'schedule:publish'
  | 'request:decide'
  | 'person:manage'
  | 'person:private_read'
  | 'punch:edit'
  | 'hours:approve'
  | 'attendance:read'
  | 'attendance:edit'
  | 'timeoff:decide'
  | 'skills:manage'
  | 'plan:read'
  | 'plan:manage'
  | 'import:run'
  | 'export:run'
  | 'pay:read'
  | 'pay:manage'
  | 'week:reopen'
  | 'export:payroll'
  | 'timeoff:balance'
  | 'kiosk:manage'
  | 'rules:manage'
  | 'certtype:manage'
  | 'roles:manage'
  | 'settings:manage'
  | 'sample:manage'
  | 'data:purge';

/** Lowest Crew role that may perform each action (SPEC 3.3 action table). */
export const CREW_ACTION_MIN: Readonly<Record<CrewAction, CrewRole>> = {
  'crew:read': 'viewer',
  'schedule:read': 'viewer',
  'schedule:draft': 'supervisor',
  'schedule:publish': 'supervisor',
  'request:decide': 'supervisor',
  'person:manage': 'supervisor',
  'person:private_read': 'supervisor',
  'punch:edit': 'supervisor',
  'hours:approve': 'supervisor',
  'attendance:read': 'supervisor',
  'attendance:edit': 'supervisor',
  'timeoff:decide': 'supervisor',
  'skills:manage': 'supervisor',
  'plan:read': 'lead',
  'plan:manage': 'supervisor',
  'import:run': 'supervisor',
  'export:run': 'supervisor',
  'pay:read': 'payroll',
  'pay:manage': 'payroll',
  'week:reopen': 'payroll',
  'export:payroll': 'payroll',
  'timeoff:balance': 'payroll',
  'kiosk:manage': 'admin',
  'rules:manage': 'admin',
  'certtype:manage': 'admin',
  'roles:manage': 'admin',
  'settings:manage': 'admin',
  'sample:manage': 'admin',
  'data:purge': 'owner',
};

/**
 * A lead outranks a viewer, but the sight matrix (SPEC 3.2) gives a viewer the whole published
 * schedule and skills while a lead sees only their crew. `crew:read` and `schedule:read` are
 * therefore allowed for both; the crew scope narrows a lead's rows on the server.
 */
export function canCrew(role: CrewRole | null | undefined, action: CrewAction): boolean {
  if (!role || role === 'none') return false;
  return crewRoleAtLeast(role, CREW_ACTION_MIN[action]);
}

/** Self rights (SPEC 3.3): any signed in user linked to a live person, any role including none. */
export type SelfAction = 'self:clock' | 'self:read' | 'self:request';

/** Every self action needs the same thing: a linked live person. */
export function canSelf(linkedPersonId: string | null | undefined): boolean {
  return typeof linkedPersonId === 'string' && linkedPersonId.length > 0;
}

/** Roles an owner or admin may hand out. Only an owner makes or removes an owner. */
export function assignableRoles(actor: CrewRole): readonly CrewRole[] {
  if (actor === 'owner') return CREW_ROLES;
  if (actor === 'admin') return CREW_ROLES.filter((role) => role !== 'owner');
  return [];
}

export const isOrgRole = (value: unknown): value is OrgRole => typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
