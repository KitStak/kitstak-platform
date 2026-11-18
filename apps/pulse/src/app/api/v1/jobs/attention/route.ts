import { apiRoute } from '@/server/http/api';
import { intParam } from '@/server/http/params';
import { listJobsNeedingAttention } from '@/server/domain';

/** Open jobs that are losing money, at risk or missing data, worst first. `?limit=` (default 10). */
export const GET = apiRoute(async ({ ctx, searchParams }) => listJobsNeedingAttention(ctx, intParam(searchParams, 'limit', 10, 100)));
