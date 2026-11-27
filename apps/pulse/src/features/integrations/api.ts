'use client';
/**
 * Data hooks for the integration UI: live sibling records, the search behind the link dialog,
 * the Connected apps status and the list of links. All same origin (`/api/v1/integrations/*`).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import type { LinkTargetType } from '@/lib/constants';
import type { ConnectedAppsDTO, LinkableType, LinkedJobDTO, LiveRecordDTO, RecordOptionDTO } from './types';

export const integrationKeys = {
  root: () => ['integrations'] as const,
  status: () => ['integrations', 'status'] as const,
  links: () => ['integrations', 'links'] as const,
  records: (targets: string) => ['integrations', 'records', targets] as const,
  search: (type: string, q: string) => ['integrations', 'search', type, q] as const,
};

export interface RecordRef {
  readonly type: LinkTargetType;
  readonly id: string;
}

export const recordKey = (ref: RecordRef): string => `${ref.type}:${ref.id}`;

/** The linked records as they are right now. Refreshes on focus and every two minutes. */
export function useLiveRecords(refs: readonly RecordRef[], enabled = true) {
  const targets = [...new Set(refs.map(recordKey))].sort().slice(0, 50).join(',');
  return useQuery({
    queryKey: integrationKeys.records(targets),
    queryFn: () => apiGet<LiveRecordDTO[]>(apiPath('integrations/records', { targets })),
    enabled: enabled && targets.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useRecordSearch(type: LinkableType, q: string, enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.search(type, q),
    queryFn: () => apiGet<RecordOptionDTO[]>(apiPath('integrations/search', { type, q })),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useConnectedApps(initialData?: ConnectedAppsDTO) {
  return useQuery({
    queryKey: integrationKeys.status(),
    queryFn: () => apiGet<ConnectedAppsDTO>(apiPath('integrations/status')),
    initialData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    // A background sync can be running: look again soon while one is.
    refetchInterval: (query) => (query.state.data?.apps.some((app) => app.running) ? 3_000 : 60_000),
  });
}

export function useLinkedJobs(initialData?: LinkedJobDTO[]) {
  return useQuery({
    queryKey: integrationKeys.links(),
    queryFn: () => apiGet<LinkedJobDTO[]>(apiPath('integrations/links')),
    initialData,
    staleTime: 10_000,
  });
}
