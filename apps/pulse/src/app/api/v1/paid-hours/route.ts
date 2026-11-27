import { apiRoute } from '@/server/http/api';
import { dateParam, flag, intParam, uuidParam } from '@/server/http/params';
import { listPaidHours } from '@/server/domain';

/** Paid hours, newest first. `?site=&from=&to=&deleted=1&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listPaidHours(ctx, { siteId: uuidParam(searchParams, 'site'), from: dateParam(searchParams, 'from'), to: dateParam(searchParams, 'to'), includeDeleted: flag(searchParams, 'deleted'), limit: intParam(searchParams, 'limit', 2000, 10000) }),
);
