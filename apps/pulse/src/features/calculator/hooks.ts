'use client';
/** Read hooks of the calculator (React Query over `/api/v1/quotes`). */
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import type { Opts } from '@/lib/hooks/use-data';
import type { CalculatorSetupDTO, QuoteFromJobDTO, QuoteScenarioDTO, SimilarJobDTO } from '@/server/domain/quotes';

export const quoteKeys = {
  root: () => ['quotes'] as const,
  list: () => ['quotes', 'list'] as const,
  setup: () => ['quotes', 'setup'] as const,
  similar: (jobTypeId: string | null, clientId: string | null, exclude: string | null) => ['quotes', 'similar', jobTypeId, clientId, exclude] as const,
  fromJob: (ref: string) => ['quotes', 'from-job', ref] as const,
};

export const useQuoteScenarios = (opts?: Opts<QuoteScenarioDTO[]>) => useQuery({ queryKey: quoteKeys.list(), queryFn: () => apiGet<QuoteScenarioDTO[]>(apiPath('quotes')), staleTime: 30_000, ...opts });
export const useCalculatorSetup = (opts?: Opts<CalculatorSetupDTO>) => useQuery({ queryKey: quoteKeys.setup(), queryFn: () => apiGet<CalculatorSetupDTO>(apiPath('quotes/setup')), staleTime: 60_000, ...opts });
export const useSimilarJobs = (params: { jobTypeId: string | null; clientId: string | null; excludeJobId: string | null }, opts?: Opts<SimilarJobDTO[]>) =>
  useQuery({
    queryKey: quoteKeys.similar(params.jobTypeId, params.clientId, params.excludeJobId),
    queryFn: () => apiGet<SimilarJobDTO[]>(apiPath('quotes/similar', { jobType: params.jobTypeId, client: params.clientId, exclude: params.excludeJobId })),
    enabled: Boolean(params.jobTypeId),
    staleTime: 60_000,
    ...opts,
  });
/** Not a hook: one read of a job's real numbers, as a filled form. */
export const fetchQuoteFromJob = (ref: string) => apiGet<QuoteFromJobDTO>(apiPath('quotes/from-job', { job: ref }));
