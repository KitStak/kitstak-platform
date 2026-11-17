'use client';
/**
 * Read hooks over /api/v1 (React Query). Every hook accepts optional `initialData` so server
 * components can render instantly and the client keeps it fresh (refetch on focus).
 */
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { MeResponse, OrgPerson } from '@/lib/types';

export type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

export const useMe = (opts?: Opts<MeResponse>) =>
  useQuery({ queryKey: qk.me(), queryFn: () => apiGet<MeResponse>(apiPath('me')), staleTime: 30_000, ...opts });

export const usePeople = (opts?: Opts<OrgPerson[]>) =>
  useQuery({ queryKey: qk.people(), queryFn: () => apiGet<OrgPerson[]>(apiPath('people')), staleTime: 5 * 60_000, ...opts });
