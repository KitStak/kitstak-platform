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

/** Mirrors each owning hook's staleTime so the prefetch never fights the hook's own refetch. */
const STALE_MS = {
  me: 30_000,
  workspaces: 60_000,
  favorites: 60_000,
  crmBoards: 60_000,
  dashboardSources: 5 * 60_000,
} as const;

export function useShellPrefetch(orgId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const prefetch = (queryKey: readonly unknown[], path: string, staleTime: number) =>
      queryClient.prefetchQuery({
        queryKey: queryKey as unknown[],
        queryFn: ({ signal }) => apiRequest<unknown>(path, { orgId, signal }),
        staleTime,
      });
    void Promise.all([
      prefetch(shellKeys.me(orgId), '/me', STALE_MS.me),
      prefetch(shellKeys.workspaces(orgId), '/workspaces', STALE_MS.workspaces),
      prefetch(shellKeys.favorites(orgId), '/favorites', STALE_MS.favorites),
      prefetch(crmKeys.boards(orgId), '/crm/boards', STALE_MS.crmBoards),
      prefetch(dashboardKeys.sources(orgId), '/dashboard-data/sources', STALE_MS.dashboardSources),
    ]);
  }, [orgId, queryClient]);
}
