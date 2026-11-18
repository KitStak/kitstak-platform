import { apiRoute } from '@/server/http/api';
import { oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { getProfitPivot } from '@/server/domain';
import { JOB_STATUS_VALUES, PROFIT_GROUPS } from '@/lib/constants';

/** Profit grouped by two things at once: `?rows=client&cols=month` plus the Profit filters. Returns `ProfitPivotDTO`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  getProfitPivot(ctx, oneOf(searchParams, 'rows', PROFIT_GROUPS) ?? 'client', oneOf(searchParams, 'cols', PROFIT_GROUPS) ?? 'month', { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), jobId: uuidParam(searchParams, 'job'), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) }),
);
