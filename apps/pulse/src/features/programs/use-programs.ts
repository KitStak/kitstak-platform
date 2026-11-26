'use client';
/**
 * Read hooks for the program tracker (`/api/v1/programs/**`), one per endpoint, keyed under
 * `qk.programsRoot()` so a track or convert invalidates them all. Each takes `initialData` from
 * the server render, so the first paint has numbers and the client keeps them fresh.
 */
import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import type { ProgramDaysDTO, ProgramLaborDTO, ProgramListDTO, ProgramMonthDTO, ProgramMonthsDTO, ProgramVariantsDTO } from '@/lib/program-types';
import { qk } from '@/lib/query-keys';

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

const FRESH = 30_000;

const one = (key: string, tail = ''): string => `programs/${encodeURIComponent(key)}${tail}`;

/** The Programs list for a month (`''` is this month). */
export const useProgramList = (month: string, opts?: Opts<ProgramListDTO>) =>
  useQuery({ queryKey: qk.programList(month), queryFn: () => apiGet<ProgramListDTO>(apiPath('programs', { month: month || undefined })), staleTime: FRESH, placeholderData: keepPreviousData, ...opts });

export const useProgramMonth = (key: string, month: string, opts?: Opts<ProgramMonthDTO>) =>
  useQuery({ queryKey: qk.program(key, month), queryFn: () => apiGet<ProgramMonthDTO>(apiPath(one(key), { month })), staleTime: FRESH, placeholderData: keepPreviousData, ...opts });

export const useProgramVariants = (key: string, month: string, opts?: Opts<ProgramVariantsDTO>) =>
  useQuery({ queryKey: qk.programVariants(key, month), queryFn: () => apiGet<ProgramVariantsDTO>(apiPath(one(key, '/variants'), { month })), staleTime: FRESH, placeholderData: keepPreviousData, ...opts });

export const useProgramDays = (key: string, month: string, opts?: Opts<ProgramDaysDTO>) =>
  useQuery({ queryKey: qk.programDays(key, month), queryFn: () => apiGet<ProgramDaysDTO>(apiPath(one(key, '/days'), { month })), staleTime: FRESH, placeholderData: keepPreviousData, ...opts });

export const useProgramLabor = (key: string, month: string, opts?: Opts<ProgramLaborDTO>) =>
  useQuery({ queryKey: qk.programLabor(key, month), queryFn: () => apiGet<ProgramLaborDTO>(apiPath(one(key, '/labor'), { month })), staleTime: FRESH, placeholderData: keepPreviousData, ...opts });

/** The By month tab: `from` and `to` are `YYYY-MM` (the server reads the last 12 months when both are blank). */
export const useProgramMonths = (key: string, from: string, to: string, opts?: Opts<ProgramMonthsDTO>) =>
  useQuery({ queryKey: qk.programMonths(key, from, to), queryFn: () => apiGet<ProgramMonthsDTO>(apiPath(one(key, '/months'), { from: from || undefined, to: to || undefined })), staleTime: FRESH, ...opts });
