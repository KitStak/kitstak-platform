'use client';
/**
 * Data hooks for the item panel's Projects tab (KitStak Projects work linked to a record).
 * Server: src/server/services/projects-bridge.ts via /api/v1/crm/items/:id/projects.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BridgeTask } from '@kitstak/pm-bridge/types';
import { apiRequest } from '@/lib/api';
import { toastError } from '@/lib/hooks/cache';
import { useOrgId } from '@/lib/hooks/org-context';
import type {
  CreateItemTaskInput,
  ItemProjectsDto,
  ProjectOptionsDto,
} from '@/server/services/projects-bridge';

export const projectsKeys = {
  item: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'projects', 'item', itemId] as const,
  options: (orgId: string) => ['org', orgId, 'crm', 'projects', 'options'] as const,
};

/** Linked projects/tasks for one record. Refreshes when the tab regains focus (work changes in Projects). */
export function useItemProjects(itemId: string | null, enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: projectsKeys.item(orgId, itemId ?? ''),
    queryFn: ({ signal }) => apiRequest<ItemProjectsDto>(`/crm/items/${itemId}/projects`, { orgId, signal }),
    enabled: enabled && Boolean(itemId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Projects the user can add tasks to (with their statuses) + the people they can assign. */
export function useProjectOptions(enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: projectsKeys.options(orgId),
    queryFn: ({ signal }) => apiRequest<ProjectOptionsDto>('/crm/projects/options', { orgId, signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateItemTask(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemTaskInput) =>
      apiRequest<BridgeTask>(`/crm/items/${itemId}/projects`, { orgId, method: 'POST', body: input }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: projectsKeys.item(orgId, itemId) }),
  });
}

export function useLinkItemProject(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      apiRequest<{ linkId: string }>(`/crm/items/${itemId}/projects/links`, {
        orgId,
        method: 'POST',
        body: { projectId },
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: projectsKeys.item(orgId, itemId) }),
  });
}

export function useUnlinkItemWork(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiRequest<{ removed: boolean }>(`/crm/items/${itemId}/projects/links/${linkId}`, {
        orgId,
        method: 'DELETE',
      }),
    onError: (error) => toastError(error, 'Couldn’t unlink it'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: projectsKeys.item(orgId, itemId) }),
  });
}
