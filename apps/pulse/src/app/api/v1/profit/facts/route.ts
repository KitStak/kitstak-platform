import { apiRoute } from '@/server/http/api';
import { intParam, listOf, oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { listFacts } from '@/server/domain';
import { FACT_KINDS, JOB_STATUS_VALUES } from '@/lib/constants';

/** The stamped rows behind a number (drill down). `?kinds=labor,material&limit=` plus the Profit filters. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listFacts(ctx, { ...{ ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), jobId: uuidParam(searchParams, 'job'), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) }, kinds: listOf(searchParams, 'kinds', FACT_KINDS), limit: intParam(searchParams, 'limit', 500, 5000) }));
