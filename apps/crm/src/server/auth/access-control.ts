/**
 * Better Auth organization-plugin access control.
 *
 * Governs Better Auth's own organization endpoints (invite, update member, teams...).
 * Application permissions live in `src/server/rbac`; role names are shared.
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const orgAccessControl = createAccessControl(defaultStatements);

export const orgRoles = {
  owner: orgAccessControl.newRole(ownerAc.statements),
  admin: orgAccessControl.newRole(adminAc.statements),
  member: orgAccessControl.newRole(memberAc.statements),
  viewer: orgAccessControl.newRole(memberAc.statements),
  guest: orgAccessControl.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
};
