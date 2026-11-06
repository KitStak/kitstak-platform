'use client';
/**
 * Shell data layer: TanStack Query hooks for the sidebar, favorites and the current user.
 * Shapes come from the backend DTO contract (src/server/services/contracts/dto.ts).
 *
 * Endpoints (all under /api/v1, org-scoped with the x-org-id header):
 *   GET    /workspaces                → WorkspaceDto[]
 *   POST   /workspaces                → WorkspaceDto
 *   GET    /workspaces/:id/tree       → WorkspaceTreeDto
 *   POST   /folders                   → FolderDto
 *   POST   /boards                    → BoardSummaryDto
 *   POST   /dashboards                → DashboardSummaryDto
 *   GET    /favorites                 → FavoriteDto[]
 *   POST   /favorites                 → FavoriteDto      { entityType, entityId }
 *   DELETE /favorites/:id             → { id }
 *   GET    /me                        → MeDto (incl. unreadNotifications)
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type {
  BoardKind,
  BoardPrivacy,
  BoardSummaryDto,
  DashboardSummaryDto,
  EntityType,
  FavoriteDto,
  FolderDto,
  MeDto,
  WorkspaceDto,
  WorkspaceTreeDto,
} from '@/server/services/contracts/dto';
import type { LabelColor } from '@/components/ui';
import type { PaletteGroup, PaletteSearchDto } from '@/server/services/shell-search-model';
import type { HomeDto } from '@/server/services/shell-home-model';
import type { FolderIcon as FolderIconName } from '@/server/services/shell-folders-model';

export type {
  BoardKind,
  BoardPrivacy,
  BoardSummaryDto,
  DashboardSummaryDto,
  EntityType,
  FavoriteDto,
  FolderDto,
  MeDto,
  WorkspaceDto,
  WorkspaceTreeDto,
};

/** Query keys owned by the shell. Other features invalidate these after structural changes. */
export const shellKeys = {
  all: (orgId: string) => ['org', orgId] as const,
  workspaces: (orgId: string) => ['org', orgId, 'workspaces'] as const,
  workspaceTree: (orgId: string, workspaceId: string) =>
    ['org', orgId, 'workspaces', workspaceId, 'tree'] as const,
  favorites: (orgId: string) => ['org', orgId, 'favorites'] as const,
  me: (orgId: string) => ['org', orgId, 'me'] as const,
};

const UNREAD_POLL_MS = 60_000;

