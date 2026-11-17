import { apiRoute } from '@/server/http/api';
import { intParam, uuidParam } from '@/server/http/params';
import { getReviewQueue } from '@/server/domain';

/** The days to review, newest first, with odd rows and missing jobs. `?site=&days=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getReviewQueue(ctx, { siteId: uuidParam(searchParams, 'site'), days: intParam(searchParams, 'days', 14, 62) }));
