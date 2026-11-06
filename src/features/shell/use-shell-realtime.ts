'use client';
/**
 * Live sidebar: subscribes to the org event stream and refreshes the shell's structural
 * queries (workspaces, trees, favorites, recents, home, workspace overview) when another tab
 * or collaborator changes boards, folders, dashboards or workspaces. Bursts are coalesced.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeOrgStream } from '@/lib/org-stream';
import { shellKeys } from './api';

const COALESCE_MS = 150;

export function useShellRealtime(orgId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: number | null = null;
    let everything = false;

    const flush = () => {
      timer = null;
      const refresh = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey });
      refresh(shellKeys.workspaces(orgId)); // prefix: list, trees, members
      refresh(shellKeys.favorites(orgId));
      refresh(['org', orgId, 'recents']);
      refresh(['org', orgId, 'shell-home']);
      if (everything) refresh(['org', orgId, 'shell-search']);
      everything = false;
    };
    const schedule = () => {
      if (timer === null) timer = window.setTimeout(flush, COALESCE_MS);
    };

    const unsubscribe = subscribeOrgStream(orgId, {
      onChange: (event) => {
        if (event.type !== 'workspace.changed' && event.type !== 'board.updated' && event.type !== 'board.deleted')
          return;
        schedule();
      },
      onResync: () => {
        everything = true;
        schedule();
      },
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orgId, queryClient]);
}
