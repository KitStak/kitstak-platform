import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, oneOf, uuidParam } from '@/server/http/params';
import { listProduction } from '@/server/domain';
import { STREAM_SOURCES } from '@/lib/constants';

/** Production entries, newest first. `?job=&client=&site=&laborClass=&from=&to=&source=&needsHours=1&deleted=1&limit=&offset=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listProduction(ctx, {
    jobId: uuidParam(searchParams, 'job'),
    clientId: uuidParam(searchParams, 'client'),
    siteId: uuidParam(searchParams, 'site'),
    laborClassId: uuidParam(searchParams, 'laborClass'),
    from: dateParam(searchParams, 'from'),
    to: dateParam(searchParams, 'to'),
    source: oneOf(searchParams, 'source', STREAM_SOURCES),
    needsHours: flag(searchParams, 'needsHours'),
    includeDeleted: flag(searchParams, 'deleted'),
    limit: intParam(searchParams, 'limit', 1000, 10000),
    offset: intParam(searchParams, 'offset', 0, 10_000_000),
  }),
);
