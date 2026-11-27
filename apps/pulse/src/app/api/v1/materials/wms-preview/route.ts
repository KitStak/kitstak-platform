import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { previewWmsUsage } from '@/server/domain';
import { invalid } from '@/server/errors';

/** What a pull from the warehouse would add to a job's material usage. `?job=` takes a job number or id. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const ref = str(searchParams, 'job');
  if (!ref) throw invalid('Pick a job.');
  return previewWmsUsage(ctx, ref);
});
