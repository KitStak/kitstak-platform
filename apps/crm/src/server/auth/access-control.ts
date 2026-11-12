/**
 * Better Auth organization-plugin access control now lives in `@kitstak/auth`
 * (blueprint §1.3); this module is a compatibility re-export so existing
 * `@/server/auth/access-control` imports keep working. Application permissions
 * live in `src/server/rbac`; role names are shared.
 */
export { orgAccessControl, orgRoles } from '@kitstak/auth/access-control';
