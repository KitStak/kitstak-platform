import { apiRoute } from '@/server/http/api';
import { listJobTasks } from '@/server/domain';

/** The Projects tasks a person can tag on this job's work (`{ hasProject, tasks }`). Empty when the job has no linked project. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => listJobTasks(ctx, decodeURIComponent(params.ref)));
