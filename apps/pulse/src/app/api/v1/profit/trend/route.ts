import { apiRoute } from '@/server/http/api';
import { oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { getProfitTrend } from '@/server/domain';
import { JOB_STATUS_VALUES } from '@/lib/constants';

/** Revenue, cost, profit, units and hours per bucket. `?bucket=day|week|month` (picked from the range when left out) plus the Profit filters. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getProfitTrend(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), jobId: uuidParam(searchParams, 'job'), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) }, oneOf(searchParams, 'bucket', ['day', 'week', 'month'] as const) ?? undefined));
