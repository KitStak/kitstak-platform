'use client';

/**
 * Permission gate for order screens that treats "still loading /api/me" as its own state:
 * nothing is ever labelled "You don't have permission" until the permission set has arrived.
 * While loading, `can()` is optimistic (labels and layout don't flip) and `reason()` returns a
 * neutral "Checking permissions…" so the control stays disabled without denial copy.
 */
import * as React from 'react';
import { usePermissionSet } from '@/lib/permissions-client';

export const NO_PERMISSION = "You don't have permission for this action";
export const CHECKING_PERMISSIONS = 'Checking permissions…';

export interface OrderPermissions {
  readonly ready: boolean;
  /** Optimistic while loading: use for labels / visibility, never as the only guard for a mutation. */
  readonly can: (permission: string) => boolean;
  /** Disabled reason for a mutation control: null = allowed. */
  readonly reason: (permission: string, denied?: string) => string | null;
}

export function permissionGate(permissions: ReadonlySet<string>, ready: boolean): OrderPermissions {
  return {
    ready,
    can: (p) => !ready || permissions.has(p),
    reason: (p, denied = NO_PERMISSION) =>
      !ready ? CHECKING_PERMISSIONS : permissions.has(p) ? null : denied,
  };
}

export function useOrderPermissions(): OrderPermissions {
  const { permissions, isLoading } = usePermissionSet();
  return React.useMemo(() => permissionGate(permissions, !isLoading), [permissions, isLoading]);
}
