"use client";

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
import * as React from "react";
import { usePermissionSet as useSharedPermissionSet } from "@/lib/permissions-client";

export interface PermissionView {
  readonly has: (key: string) => boolean;
}

const subscribe = (): (() => void) => () => undefined;

export function usePermissionSet(): { readonly permissions: PermissionView; readonly isLoading: boolean } {
  const { permissions, isLoading } = useSharedPermissionSet();
  const mounted = React.useSyncExternalStore(subscribe, () => true, () => false);
  const ready = mounted && !isLoading;
  const view = React.useMemo<PermissionView>(() => ({ has: (key) => !ready || permissions.has(key) }), [ready, permissions]);
  return { permissions: view, isLoading: !ready };
}
