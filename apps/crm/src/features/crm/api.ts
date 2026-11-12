'use client';
/**
 * CRM data layer. Keys live under `['org', orgId, 'crm', …]`; every write invalidates the CRM
 * tree plus the affected boards so tables, kanban and item panels refresh too.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { toastError } from '@/lib/hooks/cache';
import { useOrgId } from '@/lib/hooks/org-context';
import type {
  Account360Dto,
  ActivityOptionsDto,
  Contact360Dto,
  ConversionPreviewDto,
  ConversionResultDto,
  ConvertLeadInput,
  CrmBoardsDto,
  CrmRecordsDto,
  DuplicatesDto,
  LoggedActivityDto,
  MergeResultDto,
  PipelineDto,
  PipelinePeriod,
  PipelineSettingsInput,
} from '@/server/services/crm-contracts';
import type { CoreCustomerDto, WmsLinkDto } from '@/server/services/wms-link-contracts';
import type { z } from 'zod';
import type { logActivitySchema } from '@/server/services/crm-contracts';

export type LogActivityRequest = z.input<typeof logActivitySchema>;

export const crmKeys = {
  root: (orgId: string) => ['org', orgId, 'crm'] as const,
  boards: (orgId: string) => ['org', orgId, 'crm', 'boards'] as const,
  pipeline: (orgId: string, params: PipelineParams) =>
    ['org', orgId, 'crm', 'pipeline', { boardId: params.boardId ?? null, owner: params.owner ?? null, period: params.period }] as const,
  record: (orgId: string, kind: 'contacts' | 'accounts', itemId: string) => ['org', orgId, 'crm', kind, itemId] as const,
  records: (orgId: string, kind: 'contacts' | 'accounts') => ['org', orgId, 'crm', 'records', kind] as const,
  activityOptions: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'activity-options', itemId] as const,
  conversion: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'conversion', itemId] as const,
  duplicates: (orgId: string, kind: 'contacts' | 'accounts') => ['org', orgId, 'crm', 'duplicates', kind] as const,
  wmsLink: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'wms-link', itemId] as const,
  wmsCustomers: (orgId: string) => ['org', orgId, 'crm', 'wms-customers'] as const,
};

export interface PipelineParams {
  readonly boardId?: string;
  readonly owner?: string;
  readonly period: PipelinePeriod;
}

function invalidateCrm(queryClient: QueryClient, orgId: string, boardIds: readonly (string | null | undefined)[] = []) {
  void queryClient.invalidateQueries({ queryKey: crmKeys.root(orgId) });
  for (const boardId of new Set(boardIds)) {
    if (boardId) void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'board', boardId] });
  }
  void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'item'] });
}

export function useCrmBoards() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.boards(orgId),
    queryFn: ({ signal }) => apiRequest<CrmBoardsDto>('/crm/boards', { orgId, signal }),
    staleTime: 60_000,
  });
}

export function usePipeline(params: PipelineParams) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.pipeline(orgId, params),
    queryFn: ({ signal }) =>
      apiRequest<PipelineDto>('/crm/pipeline', {
        orgId,
        signal,
        query: { boardId: params.boardId, owner: params.owner, period: params.period },
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Save probabilities / quotas / stale days with an optimistic patch of the cockpit cache. */
export function useSavePipelineSettings(params: PipelineParams) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = crmKeys.pipeline(orgId, params);
  return useMutation({
    mutationFn: (input: PipelineSettingsInput) =>
      apiRequest<unknown>('/crm/pipeline/settings', { orgId, method: 'PUT', body: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PipelineDto>(key);
      if (previous) {
        queryClient.setQueryData<PipelineDto>(key, {
          ...previous,
          settings: {
            ...previous.settings,
            ...(input.stageProbabilities && { stageProbabilities: input.stageProbabilities, customized: true }),
            ...(input.quotas && { quotas: input.quotas }),
            ...(input.staleDays !== undefined && { staleDays: input.staleDays }),
          },
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toastError(error, 'Couldn’t save pipeline settings');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: crmKeys.root(orgId) }),
  });
}

/** Flat records list for the /crm/contacts and /crm/accounts index pages. */
export function useCrmRecords(kind: 'contacts' | 'accounts') {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.records(orgId, kind),
    queryFn: ({ signal }) => apiRequest<CrmRecordsDto>(`/crm/${kind}`, { orgId, signal }),
    staleTime: 30_000,
  });
}

export function useRecord360<K extends 'contacts' | 'accounts'>(kind: K, itemId: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.record(orgId, kind, itemId),
    queryFn: ({ signal }) =>
      apiRequest<K extends 'contacts' ? Contact360Dto : Account360Dto>(`/crm/${kind}/${itemId}`, { orgId, signal }),
    staleTime: 15_000,
    retry: (count, error) => count < 2 && !(error as { status?: number }).status?.toString().startsWith('4'),
  });
}

export function useActivityOptions(itemId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.activityOptions(orgId, itemId ?? 'none'),
    queryFn: ({ signal }) => apiRequest<ActivityOptionsDto>(`/crm/activity-options/${itemId}`, { orgId, signal }),
    enabled: Boolean(itemId),
    staleTime: 30_000,
  });
}

export function useLogActivity() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LogActivityRequest) =>
      apiRequest<LoggedActivityDto>('/crm/activities', { orgId, method: 'POST', body: input }),
    onSuccess: (result) => invalidateCrm(queryClient, orgId, [result.boardId]),
    // Callers show one contextual toast with Retry; suppress the generic mutation-cache toast.
    onError: () => undefined,
  });
}

