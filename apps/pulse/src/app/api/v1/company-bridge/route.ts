import { apiRoute } from '@/server/http/api';
import { oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { getCompanyBridge } from '@/server/domain';
import { COMPANY_COST_SPREADS } from '@/lib/profit';

/**
 * The walk from profit on jobs to company profit, with paid time, utilization and the payroll check.
 * `?from=&to=&site=&spread=calendar|work_days` (`spread` left out: the workspace setting).
 */
export const GET = apiRoute(async ({ ctx, searchParams }) => getCompanyBridge(ctx, { ...rangeParams(searchParams), siteId: uuidParam(searchParams, 'site'), spread: oneOf(searchParams, 'spread', COMPANY_COST_SPREADS) }));
