/** Plain JSON DTOs of the Crew bridge (docs/crew/SPEC.md section 8.1). No pay, private or attendance fields. */

/** Crew roles, most to least powerful (SPEC 3.1). `none` still gets the phone clock and /me for a linked person. */
export const CREW_ROLES = ['owner', 'admin', 'payroll', 'supervisor', 'lead', 'viewer', 'none'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

/** Roles an admin may pick as the default for plain members (`crew.settings.default_member_role`). */
export const DEFAULT_MEMBER_ROLES = ['supervisor', 'lead', 'viewer', 'none'] as const;
export type DefaultMemberRole = (typeof DEFAULT_MEMBER_ROLES)[number];

/** Better Auth org roles (core.member.role). */
export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Who is reading: a person in a workspace. */
export interface CrewReader {
  readonly orgId: string;
  readonly userId: string;
}

export interface CrewAccess {
  readonly role: CrewRole;
  /** Sites the role covers. `null` = all sites. Only narrows supervisor and lead. */
  readonly siteIds: readonly string[] | null;
  /** Pay type, wages and payroll exports (owner, admin, payroll). */
  readonly canSeePay: boolean;
  /** Emergency contact, home address and phone (supervisor and up). */
  readonly canSeePrivate: boolean;
  /** Which rule decided the role: an explicit `crew.member_roles` row or the org role. */
  readonly source: 'explicit' | 'org';
  /** The live Crew person linked to this user, or null. Being linked never grants a role. */
  readonly linkedPersonId: string | null;
}

/** The answer for a reader Crew does not know (no schema, not a member, any error). */
export const NO_CREW_ACCESS: CrewAccess = {
  role: 'none',
  siteIds: null,
  canSeePay: false,
  canSeePrivate: false,
  source: 'org',
  linkedPersonId: null,
};

/** The onboarding steps Crew adds (SPEC section 9), in order. */
export const CREW_SETUP_STEPS = ['crew_people', 'crew_schedule', 'crew_kiosk', 'crew_approve', 'crew_connect'] as const;
export type CrewSetupStep = (typeof CREW_SETUP_STEPS)[number];

/** Done flags per step. `crew_connect` is null when Pulse is not in this database (the step is not offered). */
export interface CrewSetupSignals {
  readonly crew_people: boolean;
  readonly crew_schedule: boolean;
  readonly crew_kiosk: boolean;
  readonly crew_approve: boolean;
  readonly crew_connect: boolean | null;
}

/**
 * A Crew person as a sibling app's server work sees them (SPEC 8.1 system reads): names, numbers
 * and site only. Never pay, private details or attendance.
 */
export interface CrewPersonRef {
  readonly personId: string;
  readonly number: string;
  readonly name: string;
  readonly kind: 'employee' | 'temp' | 'seasonal';
  readonly status: 'active' | 'on_leave' | 'ended';
  readonly siteId: string;
  readonly siteName: string;
  readonly wmsUserId: string | null;
}
