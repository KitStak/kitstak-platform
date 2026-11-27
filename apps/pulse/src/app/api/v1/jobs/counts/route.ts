import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { countJobsByRisk } from '@/server/domain';

/** Open jobs per status for the filter chips: `{ losing, at_risk, heads_up, on_track, no_data, none }`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => countJobsByRisk(ctx, { clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), siteId: uuidParam(searchParams, 'site') }));
