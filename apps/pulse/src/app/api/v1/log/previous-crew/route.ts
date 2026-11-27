import { apiRoute } from '@/server/http/api';
import { dateParam, uuidParam } from '@/server/http/params';
import { getPreviousCrew } from '@/server/domain';
import { invalid } from '@/server/errors';

/** The crew lines of the most recent earlier day of each job, for "Copy yesterday's crew". */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const date = dateParam(searchParams, 'date');
  if (!date) throw invalid('Pick a day first.');
  return getPreviousCrew(ctx, { date, siteId: uuidParam(searchParams, 'site') });
});
