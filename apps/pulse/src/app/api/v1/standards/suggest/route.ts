import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { suggestStandard } from '@/server/domain';
import { invalid } from '@/server/errors';

/** "Suggest from history": the median pace of the last 20 evidence days, with the spread. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const jobTypeId = uuidParam(searchParams, 'jobType');
  if (!jobTypeId) throw invalid('Pick a job type first.');
  return suggestStandard(ctx, { jobTypeId, clientId: uuidParam(searchParams, 'client'), laborClassId: uuidParam(searchParams, 'laborClass') });
});
