import { apiRoute } from '@/server/http/api';
import { listSchedules } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/schedules */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => listSchedules(ctx, decodeURIComponent(params.key)));
