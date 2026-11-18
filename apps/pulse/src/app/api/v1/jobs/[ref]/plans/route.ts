import { apiRoute } from '@/server/http/api';
import { getJobPlans, getJobRow } from '@/server/domain';

/** `{ quote, budget }` with their lines. Either may be null. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => {
  const job = await getJobRow(ctx, decodeURIComponent(params.ref), undefined, true);
  return getJobPlans(ctx, job.id);
});
