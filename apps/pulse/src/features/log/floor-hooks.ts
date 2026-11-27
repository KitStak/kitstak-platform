'use client';
/**
 * Read hooks for the production team's own endpoints. Keys start with `streams` or `standards`,
 * so the usual invalidation after a write (`qk.streams()`, `qk.standards()`) refreshes them too.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import type { Opts } from '@/lib/hooks/use-data';
import type { DayQueueDTO, DeviceLinkDTO, PaceBoardDTO, PaceSuggestionRowDTO, PunchDTO } from '@/lib/types';

export const floorKeys = {
  reviewQueue: (siteId?: string | null, days?: number, month?: string | null) =>
    ['streams', 'review-queue', siteId ?? 'all', days ?? 14, month ?? 'recent'] as const,
  paceBoard: (params: { from: string; to: string; siteId?: string | null }) =>
    ['streams', 'pace-board', params] as const,
  suggestions: () => ['standards', 'suggest-all'] as const,
  deviceLinks: (kind?: string | null) => ['device-links', kind ?? 'all'] as const,
  punches: (params: Record<string, unknown>) => ['streams', 'punches', params] as const,
  myPin: () => ['kiosk', 'my-pin'] as const,
};

export const useReviewQueue = (
  params: { siteId?: string | null; days?: number; month?: string | null } = {},
  opts?: Opts<DayQueueDTO[]>,
) =>
  useQuery({
    queryKey: floorKeys.reviewQueue(params.siteId, params.days, params.month),
    queryFn: () => apiGet<DayQueueDTO[]>(apiPath('review-queue', { site: params.siteId, days: params.days, month: params.month })),
    staleTime: 15_000,
    ...opts,
  });

export const usePaceBoard = (
  params: { from: string; to: string; siteId?: string | null },
  opts?: Opts<PaceBoardDTO>,
) =>
  useQuery({
    queryKey: floorKeys.paceBoard(params),
    queryFn: () =>
      apiGet<PaceBoardDTO>(apiPath('pace-board', { from: params.from, to: params.to, site: params.siteId })),
    staleTime: 30_000,
    ...opts,
  });

export const usePaceSuggestions = (opts?: Opts<PaceSuggestionRowDTO[]>) =>
  useQuery({
    queryKey: floorKeys.suggestions(),
    queryFn: () => apiGet<PaceSuggestionRowDTO[]>(apiPath('standards/suggest-all')),
    staleTime: 60_000,
    ...opts,
  });

export const useDeviceLinks = (kind?: 'kiosk' | 'wall' | null, opts?: Opts<DeviceLinkDTO[]>) =>
  useQuery({
    queryKey: floorKeys.deviceLinks(kind),
    queryFn: () => apiGet<DeviceLinkDTO[]>(apiPath('device-links', { kind })),
    staleTime: 30_000,
    retry: false,
    ...opts,
  });

export const usePunches = (
  params: { siteId?: string | null; from?: string | null; to?: string | null; limit?: number } = {},
  opts?: Opts<PunchDTO[]>,
) =>
  useQuery({
    queryKey: floorKeys.punches(params),
    queryFn: () =>
      apiGet<PunchDTO[]>(
        apiPath('punches', { site: params.siteId, from: params.from, to: params.to, limit: params.limit }),
      ),
    staleTime: 15_000,
    ...opts,
  });

export const useMyKioskPin = (opts?: Opts<{ hasKioskPin: boolean; canUseKiosk: boolean }>) =>
  useQuery({
    queryKey: floorKeys.myPin(),
    queryFn: () => apiGet<{ hasKioskPin: boolean; canUseKiosk: boolean }>(apiPath('kiosk/my-pin')),
    staleTime: 60_000,
    ...opts,
  });
