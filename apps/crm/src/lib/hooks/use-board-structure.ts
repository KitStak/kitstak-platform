'use client';

/** Board structure: boards, columns, groups, views — optimistic where it matters for UX. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { BoardPayloadDto, ColumnDto, GroupDto, ViewDto } from '@/server/services/contracts/dto';
import type {
  BoardMembersInput,
  CreateBoardInput,
  CreateColumnInput,
  CreateGroupInput,
  CreateViewInput,
  DuplicateBoardInput,
  ListBoardsQuery,
  UpdateBoardInput,
  UpdateColumnInput,
  UpdateGroupInput,
  UpdateViewInput,
} from '@/server/services/contracts/structure-inputs';
import { restore, snapshot, toastError } from './cache';
import { useApi, useOrgId } from './org-context';

function usePayloadPatcher(boardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = queryKeys.boardPayload(orgId, boardId);
  return {
    queryClient,
    orgId,
    snapshot: () => snapshot(queryClient, queryKeys.board(orgId, boardId)),
    patch: (fn: (payload: BoardPayloadDto) => BoardPayloadDto) =>
      queryClient.setQueryData<BoardPayloadDto>(key, (payload) => (payload ? fn(payload) : payload)),
    invalidate: () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
  };
}

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

// Boards ----------------------------------------------------------------------------------------

export function useBoards(query: Partial<ListBoardsQuery> = {}) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.boards(orgId, query),
    queryFn: ({ signal }) => api.boards.list(query, signal),
  });
}

export function useBoardTemplates() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.boardTemplates(orgId),
    queryFn: () => api.boards.templates(),
    staleTime: Infinity,
  });
}

function useInvalidateSidebar() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(orgId) }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'boards'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites(orgId) }),
    ]);
}

export function useCreateBoard() {
  const api = useApi();
  const invalidate = useInvalidateSidebar();
  return useMutation({
    mutationFn: (input: Partial<CreateBoardInput> & { workspaceId: string; name: string }) =>
      api.boards.create(input),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not create the board'),
  });
}

export function useUpdateBoard(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient } = usePayloadPatcher(boardId);
  const invalidate = useInvalidateSidebar();
  return useMutation({
    mutationFn: (input: UpdateBoardInput) => api.boards.update(boardId, input),
    onMutate: async (input) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        board: {
          ...payload.board,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description ?? null }),
          ...(input.privacy !== undefined && { privacy: input.privacy }),
        },
      }));
      return { saved };
    },
    onError: (error, _input, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update the board');
    },
    onSuccess: (board) => {
      patch((payload) => ({ ...payload, board }));
      void invalidate();
    },
  });
}

export function useDuplicateBoard() {
  const api = useApi();
  const invalidate = useInvalidateSidebar();
  return useMutation({
    mutationFn: (vars: { boardId: string; input?: Partial<DuplicateBoardInput> }) =>
      api.boards.duplicate(vars.boardId, vars.input),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not duplicate the board'),
  });
}

export function useBoardLifecycle() {
  const api = useApi();
  const invalidate = useInvalidateSidebar();
  return useMutation({
    mutationFn: (vars: { boardId: string; action: 'archive' | 'unarchive' | 'restore' | 'delete' }) =>
      vars.action === 'delete'
        ? api.boards.remove(vars.boardId)
        : api.boards.lifecycle(vars.boardId, vars.action),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not update the board'),
  });
}

export function useSetBoardMembers(boardId: string) {
  const api = useApi();
  const { patch } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (input: BoardMembersInput) => api.boards.setMembers(boardId, input),
    onSuccess: (board) => patch((payload) => ({ ...payload, board })),
    onError: (error) => toastError(error, 'Could not update board members'),
  });
}

// Columns ---------------------------------------------------------------------------------------

export function useCreateColumn(boardId: string) {
  const api = useApi();
  const { patch } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (input: Partial<CreateColumnInput> & Pick<CreateColumnInput, 'title' | 'type'>) =>
      api.columns.create(boardId, input),
    onSuccess: (column) =>
      patch((payload) => ({ ...payload, columns: [...payload.columns, column].sort(byPosition) })),
    onError: (error) => toastError(error, 'Could not add the column'),
  });
}

/** Rename / resize / hide / reorder / settings — applied optimistically. */
export function useUpdateColumn(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient, invalidate } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (vars: { columnId: string; input: UpdateColumnInput; optimisticPosition?: string }) =>
      api.columns.update(boardId, vars.columnId, vars.input),
    onMutate: async (vars) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        columns: payload.columns
          .map((column): ColumnDto =>
            column.id === vars.columnId
              ? {
                  ...column,
                  ...(vars.input.title !== undefined && { title: vars.input.title }),
                  ...(vars.input.width !== undefined && { width: vars.input.width }),
                  ...(vars.input.hidden !== undefined && { hidden: vars.input.hidden }),
                  ...(vars.optimisticPosition && { position: vars.optimisticPosition }),
                }
              : column,
          )
          .sort(byPosition),
      }));
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update the column');
    },
    onSuccess: (column, vars) => {
      patch((payload) => ({
        ...payload,
        columns: payload.columns.map((entry) => (entry.id === column.id ? column : entry)).sort(byPosition),
      }));
      // Type / label changes can rewrite cell values server-side.
      if (vars.input.type !== undefined || vars.input.settings !== undefined) void invalidate();
    },
  });
}

