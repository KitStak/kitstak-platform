import { apiRoute } from '@/server/http/api';
import { flag, oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { getProfit } from '@/server/domain';
import { JOB_STATUS_VALUES, PROFIT_GROUPS } from '@/lib/constants';

/**
 * The Profit explorer. `?by=job|client|type|service|site|month|week|day&from=&to=&site=&client=&jobType=&job=&service=&status=&compare=1&trend=1`.
 * Returns `{ by, from, to, rows, total, moneyHidden }`.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  getProfit(ctx, oneOf(searchParams, 'by', PROFIT_GROUPS) ?? 'job', { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), jobId: uuidParam(searchParams, 'job'), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) }, { comparePrior: flag(searchParams, 'compare'), trend: flag(searchParams, 'trend') }),
);
