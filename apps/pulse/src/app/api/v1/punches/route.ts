import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, str, uuidParam } from '@/server/http/params';
import { listPunches } from '@/server/domain';

/** Time punches. `?site=&job=&employee=&from=&to=&deleted=&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listPunches(ctx, {
    siteId: uuidParam(searchParams, 'site'),
    jobId: uuidParam(searchParams, 'job'),
    employeeCode: str(searchParams, 'employee'),
    from: dateParam(searchParams, 'from'),
    to: dateParam(searchParams, 'to'),
    includeDeleted: flag(searchParams, 'deleted'),
    limit: intParam(searchParams, 'limit', 1000, 10_000),
  }),
);
