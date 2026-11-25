'use client';
/**
 * Warms the queries almost every page needs as soon as the shell mounts, all in parallel, so
 * page-level hooks (top bar, sidebar, pipeline cockpit, dashboards) hit a fresh cache instead
 * of forming a serial waterfall on first paint: /me, /workspaces, /favorites, /crm/boards and
 * the dashboard sources. Prefetching is best-effort: failures surface through the owning hook
 * when the page actually needs the data.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { crmKeys } from '@/features/crm/api';
import { dashboardKeys } from '@/features/dashboards/hooks';
import { shellKeys } from './api';
import type { Permission } from '@/server/rbac/permissions';

/** Mirrors each owning hook's staleTime so the prefetch never fights the hook's own refetch. */
const STALE_MS = {
  me: 30_000,
  workspaces: 60_000,
  favorites: 60_000,
  crmBoards: 60_000,
  dashboardSources: 5 * 60_000,
} as const;

export function useShellPrefetch(orgId: string, permissions?: readonly Permission[]): void {
  const queryClient = useQueryClient();
  // A guest may not list workspaces or dashboard sources. Asking anyway is a refused request in
  // the console on every page (billing review round 5), so those two are only warmed for people
  // who may read them. The shell passes the permissions (this hook runs above its provider).
  // With none given (dev harnesses) everything is warmed, as before.
  const canWorkspaces = permissions?.includes('workspace:read') ?? true;
  const canDashboards = permissions?.includes('dashboard:read') ?? true;
  useEffect(() => {
    const prefetch = (queryKey: readonly unknown[], path: string, staleTime: number) =>
      queryClient.prefetchQuery({
        queryKey: queryKey as unknown[],
        queryFn: ({ signal }) => apiRequest<unknown>(path, { orgId, signal }),
        staleTime,
      });
    void Promise.all([
      prefetch(shellKeys.me(orgId), '/me', STALE_MS.me),
      canWorkspaces ? prefetch(shellKeys.workspaces(orgId), '/workspaces', STALE_MS.workspaces) : null,
      prefetch(shellKeys.favorites(orgId), '/favorites', STALE_MS.favorites),
      prefetch(crmKeys.boards(orgId), '/crm/boards', STALE_MS.crmBoards),
      canDashboards ? prefetch(dashboardKeys.sources(orgId), '/dashboard-data/sources', STALE_MS.dashboardSources) : null,
    ]);
  }, [orgId, queryClient, canWorkspaces, canDashboards]);
}
