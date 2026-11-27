import { apiRoute } from '@/server/http/api';
import { getJobPlans, getJobRowForReader } from '@/server/domain';

/** `{ quote, budget }` with their lines. Either may be null. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => {
  const job = await getJobRowForReader(ctx, decodeURIComponent(params.ref));
  return getJobPlans(ctx, job.id);
});
