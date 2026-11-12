'use client';
/**
 * Client + TanStack Query hooks for `/api/v1/automation-center/*`. Keys live under the board
 * prefix (`['org', orgId, 'board', boardId, …]`) so a board-wide invalidation refreshes them.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, apiRequestWithMeta, type Paginated } from '@/lib/api';
import { useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type {
  AutomationManualRunDto,
  AutomationPreviewDto,
  AutomationUsageDto,
  BoardRunDto,
  CreateWebhookInput,
  RunStatusFilter,
  UpdateWebhookInput,
  WebhookDeliveryDto,
  WebhookDto,
  WebhookSecretDto,
} from '@/server/services/contracts/automations-center';
import type { ColumnDto, GroupDto } from '@/server/services/contracts/dto';

const BASE = '/automation-center';

export interface RunFilters {
  readonly status?: RunStatusFilter;
  readonly automationId?: string;
  readonly since?: string;
}

export const centerKeys = {
  runs: (orgId: string, boardId: string, filters: RunFilters = {}) =>
    [...queryKeys.board(orgId, boardId), 'automation-runs', filters] as const,
  runsRoot: (orgId: string, boardId: string) =>
    [...queryKeys.board(orgId, boardId), 'automation-runs'] as const,
  webhooks: (orgId: string, boardId: string) => [...queryKeys.board(orgId, boardId), 'webhooks'] as const,
  deliveries: (orgId: string, webhookId: string) =>
    ['org', orgId, 'webhook', webhookId, 'deliveries'] as const,
  usage: (orgId: string) => ['org', orgId, 'automation-usage'] as const,
  targetColumns: (orgId: string, boardId: string) =>
    [...queryKeys.board(orgId, boardId), 'target-columns'] as const,
  targetGroups: (orgId: string, boardId: string) =>
    [...queryKeys.board(orgId, boardId), 'target-groups'] as const,
};

async function page<T>(orgId: string, path: string, query: Record<string, string | number | undefined>) {
  const { data, meta } = await apiRequestWithMeta<T[]>(path, { orgId, query });
  return {
    items: data,
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
  } satisfies Paginated<T>;
}

// Runs ----------------------------------------------------------------------------------------

export function useBoardRuns(boardId: string, filters: RunFilters) {
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: centerKeys.runs(orgId, boardId, filters),
    queryFn: ({ pageParam, signal }) =>
      apiRequestWithMeta<BoardRunDto[]>(`${BASE}/boards/${boardId}/runs`, {
        orgId,
        signal,
        query: { cursor: pageParam ?? undefined, limit: 40, ...filters },
      }).then(({ data, meta }) => ({
        items: data,
        nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
      })),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<BoardRunDto>) => last.nextCursor,
    refetchInterval: 30_000,
  });
}

export function useRunAutomation(boardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { automationId: string; itemId: string; dryRun: boolean }) =>
      apiRequest<AutomationPreviewDto | AutomationManualRunDto>(
        `${BASE}/automations/${vars.automationId}/run`,
        {
          orgId,
          method: 'POST',
          body: { itemId: vars.itemId, dryRun: vars.dryRun },
        },
      ),
    onSuccess: (_result, vars) => {
      if (vars.dryRun) return;
      void queryClient.invalidateQueries({ queryKey: centerKeys.runsRoot(orgId, boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.boardAutomations(orgId, boardId) });
    },
  });
}

export function useRetryRun(boardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiRequest<AutomationManualRunDto>(`${BASE}/runs/${runId}/retry`, { orgId, method: 'POST', body: {} }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: centerKeys.runsRoot(orgId, boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.boardAutomations(orgId, boardId) });
    },
  });
}

// Usage ---------------------------------------------------------------------------------------

export function useAutomationUsage() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: centerKeys.usage(orgId),
    queryFn: ({ signal }) => apiRequest<AutomationUsageDto>(`${BASE}/usage`, { orgId, signal }),
    staleTime: 30_000,
    // The org page has no board stream; keep toggles made elsewhere from going stale.
    refetchInterval: 60_000,
  });
}

// Target boards (create_item) -----------------------------------------------------------------

export function useTargetGroups(boardId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: centerKeys.targetGroups(orgId, boardId ?? ''),
    queryFn: () => apiRequest<GroupDto[]>(`/boards/${boardId}/groups`, { orgId }),
    enabled: Boolean(boardId),
    staleTime: 60_000,
  });
}

export function useTargetColumns(boardId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: centerKeys.targetColumns(orgId, boardId ?? ''),
    queryFn: () => apiRequest<ColumnDto[]>(`/boards/${boardId}/columns`, { orgId }),
    enabled: Boolean(boardId),
    staleTime: 60_000,
  });
}

// Webhooks ------------------------------------------------------------------------------------

export function useWebhooks(boardId: string, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: centerKeys.webhooks(orgId, boardId),
    queryFn: ({ signal }) =>
      apiRequest<WebhookDto[]>(`${BASE}/boards/${boardId}/webhooks`, { orgId, signal }),
    enabled,
  });
}

export function useWebhookDeliveries(webhookId: string | null) {
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: centerKeys.deliveries(orgId, webhookId ?? ''),
    queryFn: ({ pageParam }) =>
      page<WebhookDeliveryDto>(orgId, `${BASE}/webhooks/${webhookId}/deliveries`, {
        cursor: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<WebhookDeliveryDto>) => last.nextCursor,
    enabled: Boolean(webhookId),
  });
}

export function useWebhookMutations(boardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = centerKeys.webhooks(orgId, boardId);
  const replace = (webhook: WebhookDto) =>
    queryClient.setQueryData<WebhookDto[]>(key, (list) =>
      list?.map((entry) => (entry.id === webhook.id ? webhook : entry)),
    );
  return {
    create: useMutation({
      mutationFn: (input: CreateWebhookInput) =>
        apiRequest<WebhookSecretDto>(`${BASE}/boards/${boardId}/webhooks`, {
          orgId,
          method: 'POST',
          body: input,
        }),
      onSuccess: (result) =>
        queryClient.setQueryData<WebhookDto[]>(key, (list) => [...(list ?? []), result.webhook]),
    }),
    update: useMutation({
      mutationFn: (vars: { webhookId: string; input: UpdateWebhookInput }) =>
        apiRequest<WebhookDto>(`${BASE}/webhooks/${vars.webhookId}`, {
          orgId,
          method: 'PATCH',
          body: vars.input,
        }),
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<WebhookDto[]>(key);
        queryClient.setQueryData<WebhookDto[]>(key, (list) =>
          list?.map((entry) =>
            entry.id === vars.webhookId
              ? {
                  ...entry,
                  ...(vars.input.enabled !== undefined && { enabled: vars.input.enabled }),
                  ...(vars.input.events !== undefined && { events: vars.input.events }),
                  ...(vars.input.url !== undefined && { url: vars.input.url }),
                }
              : entry,
          ),
        );
        return { previous };
      },
      onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.previous),
      onSuccess: replace,
    }),
    rotate: useMutation({
      mutationFn: (webhookId: string) =>
        apiRequest<WebhookSecretDto>(`${BASE}/webhooks/${webhookId}/rotate`, {
          orgId,
          method: 'POST',
          body: {},
        }),
      onSuccess: (result) => replace(result.webhook),
    }),
    test: useMutation({
      mutationFn: (webhookId: string) =>
        apiRequest<WebhookDeliveryDto>(`${BASE}/webhooks/${webhookId}/test`, {
          orgId,
          method: 'POST',
          body: {},
        }),
      onSettled: (_result, _error, webhookId) => {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: centerKeys.deliveries(orgId, webhookId) });
      },
    }),
    remove: useMutation({
      mutationFn: (webhookId: string) =>
        apiRequest<{ id: string }>(`${BASE}/webhooks/${webhookId}`, { orgId, method: 'DELETE' }),
      onMutate: async (webhookId) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<WebhookDto[]>(key);
        queryClient.setQueryData<WebhookDto[]>(key, (list) =>
          list?.filter((entry) => entry.id !== webhookId),
        );
        return { previous };
      },
      onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.previous),
    }),
  };
}
