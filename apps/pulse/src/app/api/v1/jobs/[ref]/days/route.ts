import { apiRoute } from '@/server/http/api';
import { oneOf } from '@/server/http/params';
import { getJobRowForReader, getProfit, requirePulse } from '@/server/domain';

/** Revenue, cost, profit, units and hours of one job per day, week or month (`?by=`), over its whole life. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params, searchParams }) => {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, decodeURIComponent(params.ref), access);
  return getProfit(ctx, oneOf(searchParams, 'by', ['day', 'week', 'month'] as const) ?? 'day', { from: '0001-01-01', to: '9999-12-31', jobId: job.id });
});
