'use client';
/**
 * Data layer for the Getting-started guide card (and the Help-menu "Setup guide" entry).
 *
 *   GET  /setup-guide → SetupGuideDto (live-derived step state)
 *   POST /setup-guide → SetupGuideDto ({ action: skip|unskip|dismiss|restore, stepKey? })
 *
 * The POST returns the fresh guide state, so mutations write it straight into the
 * cache instead of waiting on a refetch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui';
import type { SetupGuideActionInput, SetupGuideDto } from '@/server/services/setup-guide-model';

export type { SetupGuideDto, SetupGuideStepDto } from '@/server/services/setup-guide-model';

const STALE_MS = 30_000;

export function useSetupGuide(orgId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.setupGuide(orgId),
    queryFn: ({ signal }) => apiRequest<SetupGuideDto>('/setup-guide', { orgId, signal }),
    staleTime: STALE_MS,
    enabled,
  });
}

export function useSetupGuideAction(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupGuideActionInput) =>
      apiRequest<SetupGuideDto>('/setup-guide', { orgId, method: 'POST', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.setupGuide(orgId), data);
    },
    onError: () => {
      toast.error('Couldn’t update the setup guide', 'Please try again.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupGuide(orgId) });
    },
  });
}