export function useDeleteColumn(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (columnId: string) => api.columns.remove(boardId, columnId),
    onMutate: async (columnId) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        columns: payload.columns.filter((column) => column.id !== columnId),
      }));
      return { saved };
    },
    onError: (error, _id, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not delete the column');
    },
  });
}

export function useRestoreColumn(boardId: string) {
  const api = useApi();
  const { patch } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (columnId: string) => api.columns.restore(boardId, columnId),
    onSuccess: (column) =>
      patch((payload) => ({
        ...payload,
        columns: [...payload.columns.filter((entry) => entry.id !== column.id), column].sort(byPosition),
      })),
    onError: (error) => toastError(error, 'Could not restore the column'),
  });
}

// Groups ----------------------------------------------------------------------------------------

export function useCreateGroup(boardId: string) {
  const api = useApi();
  const { patch } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.groups.create(boardId, input),
    onSuccess: (group) =>
      patch((payload) => ({ ...payload, groups: [...payload.groups, group].sort(byPosition) })),
    onError: (error) => toastError(error, 'Could not add the group'),
  });
}

export function useUpdateGroup(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient, invalidate } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (vars: { groupId: string; input: UpdateGroupInput; optimisticPosition?: string }) =>
      api.groups.update(boardId, vars.groupId, vars.input),
    onMutate: async (vars) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        groups: payload.groups
          .map((group): GroupDto =>
            group.id === vars.groupId
              ? {
                  ...group,
                  ...(vars.input.title !== undefined && { title: vars.input.title }),
                  ...(vars.input.color !== undefined && { color: vars.input.color }),
                  ...(vars.input.collapsedDefault !== undefined && {
                    collapsedDefault: vars.input.collapsedDefault,
                  }),
                  ...(vars.optimisticPosition && { position: vars.optimisticPosition }),
                }
              : group,
          )
          .filter((group) => !(vars.input.targetBoardId && group.id === vars.groupId))
          .sort(byPosition),
      }));
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update the group');
    },
    onSuccess: (group, vars) => {
      if (vars.input.targetBoardId) void invalidate();
      else
        patch((payload) => ({
          ...payload,
          groups: payload.groups.map((entry) => (entry.id === group.id ? group : entry)).sort(byPosition),
        }));
    },
  });
}

export function useDuplicateGroup(boardId: string) {
  const api = useApi();
  const { invalidate } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (groupId: string) => api.groups.duplicate(boardId, groupId),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not duplicate the group'),
  });
}

export function useRemoveGroup(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient, invalidate } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (vars: { groupId: string; mode: 'archive' | 'delete' }) =>
      vars.mode === 'archive'
        ? api.groups.archive(boardId, vars.groupId, true)
        : api.groups.remove(boardId, vars.groupId),
    onMutate: async (vars) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        groups: payload.groups.filter((group) => group.id !== vars.groupId),
        items: payload.items.filter((item) => item.groupId !== vars.groupId),
      }));
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not remove the group');
    },
    onSettled: () => invalidate(),
  });
}

// Views -----------------------------------------------------------------------------------------

export function useCreateView(boardId: string) {
  const api = useApi();
  const { patch } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (input: Partial<CreateViewInput> & Pick<CreateViewInput, 'type' | 'name'>) =>
      api.views.create(boardId, input),
    onSuccess: (view) =>
      patch((payload) => ({ ...payload, views: [...payload.views, view].sort(byPosition) })),
    onError: (error) => toastError(error, 'Could not create the view'),
  });
}

/** View config edits (filters, sort, hidden columns...) are applied optimistically. */
export function useUpdateView(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (vars: { viewId: string; input: Partial<UpdateViewInput> }) =>
      api.views.update(vars.viewId, vars.input),
    onMutate: async (vars) => {
      const saved = await save();
      patch((payload) => ({
        ...payload,
        views: payload.views.map((view): ViewDto => {
          if (view.id !== vars.viewId) return { ...view, ...(vars.input.isDefault && { isDefault: false }) };
          const config = vars.input.config
            ? vars.input.mergeConfig === false
              ? (vars.input.config as Record<string, unknown>)
              : { ...view.config, ...(vars.input.config as Record<string, unknown>) }
            : view.config;
          return {
            ...view,
            config,
            ...(vars.input.name !== undefined && { name: vars.input.name }),
            ...(vars.input.isDefault !== undefined && { isDefault: vars.input.isDefault }),
          };
        }),
      }));
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not save the view');
    },
    onSuccess: (view) =>
      patch((payload) => ({
        ...payload,
        views: payload.views.map((entry) => (entry.id === view.id ? view : entry)),
      })),
  });
}

export function useDeleteView(boardId: string) {
  const api = useApi();
  const { snapshot: save, patch, queryClient } = usePayloadPatcher(boardId);
  return useMutation({
    mutationFn: (viewId: string) => api.views.remove(viewId),
    onMutate: async (viewId) => {
      const saved = await save();
      patch((payload) => ({ ...payload, views: payload.views.filter((view) => view.id !== viewId) }));
      return { saved };
    },
    onError: (error, _id, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not delete the view');
    },
  });
}
