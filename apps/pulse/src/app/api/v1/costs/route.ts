import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, oneOf, uuidParam } from '@/server/http/params';
import { listCosts } from '@/server/domain';
import { COST_SCOPES } from '@/lib/constants';

/** Other costs, newest first. `?scope=job|client|company&job=&client=&site=&from=&to=&deleted=1&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listCosts(ctx, { scope: oneOf(searchParams, 'scope', COST_SCOPES), jobId: uuidParam(searchParams, 'job'), clientId: uuidParam(searchParams, 'client'), siteId: uuidParam(searchParams, 'site'), from: dateParam(searchParams, 'from'), to: dateParam(searchParams, 'to'), includeDeleted: flag(searchParams, 'deleted'), limit: intParam(searchParams, 'limit', 2000, 10000) }));
