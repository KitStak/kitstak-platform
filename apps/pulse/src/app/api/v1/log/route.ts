import { apiRoute } from '@/server/http/api';
import { dateParam, uuidParam } from '@/server/http/params';
import { getLogGrid } from '@/server/domain';

/** The Log work day grid for `?date=&site=` (today at the default site when left out). */
export const GET = apiRoute(async ({ ctx, searchParams }) => getLogGrid(ctx, { date: dateParam(searchParams, 'date'), siteId: uuidParam(searchParams, 'site') }));
