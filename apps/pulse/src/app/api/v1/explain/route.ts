import { apiRoute } from '@/server/http/api';
import { oneOf, rangeParams, str, uuidParam } from '@/server/http/params';
import { explain } from '@/server/domain';
import { JOB_STATUS_VALUES } from '@/lib/constants';

/**
 * "How we got this" for one number.
 * `?metric=revenue|labor|material|other|shared|cost|profit|margin|margin_before_shared|labor_pct|uph|cost_per_unit|units|hours|company_profit|not_billed`
 * plus the Profit filters (`from,to,site,client,jobType,job,service,status`). Returns `ExplainDTO`.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  explain(ctx, str(searchParams, 'metric') ?? '', { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), jobId: uuidParam(searchParams, 'job'), vasServiceId: uuidParam(searchParams, 'service'), status: oneOf(searchParams, 'status', JOB_STATUS_VALUES) }),
);
