import { apiRoute } from '@/server/http/api';
import { listLinkedJobs } from '@/server/domain';

/** Every link between a job and a sibling record, newest first. */
export const GET = apiRoute(async ({ ctx }) => listLinkedJobs(ctx));
