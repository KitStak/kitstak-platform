/**
 * Better Auth organization-plugin access control.
 *
 * Governs Better Auth's own organization endpoints (invite, update member, teams...).
 * Application permissions live in each app (e.g. CRM `src/server/rbac`); role names are shared.
 *
 * Extracted from `apps/crm/src/server/auth/access-control.ts` (blueprint §1.1).
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const orgAccessControl = createAccessControl(defaultStatements);

/** The role name of a person who only manages billing. */
export const BILLING_ONLY_ROLE = 'billing';

export const orgRoles = {
  owner: orgAccessControl.newRole(ownerAc.statements),
  admin: orgAccessControl.newRole(adminAc.statements),
  member: orgAccessControl.newRole(memberAc.statements),
  viewer: orgAccessControl.newRole(memberAc.statements),
  guest: orgAccessControl.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
  /**
   * Billing only (billing review round 2): the bookkeeper or the person who pays the bills. This
   * role may see and manage Billing in the Portal and nothing else. It gives no rights over the
   * organization and no access to CRM, WMS, Projects or Pulse: every app reads role names from its
   * own list, and this name is on none of them. It uses no seat (`CATALOG.freeRoles` in
   * @kitstak/billing).
   */
  [BILLING_ONLY_ROLE]: orgAccessControl.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
};
