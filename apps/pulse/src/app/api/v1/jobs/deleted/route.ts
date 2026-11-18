import { apiRoute } from '@/server/http/api';
import { listDeletedJobs } from '@/server/domain';

/** Recently deleted jobs (managers and up), for restore. */
export const GET = apiRoute(async ({ ctx }) => listDeletedJobs(ctx));
