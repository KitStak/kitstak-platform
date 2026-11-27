import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, oneOf, uuidParam } from '@/server/http/params';
import { listRevenue } from '@/server/domain';

/** Revenue entries, newest first. `?kind=invoice|fee|adjustment|credit|fixed_true_up&job=&client=&from=&to=&deleted=1&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listRevenue(ctx, { kind: oneOf(searchParams, 'kind', ['invoice', 'fee', 'adjustment', 'credit', 'fixed_true_up'] as const), jobId: uuidParam(searchParams, 'job'), clientId: uuidParam(searchParams, 'client'), siteId: uuidParam(searchParams, 'site'), from: dateParam(searchParams, 'from'), to: dateParam(searchParams, 'to'), includeDeleted: flag(searchParams, 'deleted'), limit: intParam(searchParams, 'limit', 2000, 10000) }),
);
