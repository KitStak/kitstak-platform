import { apiRoute } from '@/server/http/api';
import { getJobTaskCosts } from '@/server/domain';

/** Hours, labor cost and task units of this job by Projects task, untagged lines last. Money is null for readers who cannot see it. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => getJobTaskCosts(ctx, decodeURIComponent(params.ref)));
