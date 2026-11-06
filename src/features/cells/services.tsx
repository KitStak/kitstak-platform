'use client';

/**
 * Cell services context + the production implementation built on the shared API hooks.
 * Board surfaces (table, item panel, kanban cards) wrap their cells with:
 *
 *   const services = useBoardCellServices(boardId, items);
 *   <CellServicesProvider value={services}>…</CellServicesProvider>
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useApi, useBoardFiles, useOrgId, useTeams, useUpdateColumn } from '@/lib/hooks';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { fetchLabelUsage, fetchLinkedItems, saveLabelsRequest } from './lib/cells-api';
import { countLabelUsage } from './lib/labels';
import { collectLinkedIds } from './lib/values';
import type { CellServices, ConnectCandidate, LabelChange } from './types';

const EMPTY_SERVICES: CellServices = {};
const CellServicesContext = createContext<CellServices>(EMPTY_SERVICES);

export function CellServicesProvider({ value, children }: { readonly value: CellServices; readonly children: ReactNode }) {
  return <CellServicesContext.Provider value={value}>{children}</CellServicesContext.Provider>;
}

export function useCellServices(): CellServices {
  return useContext(CellServicesContext);
}

export function useNow(): Date {
  const { now } = useCellServices();
  return now ? now() : new Date();
}

/** Query key namespace for cell-module data, scoped under the org tree. */
export const cellKeys = {
  linked: (orgId: string, ids: readonly string[]) => ['org', orgId, 'cells', 'linked-items', ids] as const,
};

/**
 * Board-wide label usage counts (server aggregate when available, otherwise counted from the
 * items the host passed). `loading` is true while the server count is in flight.
 */
export function useLabelUsage(column: ColumnDto, fallbackItems: readonly ItemDto[]): {
  readonly usage: ReadonlyMap<string, number>;
  readonly loading: boolean;
} {
  const services = useCellServices();
  const fetcher = services.labelUsage;
  const query = useQuery({
    queryKey: ['cells', 'label-usage', services.scopeKey ?? 'local', column.id],
    queryFn: () => (fetcher ? fetcher(column) : Promise.resolve({})),
    enabled: Boolean(fetcher),
    staleTime: 0,
  });
  const local = useMemo(() => countLabelUsage(fallbackItems, column.key), [column.key, fallbackItems]);
  if (!fetcher || !query.data) return { usage: local, loading: Boolean(fetcher) && query.isLoading };
  return { usage: new Map(Object.entries(query.data)), loading: false };
}

/** Production services for a board. `items` = the board's loaded items (for suggestions). */
export function useBoardCellServices(boardId: string, items: readonly ItemDto[] = []): CellServices {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const teams = useTeams();
  const files = useBoardFiles(boardId);
  const updateColumn = useUpdateColumn(boardId);

  // Linked item names: one batched, org-scoped request for every id the loaded items reference.
  const linkedIds = useMemo(() => collectLinkedIds(items), [items]);
  const linked = useQuery({
    queryKey: cellKeys.linked(orgId, linkedIds),
    queryFn: ({ signal }) => fetchLinkedItems(orgId, linkedIds, signal),
    enabled: linkedIds.length > 0,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  // Names learned from the picker this session (shown before the board refetches).
  const [learned, setLearned] = useState<ReadonlyMap<string, ConnectCandidate>>(() => new Map());
  const rememberLinkedItems = useCallback((candidates: readonly ConnectCandidate[]) => {
    setLearned((current) => {
      if (candidates.every((candidate) => current.get(candidate.id)?.name === candidate.name)) return current;
      const next = new Map(current);
      for (const candidate of candidates) next.set(candidate.id, candidate);
      return next;
    });
  }, []);
  const linkedItems = useMemo(() => {
    const map = new Map<string, ConnectCandidate>(learned);
    for (const entry of linked.data ?? []) map.set(entry.id, entry);
    return map;
  }, [learned, linked.data]);

  const uploadFile = useCallback(
    async (item: ItemDto, column: ColumnDto, file: File) => {
      const uploaded = await api.items.upload(item.id, file, { columnKey: column.key });
      await queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) });
      return uploaded;
    },
    [api, boardId, orgId, queryClient],
  );

  const searchItems = useCallback(
    async (query: string, boardIds: readonly string[], signal?: AbortSignal): Promise<ConnectCandidate[]> => {
      const q = query.trim();
      if (boardIds.length > 0) {
        const pages = await Promise.all(
          boardIds.map((target) => api.items.list(target, { q: q || undefined, limit: 30 }, signal)),
        );
        const found = pages.flatMap((page) => page.items);
        if (found.length === 0) return [];
        // Fill board + group names so same-named items on different boards are distinguishable.
        const names = await fetchLinkedItems(orgId, found.map((entry) => entry.id), signal);
        const byId = new Map(names.map((entry) => [entry.id, entry]));
        return found.map((entry) => ({
          id: entry.id,
          name: entry.name,
          boardId: entry.boardId,
          boardName: byId.get(entry.id)?.boardName ?? null,
          groupTitle: byId.get(entry.id)?.groupTitle ?? null,
        }));
      }
      if (!q) return [];
      const results = await api.search(q, { types: ['item'], limit: 25 }, signal);
      return results.map((result) => ({
        id: result.itemId ?? result.id,
        name: result.title,
        boardId: result.boardId,
        boardName: result.boardName,
        groupTitle: result.groupTitle,
      }));
    },
    [api, orgId],
  );

  const refreshBoard = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'item'] }),
    ]);
  }, [boardId, orgId, queryClient]);

  // Reassignment + label save happen server-side in one transaction across the whole board.
  const saveLabels = useCallback(
    async (column: ColumnDto, change: LabelChange) => {
      await saveLabelsRequest(orgId, boardId, column.id, change);
      await refreshBoard();
    },
    [boardId, orgId, refreshBoard],
  );

  const labelUsage = useCallback(
    (column: ColumnDto) => fetchLabelUsage(orgId, boardId, column.id),
    [boardId, orgId],
  );

  const saveColumnSettings = useCallback(
    async (column: ColumnDto, settings: unknown) => {
      await updateColumn.mutateAsync({ columnId: column.id, input: { settings: settings as never } });
    },
    [updateColumn],
  );

  return useMemo(
    () => ({
      scopeKey: `${orgId}:${boardId}`,
      teams: teams.data,
      files: files.data,
      filesLoading: files.isLoading,
      uploadFile,
      fileUrl: (fileId: string, download?: boolean) => api.files.url(fileId, download),
      searchItems,
      linkedItems,
      linkedItemsLoading: linked.isLoading,
      rememberLinkedItems,
      saveLabels,
      labelUsage,
      saveColumnSettings,
      boardItems: items,
    }),
    [
      api,
      boardId,
      files.data,
      files.isLoading,
      items,
      labelUsage,
      linked.isLoading,
      linkedItems,
      orgId,
      rememberLinkedItems,
      saveColumnSettings,
      saveLabels,
      searchItems,
      teams.data,
      uploadFile,
    ],
  );
}
