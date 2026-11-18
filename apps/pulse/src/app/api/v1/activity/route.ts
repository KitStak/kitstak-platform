import { apiRoute } from '@/server/http/api';
import { dateParam, intParam, str, uuidParam } from '@/server/http/params';
import { listActivity } from '@/server/domain';

/**
 * The audit feed, newest first: `{ items, nextCursor }`.
 * `?job=&client=&entityType=&entityId=&actor=&verb=production.&q=&from=&to=&cursor=&limit=`.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listActivity(ctx, {
    jobId: uuidParam(searchParams, 'job'),
    clientId: uuidParam(searchParams, 'client'),
    entityType: str(searchParams, 'entityType'),
    entityId: uuidParam(searchParams, 'entityId'),
    actorId: uuidParam(searchParams, 'actor'),
    verbPrefix: str(searchParams, 'verb'),
    q: str(searchParams, 'q'),
    from: dateParam(searchParams, 'from'),
    to: dateParam(searchParams, 'to'),
    cursor: str(searchParams, 'cursor'),
    limit: intParam(searchParams, 'limit', 50, 200),
  }),
);
