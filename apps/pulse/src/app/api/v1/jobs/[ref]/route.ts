import { apiRoute } from '@/server/http/api';
import { getJob } from '@/server/domain';

/** One job by id or by job number: fields, numbers, status reasons, prices, quote, budget, links, owner. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => getJob(ctx, decodeURIComponent(params.ref)));
