'use client';

/** Workspaces, folders and the sidebar tree. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { WorkspaceDto } from '@/server/services/contracts/dto';
import type {
  CreateFolderInput,
  CreateWorkspaceInput,
  UpdateFolderInput,
  UpdateWorkspaceInput,
} from '@/server/services/contracts/structure-inputs';
import { restore, snapshot, toastError } from './cache';
import { useApi, useOrgId } from './org-context';

export function useWorkspaces() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.workspaces(orgId),
    queryFn: ({ signal }) => api.workspaces.list(signal),
    staleTime: 60_000,
  });
}

export function useWorkspaceTree(workspaceId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.workspaceTree(orgId, workspaceId ?? ''),
    queryFn: ({ signal }) => api.workspaces.tree(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

function useInvalidateWorkspaces() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(orgId) });
}

export function useCreateWorkspace() {
  const api = useApi();
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (input: Partial<CreateWorkspaceInput> & { name: string }) => api.workspaces.create(input),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not create the workspace'),
  });
}

export function useUpdateWorkspace() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: string; input: UpdateWorkspaceInput }) =>
      api.workspaces.update(vars.workspaceId, vars.input),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.workspaces(orgId));
      queryClient.setQueryData<WorkspaceDto[]>(queryKeys.workspaces(orgId), (list) =>
        list?.map((workspace) =>
          workspace.id === vars.workspaceId
            ? {
                ...workspace,
                ...(vars.input.name !== undefined && { name: vars.input.name }),
                ...(vars.input.color !== undefined && { color: vars.input.color }),
                ...(vars.input.icon !== undefined && { icon: vars.input.icon ?? null }),
              }
            : workspace,
        ),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update the workspace');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(orgId) }),
  });
}

export function useDeleteWorkspace() {
  const api = useApi();
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (workspaceId: string) => api.workspaces.remove(workspaceId),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not delete the workspace'),
  });
}

export function useCreateFolder() {
  const api = useApi();
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => api.folders.create(input),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not create the folder'),
  });
}

export function useUpdateFolder() {
  const api = useApi();
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (vars: { folderId: string; input: UpdateFolderInput }) =>
      api.folders.update(vars.folderId, vars.input),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not update the folder'),
  });
}

export function useDeleteFolder() {
  const api = useApi();
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (folderId: string) => api.folders.remove(folderId),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error, 'Could not delete the folder'),
  });
}
