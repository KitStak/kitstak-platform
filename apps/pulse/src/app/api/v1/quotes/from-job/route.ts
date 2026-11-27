import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { quoteFromJob } from '@/server/domain';
import { invalid } from '@/server/errors';

/** The calculator form filled from a job's real numbers. `?job=` takes a job number or id. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const ref = str(searchParams, 'job');
  if (!ref) throw invalid('Pick a job.');
  return quoteFromJob(ctx, ref);
});
