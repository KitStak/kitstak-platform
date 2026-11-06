/**
 * Personal API token scopes → RBAC permissions. A token request is allowed only when the route's
 * permission is covered by one of the token's scopes AND by the owner's org role (the effective
 * grant is the intersection). Pure; safe on client and server.
 */
import type { Permission } from '@/server/rbac/permissions';
import type { ApiTokenScope } from './admin-contracts';

export const SCOPE_PERMISSIONS: Readonly<Record<ApiTokenScope, readonly Permission[]>> = {
  'boards:read': [
    'org:read',
    'workspace:read',
    'board:read',
    'item:read',
    'update:read',
    'file:read',
    'dashboard:read',
    'automation:read',
  ],
  'boards:write': ['board:create', 'board:write', 'item:write', 'item:delete', 'file:write'],
  'updates:write': ['update:write'],
  'members:read': ['org:read', 'member:read', 'team:read'],
  'webhooks:manage': ['webhook:manage'],
  'audit:read': ['audit:read'],
};

export function permissionsForScopes(scopes: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const scope of scopes) {
    const list = SCOPE_PERMISSIONS[scope as ApiTokenScope];
    if (list) for (const permission of list) granted.add(permission);
  }
  return granted;
}

export function scopesAllow(scopes: readonly string[], permission: Permission): boolean {
  return permissionsForScopes(scopes).has(permission);
}

/** Effective permissions of a token: role permissions ∩ scope permissions. */
export function effectiveTokenPermissions(
  rolePermissions: readonly Permission[],
  scopes: readonly string[],
): Permission[] {
  const scoped = permissionsForScopes(scopes);
  return rolePermissions.filter((permission) => scoped.has(permission));
}

export const TOKEN_LAST_USED_THROTTLE_MS = 60_000;

/** Whether `last_used_at` should be written now (at most once per throttle window). */
export function shouldTouchLastUsed(lastUsedAt: Date | null, now: number = Date.now()): boolean {
  return !lastUsedAt || now - lastUsedAt.getTime() >= TOKEN_LAST_USED_THROTTLE_MS;
}

const BEARER_RE = /^Bearer\s+(ks_live_[A-Za-z0-9_-]{20,128})\s*$/;

/** Extracts a KitStak token from `Authorization: Bearer ks_live_…`; null when absent/malformed. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = BEARER_RE.exec(header.trim());
  return match?.[1] ?? null;
}
