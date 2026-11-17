import { apiRoute } from '@/server/http/api';
import { dateParam, oneOf, uuidParam } from '@/server/http/params';
import { listDayReviews } from '@/server/domain';
import { DAY_REVIEW_STATUSES } from '@/lib/constants';

/** Days marked complete, approved or sent back. `?site=&from=&to=&status=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listDayReviews(ctx, { siteId: uuidParam(searchParams, 'site'), from: dateParam(searchParams, 'from'), to: dateParam(searchParams, 'to'), status: oneOf(searchParams, 'status', DAY_REVIEW_STATUSES) }),
);
