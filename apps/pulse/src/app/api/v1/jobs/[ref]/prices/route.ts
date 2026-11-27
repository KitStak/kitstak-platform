import { apiRoute } from '@/server/http/api';
import { listJobPrices } from '@/server/domain';

/** The dated prices of a job, newest first. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => listJobPrices(ctx, decodeURIComponent(params.ref)));
