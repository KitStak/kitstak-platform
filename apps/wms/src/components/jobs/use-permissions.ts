'use client';

/**
 * Hydration-safe wrapper over the shared `usePermissionSet`.
 *
 * The /api/me query can already be cached on the client when a page hydrates, while
 * the server render never has it, so reading permissions during the first render
 * produced "no permission" markup on the server and enabled buttons on the client
 * (hydration mismatch). Until the component has mounted and /api/me has loaded,
 * `has()` answers optimistically (true) so the server and first client render agree
 * and nobody sees a false "you don't have permission" tooltip; the API re-checks
 * every request in `defineRoute` regardless.
 */
import * as React from 'react';
import { allowsJobAction } from '@/lib/grid-defs/jobs/supervisor-policy';
import { useMe, usePermissionSet as useSharedPermissionSet } from '@/lib/permissions-client';

export interface PermissionView {
  /** Optimistic while loading: use for disabled-with-reason tooltips. */
  readonly has: (key: string) => boolean;
  /** Pessimistic: false until /api/me has resolved. Use it to decide whether a gated action renders at all. */
  readonly can: (key: string) => boolean;
}

const subscribe = (): (() => void) => () => undefined;

export function usePermissionSet(): { readonly permissions: PermissionView; readonly isLoading: boolean } {
  const { permissions, isLoading } = useSharedPermissionSet();
  const me = useMe().data?.data;
  const roles = me?.roles;
  const legacyRole = me?.user.role;
  const mounted = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const ready = mounted && !isLoading;
  // Floor-only users never get supervisor-only job/task actions (supervisor-policy.ts), matching the API's 403.
  const view = React.useMemo<PermissionView>(() => {
    const granted = (key: string) => allowsJobAction(key, permissions.has(key), roles, legacyRole);
    return { has: (key) => !ready || granted(key), can: (key) => ready && granted(key) };
  }, [ready, permissions, roles, legacyRole]);
  return { permissions: view, isLoading: !ready };
}
