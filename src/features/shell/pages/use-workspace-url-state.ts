'use client';
/**
 * Workspace overview state (tab, search, type filter, sort, folder) mirrored into the query
 * string with `history.replaceState`, so a reload or a shared link restores the same view
 * without a server round trip. Local state updates first; the URL follows.
 */
import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseWorkspaceParams, workspaceParamEntries, type WorkspaceUrlState } from './workspace-url-model';

function writeUrl(state: WorkspaceUrlState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('rename');
  for (const [key, value] of Object.entries(workspaceParamEntries(state))) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

export function useWorkspaceUrlState(): readonly [WorkspaceUrlState, (patch: Partial<WorkspaceUrlState>) => void] {
  const params = useSearchParams();
  const [state, setState] = useState<WorkspaceUrlState>(() => parseWorkspaceParams((key) => params?.get(key) ?? null));
  const search = params?.toString() ?? '';
  // Follow external URL changes (a folder favorite link, back/forward) while mounted. Echoes of
  // our own replaceState parse to the same state and are ignored.
  const [seenSearch, setSeenSearch] = useState(search);
  if (seenSearch !== search) {
    setSeenSearch(search);
    const next = parseWorkspaceParams((key) => new URLSearchParams(search).get(key));
    const same =
      state.tab === next.tab &&
      state.q.trim() === next.q.trim() &&
      state.type === next.type &&
      state.sort === next.sort &&
      state.folder === next.folder;
    if (!same) setState(next);
  }
  const update = useCallback((patch: Partial<WorkspaceUrlState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      writeUrl(next);
      return next;
    });
  }, []);
  return [state, update] as const;
}
