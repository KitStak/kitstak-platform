import { apiRoute } from '@/server/http/api';
import { intParam, listOf, oneOf, rangeParams, str, uuidParam } from '@/server/http/params';
import { listProfitEntries } from '@/server/domain';
import { FACT_KINDS, JOB_STATUS_VALUES } from '@/lib/constants';

/** The rows behind a profit number, with job, client and service names: the last stop of a drill down. `?kinds=&limit=` plus the Profit filters. `job=none` gives the rows put on a client with no job. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listProfitEntries(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), ...(str(searchParams, 'job') === 'none' ? { noJob: true } : { jobId: uuidParam(searchParams, 'job') }), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES), kinds: listOf(searchParams, 'kinds', FACT_KINDS), limit: intParam(searchParams, 'limit', 500, 2000) }),
);
