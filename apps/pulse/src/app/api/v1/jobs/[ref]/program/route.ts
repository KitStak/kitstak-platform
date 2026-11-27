import { apiRoute } from '@/server/http/api';
import { getJobProgram } from '@/server/domain';

/** The KitStak program side of a job: the Program card and the By variant table (`available: false` when no program feeds it). */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => getJobProgram(ctx, decodeURIComponent(params.ref)));
