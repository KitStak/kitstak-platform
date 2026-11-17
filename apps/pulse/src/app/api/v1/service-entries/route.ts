import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, uuidParam } from '@/server/http/params';
import { listVasEntries } from '@/server/domain';

/** Extra service entries, newest first. `?service=&job=&client=&site=&from=&to=&noPrice=1&deleted=1&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listVasEntries(ctx, { vasServiceId: uuidParam(searchParams, 'service'), noPrice: flag(searchParams, 'noPrice'), jobId: uuidParam(searchParams, 'job'), clientId: uuidParam(searchParams, 'client'), siteId: uuidParam(searchParams, 'site'), from: dateParam(searchParams, 'from'), to: dateParam(searchParams, 'to'), includeDeleted: flag(searchParams, 'deleted'), limit: intParam(searchParams, 'limit', 2000, 10000) }));