export function useWorkspaces(orgId: string) {
  return useQuery({
    queryKey: shellKeys.workspaces(orgId),
    queryFn: ({ signal }) => apiRequest<WorkspaceDto[]>('/workspaces', { orgId, signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkspaceTree(orgId: string, workspaceId: string | null) {
  return useQuery({
    queryKey: shellKeys.workspaceTree(orgId, workspaceId ?? 'none'),
    queryFn: ({ signal }) =>
      apiRequest<WorkspaceTreeDto>(`/workspaces/${workspaceId}/tree`, { orgId, signal }),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useFavorites(orgId: string) {
  return useQuery({
    queryKey: shellKeys.favorites(orgId),
    queryFn: ({ signal }) => apiRequest<FavoriteDto[]>('/favorites', { orgId, signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMe(orgId: string) {
  return useQuery({
    queryKey: shellKeys.me(orgId),
    queryFn: ({ signal }) => apiRequest<MeDto>('/me', { orgId, signal }),
    staleTime: 30_000,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export interface ToggleFavoriteInput {
  readonly entityType: EntityType;
  readonly entityId: string;
  /** Present when removing. */
  readonly favoriteId?: string;
  /** Used for the optimistic row. */
  readonly name: string;
  readonly boardKind?: BoardKind | null;
}

/** Add/remove a favorite with an optimistic sidebar update and rollback on failure. */
export function useToggleFavorite(orgId: string) {
  const queryClient = useQueryClient();
  const key = shellKeys.favorites(orgId);
  return useMutation({
    mutationFn: async (input: ToggleFavoriteInput) => {
      if (input.favoriteId) {
        await apiRequest<{ id: string }>(`/favorites/${input.favoriteId}`, { method: 'DELETE', orgId });
        return null;
      }
      return apiRequest<FavoriteDto>('/favorites', {
        method: 'POST',
        orgId,
        body: { entityType: input.entityType, entityId: input.entityId },
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FavoriteDto[]>(key);
      queryClient.setQueryData<FavoriteDto[]>(key, (current = []) =>
        input.favoriteId
          ? current.filter((favorite) => favorite.id !== input.favoriteId)
          : [
              ...current,
              {
                id: `optimistic-${input.entityId}`,
                entityType: input.entityType,
                entityId: input.entityId,
                name: input.name,
                position: '~',
                icon: null,
                boardKind: input.boardKind ?? null,
              },
            ],
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly color: LabelColor;
  readonly kind: 'open' | 'closed';
  readonly description?: string;
  /** Emoji shown in the workspace tile. */
  readonly icon?: string;
}

export function useCreateWorkspace(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      apiRequest<WorkspaceDto>('/workspaces', { method: 'POST', orgId, body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shellKeys.workspaces(orgId) }),
  });
}

export interface CreateFolderInput {
  readonly workspaceId: string;
  readonly parentId?: string | null;
  readonly name: string;
  readonly color?: LabelColor | null;
}

export function useCreateFolder(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) =>
      apiRequest<FolderDto>('/folders', { method: 'POST', orgId, body: input }),
    onSuccess: (folder) =>
      queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, folder.workspaceId) }),
  });
}

export interface CreateBoardInput {
  readonly workspaceId: string;
  readonly folderId?: string | null;
  readonly name: string;
  readonly kind: BoardKind;
  readonly privacy: BoardPrivacy;
  readonly itemTerminology?: string;
  readonly templateId?: string;
}

export function useCreateBoard(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInput) =>
      apiRequest<BoardSummaryDto>('/boards', { method: 'POST', orgId, body: input }),
    onSuccess: (board) =>
      queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, board.workspaceId) }),
  });
}

export interface CreateDashboardInput {
  readonly workspaceId: string;
  readonly name: string;
}

export function useCreateDashboard(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDashboardInput) =>
      apiRequest<DashboardSummaryDto>('/dashboards', { method: 'POST', orgId, body: input }),
    onSuccess: (dashboard) => {
      if (dashboard.workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: shellKeys.workspaceTree(orgId, dashboard.workspaceId),
        });
      }
    },
  });
}

// ------------------------------------------------------------------ palette search + home

export type {
  PaletteBoardDto,
  PaletteDashboardDto,
  PaletteGroup,
  PaletteItemDto,
  PalettePersonDto,
  PaletteSearchDto,
  PaletteWorkspaceDto,
} from '@/server/services/shell-search-model';
export type { HomeDto, HomeRecentDto, HomeUpdateDto, HomeWorkItemDto } from '@/server/services/shell-home-model';

/**
 * Command palette search (`GET /shell/search`). Pass an already-debounced query. While a new
 * query loads, the previous results stay visible (`isPlaceholderData`) so the list never blanks.
 */
export function usePaletteSearch(
  orgId: string,
  query: string,
  enabled: boolean,
  options: { readonly type?: PaletteGroup; readonly limit?: number } = {},
) {
  const q = query.trim();
  const limit = options.limit ?? 6;
  return useQuery({
    queryKey: ['org', orgId, 'shell-search', q, options.type ?? 'all', limit] as const,
    queryFn: ({ signal }) =>
      apiRequest<PaletteSearchDto>('/shell/search', {
        orgId,
        signal,
        query: { q, limit, ...(options.type ? { type: options.type } : {}) },
      }),
    enabled: enabled && q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** Home aggregate (`GET /shell/home`) for the caller's local week. */
export function useShellHome(orgId: string, window: { today: string; weekEnd: string; overdueFrom: string }) {
  return useQuery({
    queryKey: ['org', orgId, 'shell-home', window.today] as const,
    queryFn: ({ signal }) =>
      apiRequest<HomeDto>('/shell/home', {
        orgId,
        signal,
        query: window,
      }),
    staleTime: 30_000,
  });
}

// ------------------------------------------------------------------ folder icons

export type { FolderIcon } from '@/server/services/shell-folders-model';

/** Folder id → custom icon (`GET /shell/folders/icons`); under the workspaces key so realtime refreshes it. */
export function useFolderIcons(orgId: string) {
  return useQuery({
    queryKey: [...shellKeys.workspaces(orgId), 'folder-icons'] as const,
    queryFn: ({ signal }) =>
      apiRequest<Record<string, FolderIconName>>('/shell/folders/icons', {
        orgId,
        signal,
      }),
    staleTime: 5 * 60_000,
  });
}
