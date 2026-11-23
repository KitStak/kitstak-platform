/**
 * Role strings from `core.member.role`: a comma list, and a `deactivated:` prefix means no access at
 * all (the CRM marks removed members that way).
 */
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
