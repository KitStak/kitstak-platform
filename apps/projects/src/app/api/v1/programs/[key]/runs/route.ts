import { apiRoute } from '@/server/http/api';
import { listRuns } from '@/server/domain/programs';
import { addDaysIso, todayIso } from '@/lib/dates';
import { dateParam } from '../../_lib';

/** GET /api/v1/programs/:key/runs?from=&to= */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const today = todayIso();
  return listRuns(ctx, decodeURIComponent(params.key), { from: dateParam(searchParams.get('from')) ?? addDaysIso(today, -14), to: dateParam(searchParams.get('to')) ?? addDaysIso(today, 14) });
});
