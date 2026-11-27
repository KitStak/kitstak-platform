/**
 * Role strings from `core.member.role`: a comma list, and a `deactivated:` prefix means no access at
 * all (the CRM marks removed members that way).
 */
import { BILLING_ONLY_ROLE } from '@kitstak/auth/access-control';
import { CATALOG } from '../catalog';

export const DEACTIVATED_PREFIX = 'deactivated:';

export function isActiveRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && !role.trim().toLowerCase().startsWith(DEACTIVATED_PREFIX);
}

export function roleParts(role: string | null | undefined): string[] {
  if (typeof role !== 'string') return [];
  return role
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/** True when every role in the list is free (guests). An empty role is a paid member. */
export function isFreeRole(role: string | null | undefined): boolean {
  const parts = roleParts(role);
  if (parts.length === 0) return false;
  const free: readonly string[] = CATALOG.freeRoles;
  return parts.every((part) => free.includes(part));
}

/** True when a member with this role string uses a seat. */
export function usesSeat(role: string | null | undefined): boolean {
  return isActiveRole(role) && !isFreeRole(role);
}

/**
 * The role of a person who only manages billing: no seat, no access to the apps (review round 2).
 * The name is defined once, next to the role itself, in @kitstak/auth. `CATALOG.freeRoles` lists it
 * so it uses no seat.
 */
export { BILLING_ONLY_ROLE };

/** True when the role string holds the billing role (with or without other roles). */
export function hasBillingRole(role: string | null | undefined): boolean {
  return isActiveRole(role) && roleParts(role).includes(BILLING_ONLY_ROLE);
}

/** True when billing is all this person has in the organization. */
export function isBillingOnlyRole(role: string | null | undefined): boolean {
  if (!isActiveRole(role)) return false;
  const parts = roleParts(role);
  return parts.length > 0 && parts.every((part) => part === BILLING_ONLY_ROLE);
}
