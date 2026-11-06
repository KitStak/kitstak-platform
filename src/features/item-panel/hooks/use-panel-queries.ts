'use client';

/** Panel-specific endpoints (`/api/v1/item-panel/*`): subscribers and update readers. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { toastError, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { ItemSubscribersDto, UpdateReaderDto } from '@/server/services/contracts/item-panel';

export const panelKeys = {
  subscribers: (orgId: string, itemId: string) => [...queryKeys.item(orgId, itemId), 'subscribers'] as const,
  readers: (orgId: string, updateId: string) => ['org', orgId, 'update', updateId, 'readers'] as const,
};

export function useItemSubscribers(itemId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: panelKeys.subscribers(orgId, itemId ?? ''),
    queryFn: ({ signal }) =>
      apiRequest<ItemSubscribersDto>(`/item-panel/items/${itemId}/subscribers`, { orgId, signal }),
    enabled: Boolean(itemId),
  });
}

/** Optimistic subscribe / unsubscribe with rollback. */
export function useChangeSubscribers(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = panelKeys.subscribers(orgId, itemId);
  return useMutation({
    mutationFn: (input: { add?: string[]; remove?: string[] }) =>
      apiRequest<ItemSubscribersDto>(`/item-panel/items/${itemId}/subscribers`, {
        orgId,
        method: 'POST',
        body: { add: input.add ?? [], remove: input.remove ?? [] },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const saved = queryClient.getQueryData<ItemSubscribersDto>(key);
      if (saved) {
        const ids = new Set(saved.userIds);
        for (const id of input.add ?? []) ids.add(id);
        for (const id of input.remove ?? []) ids.delete(id);
        queryClient.setQueryData<ItemSubscribersDto>(key, { ...saved, userIds: [...ids] });
      }
      return { saved };
    },
    onError: (error, _input, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not update subscribers');
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
}

export function useUpdateReaders(updateId: string, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: panelKeys.readers(orgId, updateId),
    queryFn: ({ signal }) =>
      apiRequest<UpdateReaderDto[]>(`/item-panel/updates/${updateId}/readers`, { orgId, signal }),
    enabled,
    staleTime: 15_000,
  });
}
