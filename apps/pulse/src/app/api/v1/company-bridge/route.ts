import { apiRoute } from '@/server/http/api';
import { rangeParams, uuidParam } from '@/server/http/params';
import { getCompanyBridge } from '@/server/domain';

/** The walk from profit on jobs to company profit, with paid time, utilization and the payroll check. `?from=&to=&site=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => getCompanyBridge(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site') }));
