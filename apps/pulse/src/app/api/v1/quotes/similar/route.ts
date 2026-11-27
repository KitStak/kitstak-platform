import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { listSimilarJobs } from '@/server/domain';

/** "What happened last time": jobs of the same job type that already ran. `?jobType=&client=&exclude=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listSimilarJobs(ctx, { jobTypeId: uuidParam(searchParams, 'jobType'), clientId: uuidParam(searchParams, 'client'), excludeJobId: uuidParam(searchParams, 'exclude') }));
