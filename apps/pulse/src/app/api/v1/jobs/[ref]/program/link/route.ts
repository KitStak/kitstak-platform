import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { listProgramsToLink } from '@/server/domain';

/** Programs a manager can link to this job, each with the reason it cannot be when it cannot. `?q=` searches name and key. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params, searchParams }) => listProgramsToLink(ctx, decodeURIComponent(params.ref), str(searchParams, 'q')));
