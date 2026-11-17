import { apiRoute } from '@/server/http/api';
import { rangeParams, uuidParam } from '@/server/http/params';
import { getPaceBoard } from '@/server/domain';

/** Pace against target pace by job, labor class and day. `?from=&to=&site=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getPaceBoard(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site') }));
