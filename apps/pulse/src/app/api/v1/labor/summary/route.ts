import { apiRoute } from '@/server/http/api';
import { rangeParams, uuidParam } from '@/server/http/params';
import { getLaborSummary } from '@/server/domain';

/** The Labor page: hours and cost by labor class, time not on a job by reason, paid time by day, the payroll check. `?from=&to=&site=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getLaborSummary(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site') }));