export function useConversionPreview(itemId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.conversion(orgId, itemId ?? 'none'),
    queryFn: ({ signal }) =>
      apiRequest<ConversionPreviewDto>(`/crm/leads/${itemId}/conversion`, { orgId, signal }),
    enabled: Boolean(itemId),
    staleTime: 0,
  });
}

export function useConvertLead(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConvertLeadInput) =>
      apiRequest<ConversionResultDto>(`/crm/leads/${itemId}/convert`, { orgId, method: 'POST', body: input }),
    onSuccess: (result) => {
      // Mark the cached preview as converted right away so re-opening the dialog shows
      // "Already converted" even before the refetch lands.
      queryClient.setQueryData<ConversionPreviewDto>(crmKeys.conversion(orgId, itemId), (current) =>
        current
          ? {
              ...current,
              converted: {
                at: new Date().toISOString(),
                accountId: result.account.id,
                contactId: result.contact.id,
                dealId: result.deal?.id ?? null,
              },
            }
          : current,
      );
      invalidateCrm(queryClient, orgId, [result.lead.boardId, result.account.boardId, result.contact.boardId, result.deal?.boardId]);
    },
    // The wizard renders the error inline; skip the global "Couldn't save your change" toast.
    onError: () => undefined,
  });
}

/** The WMS client (core customer) linked to an account board item. */
export function useWmsLink(itemId: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.wmsLink(orgId, itemId),
    queryFn: ({ signal }) => apiRequest<WmsLinkDto>(`/crm/accounts/${itemId}/wms-link`, { orgId, signal }),
    staleTime: 30_000,
  });
}

/** Core customers available to link (the combobox filters client-side). */
export function useWmsCustomers(enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.wmsCustomers(orgId),
    queryFn: ({ signal }) => apiRequest<CoreCustomerDto[]>('/crm/wms/customers', { orgId, signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** Link / unlink (`coreCustomerId: null`) an account item to a core customer. */
export function useSetWmsLink(itemId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (coreCustomerId: string | null) =>
      apiRequest<WmsLinkDto>(`/crm/accounts/${itemId}/wms-link`, { orgId, method: 'PUT', body: { coreCustomerId } }),
    onSuccess: (result) => queryClient.setQueryData(crmKeys.wmsLink(orgId, itemId), result),
    onError: (error) => toastError(error, 'Couldn’t update the WMS link'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: crmKeys.wmsLink(orgId, itemId) }),
  });
}

export function useDuplicates(kind: 'contacts' | 'accounts') {
  const orgId = useOrgId();
  return useQuery({
    queryKey: crmKeys.duplicates(orgId, kind),
    queryFn: ({ signal }) => apiRequest<DuplicatesDto>('/crm/duplicates', { orgId, signal, query: { kind } }),
    staleTime: 30_000,
  });
}

/** Optimistically drop a cluster from the list (merge / dismiss), rolling back on failure. */
function useClusterMutation<TVars extends { kind: 'contacts' | 'accounts' }, TResult>(
  path: string,
  clusterKeyOf: (vars: TVars) => string,
  errorTitle: string,
) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars & { readonly clusterKey?: string }) => {
      const body = Object.fromEntries(Object.entries(vars).filter(([key]) => key !== 'clusterKey'));
      return apiRequest<TResult>(path, { orgId, method: 'POST', body });
    },
    onMutate: async (vars) => {
      const key = crmKeys.duplicates(orgId, vars.kind);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DuplicatesDto>(key);
      const clusterKey = vars.clusterKey ?? clusterKeyOf(vars);
      if (previous) {
        queryClient.setQueryData<DuplicatesDto>(key, {
          ...previous,
          clusters: previous.clusters.filter((cluster) => cluster.key !== clusterKey),
        });
      }
      return { previous, key };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toastError(error, errorTitle);
    },
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.duplicates(orgId, vars.kind) });
    },
  });
}

export function useMergeDuplicates() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const mutation = useClusterMutation<
    { kind: 'contacts' | 'accounts'; primaryId: string; duplicateIds: string[]; fieldChoices?: Record<string, string> },
    MergeResultDto
  >('/crm/duplicates/merge', (vars) => vars.primaryId, 'Couldn’t merge the duplicates');
  return {
    ...mutation,
    afterSuccess: (result: MergeResultDto) => invalidateCrm(queryClient, orgId, [result.primary.boardId]),
    /** Lossless undo: restores the duplicates and reverts the primary's merged fields and links. */
    restore: (itemIds: readonly string[], primaryId?: string) =>
      apiRequest<{ restored: number; reverted: boolean }>('/crm/duplicates/restore', {
        orgId,
        method: 'POST',
        body: { itemIds, primaryId },
      }).then((result) => {
        invalidateCrm(queryClient, orgId);
        return result;
      }),
  };
}

export function useDismissDuplicates() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const mutation = useClusterMutation<{ kind: 'contacts' | 'accounts'; itemIds: string[]; undo?: boolean }, { dismissed: number }>(
    '/crm/duplicates/dismiss',
    () => '',
    'Couldn’t update duplicates',
  );
  return {
    ...mutation,
    undo: (kind: 'contacts' | 'accounts', itemIds: string[]) =>
      apiRequest('/crm/duplicates/dismiss', { orgId, method: 'POST', body: { kind, itemIds, undo: true } }).then(() =>
        queryClient.invalidateQueries({ queryKey: crmKeys.duplicates(orgId, kind) }),
      ),
  };
}
