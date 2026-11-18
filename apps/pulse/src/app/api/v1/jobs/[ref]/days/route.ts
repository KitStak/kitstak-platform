import { apiRoute } from '@/server/http/api';
import { oneOf } from '@/server/http/params';
import { getJobRow, getProfit, requirePulse } from '@/server/domain';

/** Revenue, cost, profit, units and hours of one job per day, week or month (`?by=`), over its whole life. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params, searchParams }) => {
  await requirePulse(ctx, 'pulse:read');
  const job = await getJobRow(ctx, decodeURIComponent(params.ref), undefined, true);
  return getProfit(ctx, oneOf(searchParams, 'by', ['day', 'week', 'month'] as const) ?? 'day', { from: '0001-01-01', to: '9999-12-31', jobId: job.id });
});
