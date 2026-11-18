import { apiRoute } from '@/server/http/api';
import { rangeParams, uuidParam } from '@/server/http/params';
import { getSummary } from '@/server/domain';

/** Home: counts by status, period totals with the prior period, the company profit bridge, entry progress, things to fix. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getSummary(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site') }));
