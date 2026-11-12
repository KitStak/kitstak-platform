'use client';

/**
 * Client-side permission checks (BUILD_PLAN F4.1). Reads `permissions` from GET /api/me
 * (admin already receives every catalog key). This is UX only — the server re-checks
 * every request in `defineRoute`.
 *
 *   const { allowed } = useCan("shipment_orders.create");
 *   <Can permission={["receipts.edit", "receipts.create"]} mode="any" fallback={<DisabledButton …/>}>…</Can>
 */
import * as React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from './api-client';
import { useApiQuery, type ApiQueryData } from './query-client';

export const ME_QUERY_KEY = ['me'] as const;
const ME_STALE_MS = 5 * 60_000;

export interface ContextOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

export interface MeResponse {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
    readonly firstName?: string | null;
    readonly lastName?: string | null;
    readonly role: string;
    readonly [key: string]: unknown;
  };
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
  readonly restrictions: readonly string[];
  readonly scope: { readonly warehouseIds: readonly string[]; readonly clientIds: readonly string[] | 'all' };
  readonly context: { readonly warehouseId: string | null; readonly clientId: string | null };
  readonly contextOptions: {
    readonly warehouses: readonly ContextOption[];
    readonly clients: readonly ContextOption[];
  };
  readonly preferences: Readonly<Record<string, unknown>>;
  /** Active add-on app keys (Settings → Apps); absent on older responses. */
  readonly activeApps?: readonly string[];
}

export type PermissionMode = 'all' | 'any';
export type PermissionInput = string | readonly string[];

/** Pure check used by the hook and in tests. */
export function hasPermission(
  granted: ReadonlySet<string> | readonly string[],
  required: PermissionInput,
  mode: PermissionMode = 'all',
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted as readonly string[]);
  const keys = typeof required === 'string' ? [required] : required;
  if (keys.length === 0) return true;
  return mode === 'all' ? keys.every((k) => set.has(k)) : keys.some((k) => set.has(k));
}

export function useMe(): UseQueryResult<ApiQueryData<MeResponse>, ApiError> {
  return useApiQuery<MeResponse>(ME_QUERY_KEY, '/api/me', { staleTime: ME_STALE_MS });
}

const subscribeNoop = (): (() => void) => () => undefined;

/**
 * False during SSR and the hydration render, true afterwards (and immediately for components
 * mounted after hydration). Permission-gated UI waits for it so the first client render matches
 * the server HTML even when /api/me is already in the React Query cache (no hydration mismatch).
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export function usePermissionSet(): {
  readonly permissions: ReadonlySet<string>;
  readonly isLoading: boolean;
} {
  const { data, isLoading } = useMe();
  const hydrated = useHydrated();
  const list = data?.data.permissions;
  const permissions = React.useMemo(() => new Set(hydrated ? (list ?? []) : []), [hydrated, list]);
  return { permissions, isLoading: !hydrated || isLoading };
}

export function useCan(
  required: PermissionInput,
  mode: PermissionMode = 'all',
): { readonly allowed: boolean; readonly isLoading: boolean } {
  const { permissions, isLoading } = usePermissionSet();
  return { allowed: !isLoading && hasPermission(permissions, required, mode), isLoading };
}

export function useRestriction(restriction: string): boolean {
  const { data } = useMe();
  return data?.data.restrictions.includes(restriction) ?? false;
}

export interface CanProps {
  readonly permission: PermissionInput;
  readonly mode?: PermissionMode;
  /** Rendered when denied (e.g. a disabled control with a "why" tooltip). Default: nothing. */
  readonly fallback?: React.ReactNode;
  /** Rendered while /api/me loads. Default: nothing (avoids flashing forbidden UI). */
  readonly loading?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function Can({ permission, mode = 'all', fallback = null, loading = null, children }: CanProps) {
  const { allowed, isLoading } = useCan(permission, mode);
  if (isLoading) return <>{loading}</>;
  return <>{allowed ? children : fallback}</>;
}
